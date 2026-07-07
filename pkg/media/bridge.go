package media

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os/exec"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/bluenviron/gortsplib/v5"
	"github.com/bluenviron/gortsplib/v5/pkg/base"
	"github.com/bluenviron/gortsplib/v5/pkg/description"
	"github.com/bluenviron/gortsplib/v5/pkg/format"
	"github.com/bluenviron/gortsplib/v5/pkg/format/rtph264"
	"github.com/bluenviron/mediacommon/v2/pkg/codecs/h264"
	"github.com/google/uuid"
	"github.com/pion/ice/v4"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
	"github.com/projectqai/hydris/pkg/executil"
)

const gracePeriod = 10 * time.Second

// BridgeManager is the registry of active bridges keyed by "entityId/cameraIndex".
type BridgeManager struct {
	mu       sync.Mutex
	bridges  map[string]*Bridge
	settings *webrtc.SettingEngine
	OnEpoch  func(key string, epoch time.Time)

	// DialContext, if set, is used by RTSP bridges to connect to the source.
	// This allows routing RTSP through a tunnel or custom transport.
	DialContext func(ctx context.Context, network, address string) (net.Conn, error)
}

func NewBridgeManager() *BridgeManager {
	return &BridgeManager{bridges: make(map[string]*Bridge)}
}

// SetupWebRTCMux configures a shared SettingEngine that multiplexes all ICE
// traffic through the given listeners. UDP and TCP ICE candidates are both
// gathered so browsers can fall back to TCP when UDP is blocked.
// conn may be nil when the UDP port could not be bound; ICE then gathers
// TCP mux candidates (and per-connection UDP candidates where possible).
func (bm *BridgeManager) SetupWebRTCMux(conn net.PacketConn, tcpListener net.Listener) {
	tcpMux := ice.NewTCPMuxDefault(ice.TCPMuxParams{Listener: tcpListener})
	s := &webrtc.SettingEngine{}
	s.SetICETCPMux(tcpMux)
	if conn != nil {
		s.SetICEUDPMux(ice.NewUDPMuxDefault(ice.UDPMuxParams{UDPConn: conn}))
		slog.Info("webrtc: UDP+TCP mux enabled", "addr", conn.LocalAddr().String())
	} else {
		slog.Info("webrtc: TCP mux enabled (no UDP mux)", "addr", tcpListener.Addr().String())
	}
	bm.settings = s
}

func (bm *BridgeManager) buildAPI() (*webrtc.API, error) {
	me := &webrtc.MediaEngine{}
	if err := me.RegisterDefaultCodecs(); err != nil {
		return nil, err
	}
	opts := []func(*webrtc.API){webrtc.WithMediaEngine(me)}
	if bm.settings != nil {
		opts = append(opts, webrtc.WithSettingEngine(*bm.settings))
	}
	return webrtc.NewAPI(opts...), nil
}

// InvalidateEntity closes all bridges for the given entity ID.
// This forces browsers to reconnect and pick up new stream URLs.
func (bm *BridgeManager) InvalidateEntity(entityID string) {
	prefix := entityID + "/"
	bm.mu.Lock()
	var toClose []*Bridge
	for key, b := range bm.bridges {
		if strings.HasPrefix(key, prefix) {
			toClose = append(toClose, b)
			delete(bm.bridges, key)
		}
	}
	bm.mu.Unlock()
	for _, b := range toClose {
		slog.Info("whep: invalidating bridge", "entity", entityID)
		go b.close()
	}
}

