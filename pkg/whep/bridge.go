package whep

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/bluenviron/gortsplib/v5"
	"github.com/bluenviron/gortsplib/v5/pkg/base"
	"github.com/bluenviron/gortsplib/v5/pkg/description"
	"github.com/bluenviron/gortsplib/v5/pkg/format"
	"github.com/google/uuid"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

const gracePeriod = 10 * time.Second

// BridgeManager is the registry of active bridges keyed by "entityId/cameraIndex".
type BridgeManager struct {
	mu      sync.Mutex
	bridges map[string]*Bridge
}

func NewBridgeManager() *BridgeManager {
	return &BridgeManager{bridges: make(map[string]*Bridge)}
}

// GetOrCreate returns an existing bridge or creates a new one for the given RTSP URL.
func (bm *BridgeManager) GetOrCreate(key, rtspURL string) (*Bridge, error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if b, ok := bm.bridges[key]; ok {
		b.cancelGrace()
		return b, nil
	}

	b, err := newBridge(rtspURL, func() {
		bm.mu.Lock()
		delete(bm.bridges, key)
		bm.mu.Unlock()
		slog.Debug("whep: bridge removed", "key", key)
	})
	if err != nil {
		return nil, err
	}
	bm.bridges[key] = b
	slog.Debug("whep: bridge created", "key", key)
	return b, nil
}

// Bridge manages a single RTSP source and fans out RTP packets to multiple
// WebRTC PeerConnections via a shared TrackLocalStaticRTP.
type Bridge struct {
	mu sync.Mutex

	rtspClient *gortsplib.Client
	videoTrack *webrtc.TrackLocalStaticRTP
	codec      string // e.g. "video/H264", "video/H265"

	peers      map[string]*Peer
	onEmpty    func()
	graceTimer *time.Timer
}

func newBridge(rtspURL string, onEmpty func()) (*Bridge, error) {
	u, err := base.ParseURL(rtspURL)
	if err != nil {
		return nil, fmt.Errorf("parse RTSP URL: %w", err)
	}

	c := &gortsplib.Client{
		Scheme: u.Scheme,
		Host:   u.Host,
	}

	err = c.Start()
	if err != nil {
		return nil, fmt.Errorf("RTSP connect: %w", err)
	}

	desc, _, err := c.Describe(u)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("RTSP DESCRIBE: %w", err)
	}

	// Find a supported video track: try H264 first, then H265.
	var videoMedia *description.Media
	var videoFormat format.Format
	var mimeType string

	var h264Format *format.H264
	if m := desc.FindFormat(&h264Format); m != nil {
		videoMedia = m
		videoFormat = h264Format
		mimeType = webrtc.MimeTypeH264
	}

	if videoMedia == nil {
		var h265Format *format.H265
		if m := desc.FindFormat(&h265Format); m != nil {
			videoMedia = m
			videoFormat = h265Format
			mimeType = webrtc.MimeTypeH265
		}
	}

	if videoMedia == nil {
		// Log what the camera actually offers for debugging.
		var found []string
		for _, m := range desc.Medias {
			for _, f := range m.Formats {
				found = append(found, f.Codec())
			}
		}
		c.Close()
		return nil, fmt.Errorf("no supported video codec (H264/H265) in RTSP stream, found: %v", found)
	}

	slog.Debug("whep: RTSP track selected", "url", rtspURL, "codec", mimeType)

	// Create the shared WebRTC track
	videoTrack, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{
			MimeType:  mimeType,
			ClockRate: 90000,
		},
		"video",
		"hydris-cam",
	)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("create local track: %w", err)
	}

	// Setup the video media for reading
	_, err = c.Setup(desc.BaseURL, videoMedia, 0, 0)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("RTSP SETUP: %w", err)
	}

	b := &Bridge{
		rtspClient: c,
		videoTrack: videoTrack,
		codec:      mimeType,
		peers:      make(map[string]*Peer),
		onEmpty:    onEmpty,
	}

	// Pipe RTP packets from RTSP to the shared WebRTC track
	c.OnPacketRTP(videoMedia, videoFormat, func(pkt *rtp.Packet) {
		if err := videoTrack.WriteRTP(pkt); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			slog.Debug("whep: write RTP", "error", err)
		}
	})

	_, err = c.Play(nil)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("RTSP PLAY: %w", err)
	}

	// Monitor RTSP connection in background
	go func() {
		err := c.Wait()
		if err != nil {
			slog.Warn("whep: RTSP connection closed", "error", err)
		}
		b.closeAllPeers()
	}()

	return b, nil
}

