package media

import (
	"bufio"
	"bytes"
	"fmt"
	"image/jpeg"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/bluenviron/gortsplib/v5"
	"github.com/bluenviron/gortsplib/v5/pkg/base"
	"github.com/bluenviron/gortsplib/v5/pkg/description"
	"github.com/bluenviron/gortsplib/v5/pkg/format"
	"github.com/bluenviron/gortsplib/v5/pkg/format/rtph264"
	"github.com/bluenviron/gortsplib/v5/pkg/format/rtpmjpeg"
	"github.com/bluenviron/mediacommon/v2/pkg/codecs/h264"
	"github.com/pion/rtp"
	pb "github.com/projectqai/proto/go"
)

// RTSPServer relays camera streams from entities as an RTSP server.
// Clients connect to rtsp://host:port/media/rtsp/{entityId}/{cameraIndex}.
// Supports both RTSP sources (direct relay) and HTTP MJPEG sources
// (fetches MJPEG, packetizes as RTP/JPEG).
type RTSPServer struct {
	lookup          EntityLookup
	bridges         *BridgeManager
	server          *gortsplib.Server
	isRemoteAllowed func() bool // returns true if remote access is enabled

	mu       sync.Mutex
	streams  map[string]*rtspStreamState         // keyed by "entityId/cameraIndex"
	sessions map[*gortsplib.ServerSession]string // session → stream key
}

type rtspStreamState struct {
	key       string
	sourceURL string
	client    *gortsplib.Client // non-nil for RTSP sources
	cancel    func()            // non-nil for HTTP sources (stops the fetcher goroutine)
	stream    *gortsplib.ServerStream
	refCount  int // number of active sessions using this stream
}

// NewRTSPServer creates an RTSP relay server.
// isRemoteAllowed is called on each connection to check if non-loopback access is permitted.
func NewRTSPServer(lookup EntityLookup, bridges *BridgeManager, isRemoteAllowed func() bool) *RTSPServer {
	return &RTSPServer{
		lookup:          lookup,
		bridges:         bridges,
		isRemoteAllowed: isRemoteAllowed,
		streams:         make(map[string]*rtspStreamState),
		sessions:        make(map[*gortsplib.ServerSession]string),
	}
}

// Start starts the RTSP server using the provided listener.
// UDP RTP/RTCP need consecutive even/odd ports. We pick the nearest
// even port at or above the TCP port.
func (rs *RTSPServer) Start(ln net.Listener) error {
	addr := ln.Addr().(*net.TCPAddr)
	rtpPort := addr.Port
	if rtpPort%2 != 0 {
		rtpPort++
	}

	rs.server = &gortsplib.Server{
		Handler:        rs,
		RTSPAddress:    addr.String(),
		UDPRTPAddress:  fmt.Sprintf(":%d", rtpPort),
		UDPRTCPAddress: fmt.Sprintf(":%d", rtpPort+1),
		Listen: func(_, _ string) (net.Listener, error) {
			return ln, nil
		},
	}
	return rs.server.Start()
}

// Close shuts down the RTSP server.
func (rs *RTSPServer) Close() {
	if rs.server != nil {
		rs.server.Close()
	}
	rs.mu.Lock()
	for _, st := range rs.streams {
		rs.closeStreamLocked(st)
	}
	rs.mu.Unlock()
}

func (rs *RTSPServer) closeStreamLocked(st *rtspStreamState) {
	if st.client != nil {
		st.client.Close()
	}
	if st.cancel != nil {
		st.cancel()
	}
	if st.stream != nil {
		st.stream.Close()
	}
}