// GetOrCreate returns an existing bridge or creates a new one.
// If the source URL changed the old bridge is torn down first.
// Supports rtsp://, rtsps://, and v4l2:// source URLs.
func (bm *BridgeManager) GetOrCreate(key, sourceURL string) (*Bridge, error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if b, ok := bm.bridges[key]; ok {
		if b.sourceURL == sourceURL {
			b.cancelGrace()
			return b, nil
		}
		slog.Info("whep: source URL changed, replacing bridge", "key", key)
		delete(bm.bridges, key)
		go b.close()
	}

	onEmpty := func() {
		bm.mu.Lock()
		delete(bm.bridges, key)
		bm.mu.Unlock()
		slog.Debug("whep: bridge removed", "key", key)
	}

	var b *Bridge
	var err error
	if after, ok := strings.CutPrefix(sourceURL, "v4l2://"); ok {
		b, err = newLocalBridge(after, onEmpty, bm)
	} else {
		u, err2 := url.Parse(sourceURL)
		if err2 != nil {
			return nil, fmt.Errorf("parse source URL: %w", err2)
		}
		switch u.Scheme {
		case "rtsp", "rtsps":
			b, err = newRTSPBridge(sourceURL, onEmpty, bm)
		default:
			return nil, fmt.Errorf("unsupported source scheme: %s", u.Scheme)
		}
	}
	if err != nil {
		return nil, err
	}

	if bm.OnEpoch != nil {
		cb := bm.OnEpoch
		b.onEpoch = func(epoch time.Time) { cb(key, epoch) }
	}

	bm.bridges[key] = b
	slog.Info("whep: bridge created", "key", key, "source", sourceURL)
	return b, nil
}

// Bridge manages a single video source and fans out RTP packets to multiple
// consumers (WebRTC peers, RTSP server streams, etc.) via a shared track.
type Bridge struct {
	mu sync.Mutex

	sourceURL  string
	rtspClient *gortsplib.Client  // non-nil for RTSP sources
	videoMedia *description.Media // non-nil for RTSP sources, used for upstream RTCP
	cancel     context.CancelFunc // non-nil for local sources (ffmpeg)
	videoTrack *webrtc.TrackLocalStaticSample
	codec      string      // e.g. "video/H264", "video/H265"
	api        *webrtc.API // shared API with UDP mux (nil = default)

	// sps/pps are captured from the H264 bitstream for RTSP SDP.
	sps []byte
	pps []byte

	// sourceSPS/sourcePPS hold parameter sets from the RTSP DESCRIBE,
	// injected into the WHEP answer SDP so browsers can init H264
	// before in-band parameter sets arrive.
	sourceSPS []byte
	sourcePPS []byte

	cachedKeyframe         []byte
	cachedKeyframeDuration time.Duration

	epoch       time.Time
	firstRTPTS  uint32
	epochSet    bool
	epochSRDone bool
	onEpoch     func(time.Time)

	peers      map[string]*Peer
	rtpTaps    map[string]func(*rtp.Packet) // additional RTP consumers (e.g., RTSP relay)
	onEmpty    func()
	graceTimer *time.Timer
}

// SPS returns the last seen H264 SPS NALU (may be nil).
func (b *Bridge) SPS() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.sps
}

// PPS returns the last seen H264 PPS NALU (may be nil).
func (b *Bridge) PPS() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.pps
}

// OnRTP registers a callback that receives every RTP packet written to this
// bridge. Returns a key that can be passed to OffRTP to unregister.
func (b *Bridge) OnRTP(key string, cb func(*rtp.Packet)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.rtpTaps == nil {
		b.rtpTaps = make(map[string]func(*rtp.Packet))
	}
	b.rtpTaps[key] = cb
}

// OffRTP removes an RTP tap.
func (b *Bridge) OffRTP(key string) {
	b.mu.Lock()
	delete(b.rtpTaps, key)
	isEmpty := len(b.peers) == 0 && len(b.rtpTaps) == 0
	b.mu.Unlock()

	if isEmpty {
		b.startGracePeriod()
	}
}

// Codec returns the codec MIME type (e.g., "video/H264").
func (b *Bridge) Codec() string {
	return b.codec
}

func (b *Bridge) requestKeyframe() {
	b.mu.Lock()
	c, m, started := b.rtspClient, b.videoMedia, b.epochSet
	b.mu.Unlock()
	if c == nil || m == nil {
		return
	}
	// Don't send upstream RTCP until the stream has produced its first packet.
	// gortsplib's automatic UDP->TCP fallback transiently clears its internal
	// setuppedMedias map while it re-runs DESCRIBE/SETUP/PLAY; calling
	// WritePacketRTCP during that window dereferences a nil clientMedia and
	// panics. The fallback only happens before any packet arrives (and never
	// again afterwards), so the first packet is a safe gate against the race.
	if !started {
		return
	}
	_ = c.WritePacketRTCP(m, &rtcp.PictureLossIndication{})
}