// AddPeer creates a new WebRTC PeerConnection, adds the shared video track,
// performs SDP negotiation, and returns the SDP answer.
func (b *Bridge) AddPeer(offerSDP string) (string, error) {
	// Quick sanity check: does the browser offer include our codec?
	// The codec MIME is like "video/H264" — check for the codec name in the SDP.
	codecName := b.codec[strings.Index(b.codec, "/")+1:] // "H264" or "H265"
	if !strings.Contains(strings.ToUpper(offerSDP), strings.ToUpper(codecName)) {
		return "", fmt.Errorf("browser does not support %s (camera codec), try configuring the camera to H264", b.codec)
	}

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return "", fmt.Errorf("create peer connection: %w", err)
	}

	rtpSender, err := pc.AddTrack(b.videoTrack)
	if err != nil {
		pc.Close()
		return "", fmt.Errorf("add track: %w", err)
	}

	// Drain RTCP from the sender (required by pion)
	go func() {
		buf := make([]byte, 1500)
		for {
			if _, _, err := rtpSender.Read(buf); err != nil {
				return
			}
		}
	}()

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  offerSDP,
	}
	if err := pc.SetRemoteDescription(offer); err != nil {
		pc.Close()
		return "", fmt.Errorf("set remote description: %w", err)
	}

	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		pc.Close()
		return "", fmt.Errorf("create answer: %w", err)
	}

	gatherComplete := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		pc.Close()
		return "", fmt.Errorf("set local description: %w", err)
	}

	// Wait for ICE gathering to complete
	select {
	case <-gatherComplete:
	case <-time.After(5 * time.Second):
		pc.Close()
		return "", fmt.Errorf("ICE gathering timeout")
	}

	peerID := uuid.New().String()
	peer := &Peer{id: peerID, pc: pc}

	b.mu.Lock()
	b.peers[peerID] = peer
	b.mu.Unlock()

	// Monitor peer disconnection
	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		if state == webrtc.ICEConnectionStateDisconnected ||
			state == webrtc.ICEConnectionStateFailed ||
			state == webrtc.ICEConnectionStateClosed {
			b.removePeer(peerID)
		}
	})

	slog.Debug("whep: peer added", "peer", peerID)
	return pc.LocalDescription().SDP, nil
}

func (b *Bridge) removePeer(peerID string) {
	b.mu.Lock()
	peer, ok := b.peers[peerID]
	if !ok {
		b.mu.Unlock()
		return
	}
	delete(b.peers, peerID)
	peer.pc.Close()
	isEmpty := len(b.peers) == 0
	b.mu.Unlock()

	slog.Debug("whep: peer removed", "peer", peerID)

	if isEmpty {
		b.startGracePeriod()
	}
}

func (b *Bridge) closeAllPeers() {
	b.mu.Lock()
	for id, peer := range b.peers {
		peer.pc.Close()
		delete(b.peers, id)
	}
	b.mu.Unlock()

	if b.onEmpty != nil {
		b.onEmpty()
	}
}

func (b *Bridge) startGracePeriod() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.graceTimer != nil {
		return
	}

	slog.Debug("whep: no peers, starting grace period")
	b.graceTimer = time.AfterFunc(gracePeriod, func() {
		b.mu.Lock()
		if len(b.peers) > 0 {
			b.graceTimer = nil
			b.mu.Unlock()
			return
		}
		b.mu.Unlock()

		slog.Debug("whep: grace period expired, closing RTSP")
		b.rtspClient.Close()
		if b.onEmpty != nil {
			b.onEmpty()
		}
	})
}

func (b *Bridge) cancelGrace() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.graceTimer != nil {
		b.graceTimer.Stop()
		b.graceTimer = nil
	}
}