// parsePath extracts entityId and cameraIndex from RTSP paths like:
//
//	media/rtsp/{entityId}
//	media/rtsp/{entityId}/trackID=0
//
// Camera index is passed as query parameter ?stream=N (default 0).
func parsePath(path string, query string) (entityID string, cameraIndex int, err error) {
	path = strings.TrimPrefix(path, "/")
	const prefix = "media/rtsp/"
	if !strings.HasPrefix(path, prefix) {
		return "", 0, fmt.Errorf("invalid RTSP path: %s", path)
	}
	entityID = strings.TrimPrefix(path, prefix)

	// Strip trailing /trackID=N segment appended by gortsplib for SETUP.
	if i := strings.Index(entityID, "/trackID="); i >= 0 {
		entityID = entityID[:i]
	}
	if entityID == "" {
		return "", 0, fmt.Errorf("missing entity ID in path: %s", path)
	}

	// Parse stream index from query string.
	if query != "" {
		for _, part := range strings.Split(query, "&") {
			if strings.HasPrefix(part, "stream=") {
				if idx, err := strconv.Atoi(strings.TrimPrefix(part, "stream=")); err == nil {
					return entityID, idx, nil
				}
			}
		}
	}

	return entityID, 0, nil
}

func streamKey(entityID string, cameraIndex int) string {
	return entityID + "/" + strconv.Itoa(cameraIndex)
}

// getOrCreateStream creates or returns an existing stream for the given entity camera.
func (rs *RTSPServer) getOrCreateStream(entityID string, cameraIndex int) (*rtspStreamState, error) {
	key := streamKey(entityID, cameraIndex)

	rs.mu.Lock()
	if st, ok := rs.streams[key]; ok {
		rs.mu.Unlock()
		return st, nil
	}
	rs.mu.Unlock()

	// Look up entity to get source URL and protocol.
	entity := rs.lookup.GetHead(entityID)
	if entity == nil || entity.Camera == nil {
		return nil, fmt.Errorf("entity not found or has no camera")
	}
	if len(entity.Camera.Streams) == 0 {
		return nil, fmt.Errorf("entity has no streams")
	}

	// If cameraIndex is 0 and not explicitly set, find the best stream
	// (prefer RTSP, then MJPEG, then anything).
	if cameraIndex == 0 {
		for i, s := range entity.Camera.Streams {
			if s.Protocol == pb.MediaStreamProtocol_MediaStreamProtocolRtsp {
				cameraIndex = i
				break
			}
		}
	}
	if cameraIndex < 0 || cameraIndex >= len(entity.Camera.Streams) {
		return nil, fmt.Errorf("camera index out of range")
	}
	stream := entity.Camera.Streams[cameraIndex]

	// Use the original source URL (before the media transform rewrote it).
	sourceURL := rs.lookup.GetSourceURL(entityID, cameraIndex)
	if sourceURL == "" {
		sourceURL = stream.Url
	}
	if sourceURL == "" {
		return nil, fmt.Errorf("camera has no URL")
	}

	u, err := url.Parse(sourceURL)
	if err != nil {
		return nil, fmt.Errorf("parse source URL: %w", err)
	}

	switch u.Scheme {
	case "rtsp", "rtsps":
		return rs.createRTSPRelay(key, sourceURL)
	case "v4l2":
		return rs.createV4L2Relay(key, sourceURL)
	case "http", "https":
		if stream.Codec == "H264" || stream.Protocol == pb.MediaStreamProtocol_MediaStreamProtocolRtsp {
			return rs.createH264Relay(key, sourceURL)
		}
		return rs.createMJPEGRelay(key, sourceURL, stream.Protocol)
	default:
		return nil, fmt.Errorf("unsupported source scheme: %s", u.Scheme)
	}
}