var (
	h264FmtpPattern   = regexp.MustCompile(`(?m)^a=fmtp:(\d+) ([^\r\n]+)`)
	h264RtpmapPattern = regexp.MustCompile(`(?mi)^a=rtpmap:(\d+) H264/`)
)

func injectH264Params(sdp string, sps, pps []byte) string {
	if len(sps) == 0 || len(pps) == 0 {
		return sdp
	}
	h264PTs := make(map[string]bool)
	for _, m := range h264RtpmapPattern.FindAllStringSubmatch(sdp, -1) {
		h264PTs[m[1]] = true
	}
	if len(h264PTs) == 0 {
		return sdp
	}

	sprop := base64.StdEncoding.EncodeToString(sps) + "," +
		base64.StdEncoding.EncodeToString(pps)
	var pli string
	if len(sps) >= 4 {
		pli = strings.ToLower(hex.EncodeToString(sps[1:4]))
	}

	return h264FmtpPattern.ReplaceAllStringFunc(sdp, func(line string) string {
		m := h264FmtpPattern.FindStringSubmatch(line)
		if m == nil || !h264PTs[m[1]] {
			return line
		}
		params := parseFmtp(m[2])
		params["sprop-parameter-sets"] = sprop
		if pli != "" {
			params["profile-level-id"] = pli
		}
		if _, ok := params["level-asymmetry-allowed"]; !ok {
			params["level-asymmetry-allowed"] = "1"
		}
		if _, ok := params["packetization-mode"]; !ok {
			params["packetization-mode"] = "1"
		}
		keys := make([]string, 0, len(params))
		for k := range params {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(params))
		for _, k := range keys {
			parts = append(parts, k+"="+params[k])
		}
		return "a=fmtp:" + m[1] + " " + strings.Join(parts, ";")
	})
}

func parseFmtp(s string) map[string]string {
	out := make(map[string]string)
	for _, p := range strings.Split(s, ";") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		k, v, ok := strings.Cut(p, "=")
		if !ok {
			continue
		}
		out[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return out
}

func newRTSPBridge(rtspURL string, onEmpty func(), bm *BridgeManager) (*Bridge, error) {
	u, err := base.ParseURL(rtspURL)
	if err != nil {
		return nil, fmt.Errorf("parse RTSP URL: %w", err)
	}

	c := &gortsplib.Client{
		Scheme:      u.Scheme,
		Host:        u.Host,
		DialContext: bm.DialContext,
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
		var found []string
		for _, m := range desc.Medias {
			for _, f := range m.Formats {
				found = append(found, f.Codec())
			}
		}
		c.Close()
		return nil, fmt.Errorf("no supported video codec (H264/H265) in RTSP stream, found: %v", found)
	}

	api, err := bm.buildAPI()
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("build webrtc API: %w", err)
	}

	videoTrack, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: mimeType, ClockRate: 90000},
		"video", "hydris-cam",
	)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("create local track: %w", err)
	}

	_, err = c.Setup(desc.BaseURL, videoMedia, 0, 0)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("RTSP SETUP: %w", err)
	}

	var srcSPS, srcPPS []byte
	if h, ok := videoFormat.(*format.H264); ok {
		srcSPS = append([]byte(nil), h.SPS...)
		srcPPS = append([]byte(nil), h.PPS...)
	}

	b := &Bridge{
		sourceURL:  rtspURL,
		rtspClient: c,
		videoMedia: videoMedia,
		videoTrack: videoTrack,
		codec:      mimeType,
		api:        api,
		sourceSPS:  srcSPS,
		sourcePPS:  srcPPS,
		peers:      make(map[string]*Peer),
		onEmpty:    onEmpty,
	}

	rtpDec := &rtph264.Decoder{}
	if err := rtpDec.Init(); err != nil {
		c.Close()
		return nil, fmt.Errorf("rtph264 decoder init: %w", err)
	}

	var lastTS uint32
	c.OnPacketRTP(videoMedia, videoFormat, func(pkt *rtp.Packet) {
		if !b.epochSet {
			epoch := time.Now()
			b.mu.Lock()
			b.epoch = epoch
			b.firstRTPTS = pkt.Timestamp
			b.epochSet = true
			b.mu.Unlock()
			if b.onEpoch != nil {
				b.onEpoch(epoch)
			}
		}

		// Refine epoch from RTCP Sender Report once available.
		if !b.epochSRDone {
			if ntp, ok := c.PacketNTP(videoMedia, pkt); ok {
				elapsed := time.Duration(pkt.Timestamp-b.firstRTPTS) * time.Second / 90000
				epoch := ntp.Add(-elapsed)
				b.mu.Lock()
				b.epoch = epoch
				b.mu.Unlock()
				b.epochSRDone = true
				if b.onEpoch != nil {
					b.onEpoch(epoch)
				}
			}
		}

		nalus, err := rtpDec.Decode(pkt)
		if err != nil {
			if !errors.Is(err, rtph264.ErrMorePacketsNeeded) &&
				!errors.Is(err, rtph264.ErrNonStartingPacketAndNoPrevious) {
				rtpDec = &rtph264.Decoder{}
				_ = rtpDec.Init()
			}
			b.fanOutRTP(pkt)
			return
		}

		hasIDR := false
		for _, n := range nalus {
			if len(n) > 0 && (n[0]&0x1f) == 5 {
				hasIDR = true
				break
			}
		}

		var au []byte
		if hasIDR {
			if len(b.sourceSPS) > 0 {
				au = append(au, 0x00, 0x00, 0x00, 0x01)
				au = append(au, b.sourceSPS...)
			}
			if len(b.sourcePPS) > 0 {
				au = append(au, 0x00, 0x00, 0x00, 0x01)
				au = append(au, b.sourcePPS...)
			}
		}
		for _, n := range nalus {
			if len(n) == 0 {
				continue
			}
			t := n[0] & 0x1f
			if hasIDR && (t == 7 || t == 8) && len(b.sourceSPS) > 0 {
				continue
			}
			au = append(au, 0x00, 0x00, 0x00, 0x01)
			au = append(au, n...)
		}

		var duration time.Duration
		if lastTS != 0 && pkt.Timestamp != lastTS {
			delta := pkt.Timestamp - lastTS
			duration = time.Duration(delta) * time.Second / 90000
			if duration <= 0 || duration > time.Second {
				duration = 33 * time.Millisecond
			}
		} else {
			duration = 33 * time.Millisecond
		}
		lastTS = pkt.Timestamp

		if hasIDR {
			b.mu.Lock()
			b.cachedKeyframe = append([]byte(nil), au...)
			b.cachedKeyframeDuration = duration
			b.mu.Unlock()
		}

		if err := videoTrack.WriteSample(media.Sample{Data: au, Duration: duration}); err != nil &&
			!errors.Is(err, io.ErrClosedPipe) {
			slog.Debug("whep: write sample", "error", err)
		}
		b.fanOutRTP(pkt)
	})

	_, err = c.Play(nil)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("RTSP PLAY: %w", err)
	}

	go func() {
		err := c.Wait()
		if err != nil {
			slog.Warn("whep: RTSP connection closed", "error", err)
		}
		b.mu.Lock()
		b.rtspClient = nil
		b.videoMedia = nil
		b.mu.Unlock()
		b.closeAllPeers()
	}()

	return b, nil
}

// newLocalBridge creates a bridge by spawning ffmpeg to encode H264 from
// a local device (V4L2). The H264 output is parsed and written directly
// to the shared WebRTC track — no RTSP in the middle.
func newLocalBridge(devicePath string, onEmpty func(), bm *BridgeManager) (*Bridge, error) {
	videoTrack, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000},
		"video", "hydris-cam",
	)
	if err != nil {
		return nil, fmt.Errorf("create local track: %w", err)
	}

	api, err := bm.buildAPI()
	if err != nil {
		return nil, fmt.Errorf("build webrtc API: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	b := &Bridge{
		sourceURL:  "v4l2://" + devicePath,
		cancel:     cancel,
		videoTrack: videoTrack,
		codec:      webrtc.MimeTypeH264,
		api:        api,
		peers:      make(map[string]*Peer),
		onEmpty:    onEmpty,
	}

	go func() {
		err := runFFmpegBridge(ctx, devicePath, b)
		if err != nil && ctx.Err() == nil {
			slog.Warn("whep: local bridge ffmpeg ended", "device", devicePath, "error", err)
		}
		b.closeAllPeers()
	}()

	return b, nil
}