// createRTSPRelay connects to an RTSP source and relays packets.
func (rs *RTSPServer) createRTSPRelay(key, sourceURL string) (*rtspStreamState, error) {
	u, err := base.ParseURL(sourceURL)
	if err != nil {
		return nil, fmt.Errorf("parse RTSP URL: %w", err)
	}

	c := &gortsplib.Client{Scheme: u.Scheme, Host: u.Host}
	if err := c.Start(); err != nil {
		return nil, fmt.Errorf("RTSP connect: %w", err)
	}

	desc, _, err := c.Describe(u)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("RTSP DESCRIBE: %w", err)
	}

	for _, media := range desc.Medias {
		if _, err := c.Setup(desc.BaseURL, media, 0, 0); err != nil {
			c.Close()
			return nil, fmt.Errorf("RTSP SETUP: %w", err)
		}
	}

	serverStream := &gortsplib.ServerStream{Server: rs.server, Desc: desc}
	if err := serverStream.Initialize(); err != nil {
		c.Close()
		return nil, fmt.Errorf("init server stream: %w", err)
	}

	c.OnPacketRTPAny(func(m *description.Media, _ format.Format, pkt *rtp.Packet) {
		_ = serverStream.WritePacketRTP(m, pkt)
	})

	if _, err = c.Play(nil); err != nil {
		serverStream.Close()
		c.Close()
		return nil, fmt.Errorf("RTSP PLAY: %w", err)
	}

	st := &rtspStreamState{key: key, sourceURL: sourceURL, client: c, stream: serverStream}

	rs.mu.Lock()
	if existing, ok := rs.streams[key]; ok {
		rs.mu.Unlock()
		serverStream.Close()
		c.Close()
		return existing, nil
	}
	rs.streams[key] = st
	rs.mu.Unlock()

	slog.Debug("rtsp relay: RTSP stream created", "key", key)

	go func() {
		err := c.Wait()
		if err != nil {
			slog.Warn("rtsp relay: RTSP source closed", "key", key, "error", err)
		}
		rs.mu.Lock()
		delete(rs.streams, key)
		rs.mu.Unlock()
		serverStream.Close()
	}()

	return st, nil
}

// createV4L2Relay taps into the shared Bridge (which already runs ffmpeg)
// and forwards RTP packets to the RTSP ServerStream. No separate ffmpeg process.
func (rs *RTSPServer) createV4L2Relay(key, sourceURL string) (*rtspStreamState, error) {
	bridge, err := rs.bridges.GetOrCreate(key, sourceURL)
	if err != nil {
		return nil, fmt.Errorf("get bridge: %w", err)
	}

	h264Format := &format.H264{PayloadTyp: 96, PacketizationMode: 1}
	if sps := bridge.SPS(); sps != nil {
		if pps := bridge.PPS(); pps != nil {
			h264Format.SPS = sps
			h264Format.PPS = pps
		}
	}
	h264Media := &description.Media{
		Type:    description.MediaTypeVideo,
		Formats: []format.Format{h264Format},
	}
	desc := &description.Session{Medias: []*description.Media{h264Media}}

	serverStream := &gortsplib.ServerStream{Server: rs.server, Desc: desc}
	if err := serverStream.Initialize(); err != nil {
		return nil, fmt.Errorf("init server stream: %w", err)
	}

	tapKey := "rtsp-" + key
	bridge.OnRTP(tapKey, func(pkt *rtp.Packet) {
		_ = serverStream.WritePacketRTP(h264Media, pkt)
	})

	st := &rtspStreamState{
		key:       key,
		sourceURL: sourceURL,
		stream:    serverStream,
		cancel:    func() { bridge.OffRTP(tapKey) },
	}

	rs.mu.Lock()
	if existing, ok := rs.streams[key]; ok {
		rs.mu.Unlock()
		bridge.OffRTP(tapKey)
		serverStream.Close()
		return existing, nil
	}
	rs.streams[key] = st
	rs.mu.Unlock()

	slog.Info("rtsp relay: tapped into bridge", "key", key)
	return st, nil
}