// fanOutRTP sends an RTP packet to all registered taps.
func (b *Bridge) fanOutRTP(pkt *rtp.Packet) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, cb := range b.rtpTaps {
		cb(pkt)
	}
}

// runFFmpegBridge spawns ffmpeg to encode H264 from a V4L2 device and writes
// RTP packets directly to the shared WebRTC track and any additional taps.
func runFFmpegBridge(ctx context.Context, devicePath string, b *Bridge) error {
	track := b.videoTrack
	ffmpegPath, err := findFFmpeg()
	if err != nil {
		return fmt.Errorf("ffmpeg not found: %w", err)
	}

	args := buildH264EncodeArgs(ffmpegPath, devicePath)
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	executil.HideWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start ffmpeg: %w", err)
	}
	slog.Info("whep: ffmpeg H264 started", "pid", cmd.Process.Pid, "args", args)

	var buf []byte
	var pendingAU [][]byte
	hadVCL := false
	const frameDuration = 40 * time.Millisecond

	flush := func() {
		if len(pendingAU) == 0 {
			return
		}
		var au []byte
		for _, n := range pendingAU {
			au = append(au, 0x00, 0x00, 0x00, 0x01)
			au = append(au, n...)
		}
		if err := track.WriteSample(media.Sample{Data: au, Duration: frameDuration}); err != nil &&
			!errors.Is(err, io.ErrClosedPipe) {
			slog.Debug("whep: write sample", "error", err)
		}
		pendingAU = nil
		hadVCL = false
	}

	// emitNALU processes a complete NALU: captures SPS/PPS, detects AU
	// boundaries, and accumulates into pendingAU for flush.
	emitNALU := func(nalu []byte) {
		if len(nalu) == 0 {
			return
		}
		typ := h264.NALUType(nalu[0] & 0x1F)
		isVCL := typ >= 1 && typ <= 5

		switch typ {
		case h264.NALUTypeSPS:
			b.mu.Lock()
			b.sps = append([]byte(nil), nalu...)
			b.mu.Unlock()
		case h264.NALUTypePPS:
			b.mu.Lock()
			b.pps = append([]byte(nil), nalu...)
			b.mu.Unlock()
		}

		if hadVCL && (isVCL || typ == h264.NALUTypeSPS) {
			flush()
		}

		pendingAU = append(pendingAU, append([]byte(nil), nalu...))
		if isVCL {
			hadVCL = true
		}
	}

	tmp := make([]byte, 32*1024)
	// scPos tracks the start-code position of the current (incomplete) NALU.
	// -1 means we haven't found a start code yet.
	scPos := -1

	for {
		n, readErr := stdout.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)

			for {
				if scPos < 0 {
					sc := findSC(buf, 0)
					if sc < 0 {
						buf = buf[:0] // discard pre-stream junk
						break
					}
					scPos = sc
				}

				// Find start of NALU data (skip 00 00 01 or 00 00 00 01).
				dataStart := scPos + 3
				if dataStart < len(buf) && buf[scPos+2] == 0 {
					dataStart = scPos + 4
				}

				// Find the next start code to delimit this NALU.
				sc2 := findSC(buf, dataStart)
				if sc2 < 0 {
					break // need more data
				}

				// Trim trailing zero bytes (padding between NALUs).
				end := sc2
				for end > dataStart && buf[end-1] == 0 {
					end--
				}

				emitNALU(buf[dataStart:end])
				scPos = sc2
			}

			// Compact: keep only from scPos onward to prevent unbounded growth.
			if scPos > 0 {
				copy(buf, buf[scPos:])
				buf = buf[:len(buf)-scPos]
				scPos = 0
			} else if scPos < 0 {
				buf = buf[:0]
			}
		}
		if readErr != nil {
			// Emit the last NALU (no trailing start code needed).
			if scPos >= 0 {
				dataStart := scPos + 3
				if dataStart < len(buf) && buf[scPos+2] == 0 {
					dataStart = scPos + 4
				}
				if dataStart < len(buf) {
					emitNALU(buf[dataStart:])
				}
			}
			flush()
			break
		}
	}

	err = cmd.Wait()
	if err != nil && stderrBuf.Len() > 0 {
		slog.Error("whep: ffmpeg stderr", "args", args, "output", stderrBuf.String())
	}
	return err
}