// createMJPEGRelay fetches an HTTP MJPEG stream and serves it as RTSP
// using RTP/JPEG (RFC 2435) packetization.
func (rs *RTSPServer) createMJPEGRelay(key, sourceURL string, proto pb.MediaStreamProtocol) (*rtspStreamState, error) {
	// Build the RTSP media description for MJPEG. key is stored for session tracking.
	mjpegFormat := &format.MJPEG{}
	mjpegMedia := &description.Media{
		Type:    description.MediaTypeVideo,
		Formats: []format.Format{mjpegFormat},
	}
	desc := &description.Session{Medias: []*description.Media{mjpegMedia}}

	serverStream := &gortsplib.ServerStream{Server: rs.server, Desc: desc}
	if err := serverStream.Initialize(); err != nil {
		return nil, fmt.Errorf("init server stream: %w", err)
	}

	encoder, err := mjpegFormat.CreateEncoder()
	if err != nil {
		serverStream.Close()
		return nil, fmt.Errorf("create MJPEG encoder: %w", err)
	}

	done := make(chan struct{})
	st := &rtspStreamState{
		key:       key,
		sourceURL: sourceURL,
		stream:    serverStream,
		cancel:    func() { close(done) },
	}

	rs.mu.Lock()
	if existing, ok := rs.streams[key]; ok {
		rs.mu.Unlock()
		serverStream.Close()
		return existing, nil
	}
	rs.streams[key] = st
	rs.mu.Unlock()

	slog.Debug("rtsp relay: MJPEG stream created", "key", key)

	// Fetch MJPEG in background and pipe to RTSP.
	go func() {
		defer func() {
			rs.mu.Lock()
			delete(rs.streams, key)
			rs.mu.Unlock()
			serverStream.Close()
		}()

		var ts uint32
		err := rs.fetchMJPEG(sourceURL, proto, mjpegMedia, serverStream, encoder, done, &ts)
		if err != nil {
			slog.Warn("rtsp relay: MJPEG fetch ended", "key", key, "error", err)
		}
	}()

	return st, nil
}

// createH264Relay fetches raw H264 Annex B from an HTTP stream and serves
// it as RTSP using RTP/H264 (RFC 6184) packetization.
func (rs *RTSPServer) createH264Relay(key, sourceURL string) (*rtspStreamState, error) {
	h264Format := &format.H264{
		PayloadTyp:        96,
		PacketizationMode: 1,
	}
	h264Media := &description.Media{
		Type:    description.MediaTypeVideo,
		Formats: []format.Format{h264Format},
	}
	desc := &description.Session{Medias: []*description.Media{h264Media}}

	serverStream := &gortsplib.ServerStream{Server: rs.server, Desc: desc}
	if err := serverStream.Initialize(); err != nil {
		return nil, fmt.Errorf("init server stream: %w", err)
	}

	encoder := &rtph264.Encoder{
		PayloadType:       96,
		PacketizationMode: 1,
	}
	if err := encoder.Init(); err != nil {
		serverStream.Close()
		return nil, fmt.Errorf("create H264 encoder: %w", err)
	}

	done := make(chan struct{})
	st := &rtspStreamState{
		key:       key,
		sourceURL: sourceURL,
		stream:    serverStream,
		cancel:    func() { close(done) },
	}

	rs.mu.Lock()
	if existing, ok := rs.streams[key]; ok {
		rs.mu.Unlock()
		serverStream.Close()
		return existing, nil
	}
	rs.streams[key] = st
	rs.mu.Unlock()

	slog.Debug("rtsp relay: H264 stream created", "key", key)

	go func() {
		defer func() {
			rs.mu.Lock()
			delete(rs.streams, key)
			rs.mu.Unlock()
			serverStream.Close()
		}()

		err := rs.fetchH264(sourceURL, h264Media, h264Format, serverStream, encoder, done)
		if err != nil {
			slog.Warn("rtsp relay: H264 fetch ended", "key", key, "error", err)
		}
	}()

	return st, nil
}

// fetchH264 reads a raw H264 Annex B stream from HTTP and writes RTP packets.
// Uses wall-clock timestamps like gortsplib examples recommend.
func (rs *RTSPServer) fetchH264(
	sourceURL string,
	media *description.Media,
	h264Format *format.H264,
	serverStream *gortsplib.ServerStream,
	encoder *rtph264.Encoder,
	done chan struct{},
) error {
	client := &http.Client{Timeout: 0}

	req, err := http.NewRequest(http.MethodGet, sourceURL, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	if u, err := url.Parse(sourceURL); err == nil && u.User != nil {
		pass, _ := u.User.Password()
		req.SetBasicAuth(u.User.Username(), pass)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP GET: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %s", resp.Status)
	}

	return rs.pipeH264(resp.Body, media, h264Format, serverStream, encoder, done)
}

// pipeH264 reads Annex B H264 from an io.Reader and writes RTP packets.
func (rs *RTSPServer) pipeH264(
	r io.Reader,
	media *description.Media,
	h264Format *format.H264,
	serverStream *gortsplib.ServerStream,
	encoder *rtph264.Encoder,
	done <-chan struct{},
) error {
	var buf []byte
	var pendingAU [][]byte
	hadVCL := false
	var frameCount uint32
	const ptsIncrement = 3600

	flush := func() {
		if len(pendingAU) == 0 {
			return
		}
		for _, nalu := range pendingAU {
			if len(nalu) == 0 {
				continue
			}
			switch h264.NALUType(nalu[0] & 0x1F) {
			case h264.NALUTypeSPS:
				_, pps := h264Format.SafeParams()
				h264Format.SafeSetParams(nalu, pps)
			case h264.NALUTypePPS:
				sps, _ := h264Format.SafeParams()
				h264Format.SafeSetParams(sps, nalu)
			}
		}

		pkts, err := encoder.Encode(pendingAU)
		if err == nil {
			pts := frameCount * ptsIncrement
			frameCount++
			for _, pkt := range pkts {
				pkt.Timestamp = pts
				_ = serverStream.WritePacketRTP(media, pkt)
			}
		}
		pendingAU = nil
		hadVCL = false
	}

	tmp := make([]byte, 32*1024)
	scPos := -1

	for {
		select {
		case <-done:
			return nil
		default:
		}

		n, readErr := r.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)

			for {
				if scPos < 0 {
					sc := findSC(buf, 0)
					if sc < 0 {
						buf = buf[:0]
						break
					}
					scPos = sc
				}

				dataStart := scPos + 3
				if dataStart < len(buf) && buf[scPos+2] == 0 {
					dataStart = scPos + 4
				}

				sc2 := findSC(buf, dataStart)
				if sc2 < 0 {
					break
				}

				end := sc2
				for end > dataStart && buf[end-1] == 0 {
					end--
				}

				nalu := append([]byte(nil), buf[dataStart:end]...)
				scPos = sc2

				if len(nalu) == 0 {
					continue
				}
				typ := h264.NALUType(nalu[0] & 0x1F)
				isVCL := typ >= 1 && typ <= 5

				if hadVCL && (isVCL || typ == h264.NALUTypeSPS) {
					flush()
				}

				pendingAU = append(pendingAU, nalu)
				if isVCL {
					hadVCL = true
				}
			}

			if scPos > 0 {
				copy(buf, buf[scPos:])
				buf = buf[:len(buf)-scPos]
				scPos = 0
			} else if scPos < 0 {
				buf = buf[:0]
			}
		}
		if readErr != nil {
			if scPos >= 0 {
				dataStart := scPos + 3
				if dataStart < len(buf) && buf[scPos+2] == 0 {
					dataStart = scPos + 4
				}
				if dataStart < len(buf) {
					nalu := buf[dataStart:]
					if len(nalu) > 0 {
						typ := h264.NALUType(nalu[0] & 0x1F)
						isVCL := typ >= 1 && typ <= 5
						if hadVCL && (isVCL || typ == h264.NALUTypeSPS) {
							flush()
						}
						pendingAU = append(pendingAU, append([]byte(nil), nalu...))
						if isVCL {
							hadVCL = true
						}
					}
				}
			}
			flush()
			return readErr
		}
	}
}