// resolvedEncoder caches the result of probing which H264 encoder actually works.
var resolvedEncoder = sync.OnceValue(func() string {
	ffmpegPath, err := findFFmpeg()
	if err != nil {
		return "libx264"
	}

	probeCmd := exec.Command(ffmpegPath, "-hide_banner", "-encoders")
	executil.HideWindow(probeCmd)
	out, _ := probeCmd.Output()
	encoders := string(out)

	// Try each hw encoder with a quick null-encode.
	candidates := []struct {
		name string
		args []string
	}{
		{"h264_videotoolbox", []string{
			"-hide_banner", "-loglevel", "error",
			"-f", "lavfi", "-i", "color=black:s=64x64:d=0.1",
			"-c:v", "h264_videotoolbox", "-frames:v", "1", "-f", "null", "-",
		}},
		{"h264_vaapi", []string{
			"-hide_banner", "-loglevel", "error",
			"-hwaccel", "vaapi", "-hwaccel_output_format", "vaapi",
			"-hwaccel_device", "/dev/dri/renderD128",
			"-f", "lavfi", "-i", "color=black:s=64x64:d=0.1",
			"-c:v", "h264_vaapi", "-frames:v", "1", "-f", "null", "-",
		}},
		{"h264_nvenc", []string{
			"-hide_banner", "-loglevel", "error",
			"-f", "lavfi", "-i", "color=black:s=64x64:d=0.1",
			"-c:v", "h264_nvenc", "-frames:v", "1", "-f", "null", "-",
		}},
		{"h264_qsv", []string{
			"-hide_banner", "-loglevel", "error",
			"-f", "lavfi", "-i", "color=black:s=64x64:d=0.1",
			"-c:v", "h264_qsv", "-frames:v", "1", "-f", "null", "-",
		}},
	}

	for _, c := range candidates {
		if !strings.Contains(encoders, c.name) {
			continue
		}
		testCmd := exec.Command(ffmpegPath, c.args...)
		executil.HideWindow(testCmd)
		if testCmd.Run() == nil {
			slog.Info("whep: using hardware encoder", "encoder", c.name)
			return c.name
		}
	}

	slog.Info("whep: no hardware encoder available, using libx264")
	return "libx264"
})

// captureInputArgs returns the ffmpeg input flags for the current platform.
func captureInputArgs(devicePath string) []string {
	if runtime.GOOS == "darwin" {
		// avfoundation expects "<video>:none" for video-only capture.
		return []string{"-f", "avfoundation", "-framerate", "30", "-i", devicePath + ":none"}
	}
	return []string{"-f", "v4l2", "-i", devicePath}
}

// buildH264EncodeArgs returns ffmpeg args to encode H264 from a camera device.
func buildH264EncodeArgs(ffmpegPath, devicePath string) []string {
	enc := resolvedEncoder()

	input := captureInputArgs(devicePath)
	base := append([]string{"-hide_banner", "-loglevel", "error"}, input...)
	base = append(base, "-pix_fmt", "yuv420p")

	switch enc {
	case "h264_videotoolbox":
		return append(base,
			"-c:v", "h264_videotoolbox",
			"-realtime", "1",
			"-g", "30",
			"-f", "h264", "pipe:1",
		)
	case "h264_vaapi":
		vaapi := append([]string{
			"-hide_banner", "-loglevel", "error",
			"-hwaccel", "vaapi",
			"-hwaccel_output_format", "vaapi",
			"-hwaccel_device", "/dev/dri/renderD128",
		}, input...)
		return append(vaapi,
			"-c:v", "h264_vaapi",
			"-g", "30",
			"-f", "h264", "pipe:1",
		)
	case "h264_nvenc":
		return append(base,
			"-c:v", "h264_nvenc",
			"-preset", "p1",
			"-tune", "ull",
			"-g", "30",
			"-f", "h264", "pipe:1",
		)
	case "h264_qsv":
		return append(base,
			"-c:v", "h264_qsv",
			"-preset", "veryfast",
			"-g", "30",
			"-f", "h264", "pipe:1",
		)
	default:
		return append(base,
			"-c:v", "libx264",
			"-profile:v", "baseline",
			"-preset", "ultrafast",
			"-b:v", "2M",
			"-g", "30",
			"-keyint_min", "30",
			"-x264-params", "bframes=0:rc-lookahead=0:sync-lookahead=0:threads=1:scenecut=0",
			"-f", "h264", "pipe:1",
		)
	}
}