// fetchMJPEG reads JPEG frames from an HTTP MJPEG stream and writes them
// as RTP packets to the server stream.
func (rs *RTSPServer) fetchMJPEG(
	sourceURL string,
	proto pb.MediaStreamProtocol,
	media *description.Media,
	serverStream *gortsplib.ServerStream,
	encoder *rtpmjpeg.Encoder,
	done chan struct{},
	ts *uint32,
) error {
	client := &http.Client{Timeout: 0} // no timeout for streaming

	req, err := http.NewRequest(http.MethodGet, sourceURL, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	// Extract basic auth from URL.
	if u, err := url.Parse(sourceURL); err == nil && u.User != nil {
		pass, _ := u.User.Password()
		req.SetBasicAuth(u.User.Username(), pass)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP GET: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %s", resp.Status)
	}

	ct := resp.Header.Get("Content-Type")

	// Single image: read one frame and loop with re-fetches.
	if proto == pb.MediaStreamProtocol_MediaStreamProtocolImage ||
		strings.HasPrefix(ct, "image/") {
		frame, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
		if err != nil {
			return err
		}
		return rs.writeJPEGFrame(frame, media, serverStream, encoder, ts)
	}

	// Multipart MJPEG stream.
	_, params, err := mime.ParseMediaType(ct)
	if err != nil {
		// Try reading as raw JPEG stream.
		return rs.readRawMJPEG(resp.Body, media, serverStream, encoder, done, ts)
	}

	boundary := params["boundary"]
	if boundary == "" {
		return rs.readRawMJPEG(resp.Body, media, serverStream, encoder, done, ts)
	}

	mr := multipart.NewReader(resp.Body, boundary)
	for {
		select {
		case <-done:
			return nil
		default:
		}

		part, err := mr.NextPart()
		if err != nil {
			return fmt.Errorf("read multipart: %w", err)
		}

		frame, err := io.ReadAll(io.LimitReader(part, 10<<20))
		_ = part.Close()
		if err != nil {
			return fmt.Errorf("read frame: %w", err)
		}
		if len(frame) == 0 {
			continue
		}

		if err := rs.writeJPEGFrame(frame, media, serverStream, encoder, ts); err != nil {
			slog.Warn("rtsp relay: encode frame", "error", err, "frameLen", len(frame))
		}
	}
}

// readRawMJPEG reads a raw MJPEG byte stream (SOI-delimited JPEG frames).
func (rs *RTSPServer) readRawMJPEG(
	r io.Reader,
	media *description.Media,
	serverStream *gortsplib.ServerStream,
	encoder *rtpmjpeg.Encoder,
	done chan struct{},
	ts *uint32,
) error {
	reader := bufio.NewReaderSize(r, 512*1024)
	var frame bytes.Buffer
	inFrame := false
	tmp := make([]byte, 32*1024)

	for {
		select {
		case <-done:
			return nil
		default:
		}

		n, err := reader.Read(tmp)
		if n > 0 {
			data := tmp[:n]
			for len(data) > 0 {
				if !inFrame {
					idx := bytes.Index(data, []byte{0xFF, 0xD8})
					if idx < 0 {
						break
					}
					inFrame = true
					frame.Reset()
					data = data[idx:]
				}

				idx := bytes.Index(data[2:], []byte{0xFF, 0xD8})
				if idx >= 0 {
					// Found next SOI — everything up to it is the current frame.
					frame.Write(data[:idx+2])
					if err := rs.writeJPEGFrame(frame.Bytes(), media, serverStream, encoder, ts); err != nil {
						slog.Debug("rtsp relay: encode frame", "error", err)
					}
					inFrame = false
					data = data[idx+2:]
				} else {
					frame.Write(data)
					data = nil
				}
			}
		}
		if err != nil {
			return err
		}
	}
}

func (rs *RTSPServer) writeJPEGFrame(
	frame []byte,
	media *description.Media,
	serverStream *gortsplib.ServerStream,
	encoder *rtpmjpeg.Encoder,
	ts *uint32,
) error {
	pkts, err := encoder.Encode(frame)
	if err != nil {
		// Re-encode via Go's image/jpeg to normalize subsampling to 4:2:0.
		pkts, err = rs.reencodeAndPack(frame, encoder)
		if err != nil {
			return err
		}
	}
	for _, pkt := range pkts {
		pkt.Timestamp = *ts
		if err := serverStream.WritePacketRTP(media, pkt); err != nil {
			return err
		}
	}
	*ts += 3000 // ~30fps at 90kHz
	return nil
}

// reencodeAndPack decodes a JPEG, re-encodes it with Go's standard encoder
// (which always produces 4:2:0 baseline), then packetizes it.
func (rs *RTSPServer) reencodeAndPack(frame []byte, encoder *rtpmjpeg.Encoder) ([]*rtp.Packet, error) {
	img, err := jpeg.Decode(bytes.NewReader(frame))
	if err != nil {
		return nil, fmt.Errorf("decode JPEG for re-encode: %w", err)
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		return nil, fmt.Errorf("re-encode JPEG: %w", err)
	}
	return encoder.Encode(buf.Bytes())
}

// OnConnOpen rejects non-loopback connections when remote sharing is disabled.
func (rs *RTSPServer) OnConnOpen(ctx *gortsplib.ServerHandlerOnConnOpenCtx) {
	if rs.isRemoteAllowed != nil && !rs.isRemoteAllowed() {
		addr := ctx.Conn.NetConn().RemoteAddr().String()
		host, _, _ := net.SplitHostPort(addr)
		ip := net.ParseIP(host)
		if ip != nil && !ip.IsLoopback() {
			slog.Debug("rtsp relay: rejecting remote connection", "addr", addr)
			ctx.Conn.Close()
		}
	}
}

// OnDescribe handles DESCRIBE requests.
func (rs *RTSPServer) OnDescribe(ctx *gortsplib.ServerHandlerOnDescribeCtx) (*base.Response, *gortsplib.ServerStream, error) {
	entityID, cameraIndex, err := parsePath(ctx.Path, ctx.Query)
	if err != nil {
		slog.Debug("rtsp relay: bad path", "path", ctx.Path, "error", err)
		return &base.Response{StatusCode: base.StatusBadRequest}, nil, nil
	}

	st, err := rs.getOrCreateStream(entityID, cameraIndex)
	if err != nil {
		slog.Error("rtsp relay: describe failed", "entity", entityID, "error", err)
		return &base.Response{StatusCode: base.StatusNotFound}, nil, nil
	}

	return &base.Response{StatusCode: base.StatusOK}, st.stream, nil
}

// OnSetup handles SETUP requests.
func (rs *RTSPServer) OnSetup(ctx *gortsplib.ServerHandlerOnSetupCtx) (*base.Response, *gortsplib.ServerStream, error) {
	entityID, cameraIndex, err := parsePath(ctx.Path, ctx.Query)
	if err != nil {
		return &base.Response{StatusCode: base.StatusBadRequest}, nil, nil
	}

	st, err := rs.getOrCreateStream(entityID, cameraIndex)
	if err != nil {
		return &base.Response{StatusCode: base.StatusNotFound}, nil, nil
	}

	rs.mu.Lock()
	if _, exists := rs.sessions[ctx.Session]; !exists {
		rs.sessions[ctx.Session] = st.key
		st.refCount++
		slog.Debug("rtsp relay: session opened", "key", st.key, "refCount", st.refCount)
	}
	rs.mu.Unlock()

	return &base.Response{StatusCode: base.StatusOK}, st.stream, nil
}

// OnPlay handles PLAY requests.
func (rs *RTSPServer) OnPlay(_ *gortsplib.ServerHandlerOnPlayCtx) (*base.Response, error) {
	return &base.Response{StatusCode: base.StatusOK}, nil
}

// OnSessionClose handles session disconnection (RTCP timeout, TCP close, TEARDOWN).
func (rs *RTSPServer) OnSessionClose(ctx *gortsplib.ServerHandlerOnSessionCloseCtx) {
	rs.mu.Lock()
	key, ok := rs.sessions[ctx.Session]
	if !ok {
		rs.mu.Unlock()
		return
	}
	delete(rs.sessions, ctx.Session)

	st, exists := rs.streams[key]
	if !exists {
		rs.mu.Unlock()
		return
	}
	st.refCount--
	slog.Debug("rtsp relay: session closed", "key", key, "refCount", st.refCount, "error", ctx.Error)

	if st.refCount <= 0 {
		rs.closeStreamLocked(st)
		delete(rs.streams, key)
	}
	rs.mu.Unlock()
}

var _ gortsplib.ServerHandlerOnConnOpen = (*RTSPServer)(nil)
var _ gortsplib.ServerHandlerOnDescribe = (*RTSPServer)(nil)
var _ gortsplib.ServerHandlerOnSetup = (*RTSPServer)(nil)
var _ gortsplib.ServerHandlerOnPlay = (*RTSPServer)(nil)
var _ gortsplib.ServerHandlerOnSessionClose = (*RTSPServer)(nil)