func findSC(buf []byte, off int) int {
	for i := off; i+2 < len(buf); i++ {
		if buf[i] == 0 && buf[i+1] == 0 && (buf[i+2] == 1 || (i+3 < len(buf) && buf[i+2] == 0 && buf[i+3] == 1)) {
			return i
		}
	}
	return -1
}

// AddPeer creates a new WebRTC PeerConnection, adds the shared video track,
// performs SDP negotiation, and returns the SDP answer.
func (b *Bridge) AddPeer(offerSDP string) (string, error) {
	codecName := b.codec[strings.Index(b.codec, "/")+1:]
	if !strings.Contains(strings.ToUpper(offerSDP), strings.ToUpper(codecName)) {
		return "", fmt.Errorf("browser does not support %s (camera codec), try configuring the camera to H264", b.codec)
	}

	pc, err := b.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return "", fmt.Errorf("create peer connection: %w", err)
	}

	rtpSender, err := pc.AddTrack(b.videoTrack)
	if err != nil {
		pc.Close()
		return "", fmt.Errorf("add track: %w", err)
	}

	go func() {
		for {
			pkts, _, err := rtpSender.ReadRTCP()
			if err != nil {
				return
			}
			for _, p := range pkts {
				switch p.(type) {
				case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
					b.requestKeyframe()
				}
			}
		}
	}()

	offer := webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offerSDP}
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

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		slog.Debug("whep: peer connection state", "peer", peerID, "state", state.String())
		if state == webrtc.PeerConnectionStateConnected {
			b.mu.Lock()
			kf := b.cachedKeyframe
			kfDur := b.cachedKeyframeDuration
			b.mu.Unlock()
			if len(kf) > 0 {
				_ = b.videoTrack.WriteSample(media.Sample{Data: kf, Duration: kfDur})
			}
			b.requestKeyframe()
		}
		if state == webrtc.PeerConnectionStateDisconnected ||
			state == webrtc.PeerConnectionStateFailed ||
			state == webrtc.PeerConnectionStateClosed {
			b.removePeer(peerID)
		}
	})

	slog.Debug("whep: peer added", "peer", peerID)

	answerSDP := pc.LocalDescription().SDP
	if b.codec == webrtc.MimeTypeH264 {
		answerSDP = injectH264Params(answerSDP, b.sourceSPS, b.sourcePPS)
	}
	return answerSDP, nil
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
	isEmpty := len(b.peers) == 0 && len(b.rtpTaps) == 0
	b.mu.Unlock()

	slog.Debug("whep: peer removed", "peer", peerID, "isEmpty", isEmpty)

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

	slog.Debug("whep: no consumers, starting grace period")
	b.graceTimer = time.AfterFunc(gracePeriod, func() {
		b.mu.Lock()
		if len(b.peers) > 0 || len(b.rtpTaps) > 0 {
			b.graceTimer = nil
			b.mu.Unlock()
			return
		}
		b.mu.Unlock()

		slog.Debug("whep: grace period expired, closing source")
		if b.rtspClient != nil {
			b.rtspClient.Close()
		}
		if b.cancel != nil {
			b.cancel()
		}
		if b.onEmpty != nil {
			b.onEmpty()
		}
	})
}

func (b *Bridge) close() {
	b.closeAllPeers()
	if b.rtspClient != nil {
		b.rtspClient.Close()
	}
	if b.cancel != nil {
		b.cancel()
	}
}

func (b *Bridge) cancelGrace() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.graceTimer != nil {
		b.graceTimer.Stop()
		b.graceTimer = nil
	}
}
