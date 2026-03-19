package webcam

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
)

// streamer manages webcam capture and serves MJPEG/snapshot streams via the
// engine's shared HTTP mux. Cameras are lazily opened on first subscriber
// and closed after a grace period when the last subscriber disconnects.
type streamer struct {
	logger  *slog.Logger
	onError func(id string, err error) // called when capture fails

	mu      sync.Mutex
	cameras map[string]*cameraState // keyed by device stable ID
}

type subscriber struct {
	ch chan []byte
}

type cameraState struct {
	info   webcamInfo
	cancel context.CancelFunc // cancels the capture goroutine (nil if not capturing)

	// subscribers holds per-connection channels for fan-out.
	subscribers map[*subscriber]struct{}

	// lastFrame holds the most recent frame for snapshot requests.
	lastFrame []byte

	// graceTimer fires to stop capture after the last subscriber disconnects.
	graceTimer *time.Timer
}

func newStreamer(logger *slog.Logger, onError func(id string, err error)) *streamer {
	s := &streamer{
		logger:  logger,
		onError: onError,
		cameras: make(map[string]*cameraState),
	}

	// Register handlers on the engine's shared HTTP mux.
	builtin.HandleFunc("/media/webcam/stream/", s.handleStream)
	builtin.HandleFunc("/media/webcam/snapshot/", s.handleSnapshot)

	logger.Info("webcam streamer registered on engine mux")
	return s
}

func (s *streamer) close() {
	s.mu.Lock()
	for _, cs := range s.cameras {
		if cs.cancel != nil {
			cs.cancel()
		}
		if cs.graceTimer != nil {
			cs.graceTimer.Stop()
		}
	}
	s.mu.Unlock()
}

// register adds a camera to the streamer and returns the MediaStream entries
// for its CameraComponent. The camera is not opened until a client connects.
func (s *streamer) register(id string, info webcamInfo) []*pb.MediaStream {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cameras[id] = &cameraState{
		info:        info,
		subscribers: make(map[*subscriber]struct{}),
	}

	streams := []*pb.MediaStream{
		{
			Label:    "Live Stream",
			Url:      "v4l2://" + info.DevicePath,
			Protocol: pb.MediaStreamProtocol_MediaStreamProtocolWebrtc,
			Codec:    "H264",
			Role:     pb.MediaStreamRole_MediaStreamRoleMain,
		},
		{
			Label:    "RTSP",
			Url:      "v4l2://" + info.DevicePath,
			Protocol: pb.MediaStreamProtocol_MediaStreamProtocolRtsp,
			Codec:    "H264",
		},
		{
			Label:    "Snapshot",
			Url:      fmt.Sprintf("http://%s/media/webcam/snapshot/%s", builtin.ServerURL, id),
			Protocol: pb.MediaStreamProtocol_MediaStreamProtocolImage,
			Role:     pb.MediaStreamRole_MediaStreamRoleSnapshot,
		},
	}

	return streams
}

// unregister removes a camera and stops any active capture.
func (s *streamer) unregister(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cs, ok := s.cameras[id]
	if !ok {
		return
	}
	if cs.cancel != nil {
		cs.cancel()
	}
	if cs.graceTimer != nil {
		cs.graceTimer.Stop()
	}
	delete(s.cameras, id)
}

// handleStream serves an MJPEG multipart stream for a specific camera.
func (s *streamer) handleStream(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/media/webcam/stream/")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	sub := &subscriber{ch: make(chan []byte, 2)}

	s.mu.Lock()
	cs, ok := s.cameras[id]
	if !ok {
		s.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	cs.subscribers[sub] = struct{}{}
	if cs.graceTimer != nil {
		cs.graceTimer.Stop()
		cs.graceTimer = nil
	}
	if cs.cancel == nil {
		s.startCapture(id, cs)
	}
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(cs.subscribers, sub)
		if len(cs.subscribers) == 0 {
			cs.graceTimer = time.AfterFunc(2*time.Second, func() {
				s.mu.Lock()
				defer s.mu.Unlock()
				if len(cs.subscribers) == 0 && cs.cancel != nil {
					s.logger.Info("stopping idle capture", "id", id)
					cs.cancel()
					cs.cancel = nil
				}
			})
		}
		s.mu.Unlock()
	}()

	const boundary = "frame"
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+boundary)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "close")

	flusher, _ := w.(http.Flusher)

	for {
		select {
		case <-r.Context().Done():
			return
		case frame, ok := <-sub.ch:
			if !ok {
				return
			}
			_, err := fmt.Fprintf(w, "--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n", boundary, len(frame))
			if err != nil {
				return
			}
			if _, err := w.Write(frame); err != nil {
				return
			}
			if _, err := io.WriteString(w, "\r\n"); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

// handleSnapshot serves a single JPEG frame from a camera.
func (s *streamer) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/media/webcam/snapshot/")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	s.mu.Lock()
	cs, ok := s.cameras[id]
	if !ok {
		s.mu.Unlock()
		http.NotFound(w, r)
		return
	}

	// If capture is running and we have a recent frame, use it.
	if cs.cancel != nil && cs.lastFrame != nil {
		frame := cs.lastFrame
		s.mu.Unlock()
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(frame)))
		_, _ = w.Write(frame)
		return
	}

	// Capture is not running — do a one-shot capture.
	s.mu.Unlock()
	frame, err := captureOneFrame(cs.info)
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(frame)))
	_, _ = w.Write(frame)
}

// startCapture starts MJPEG capture for a camera. Must be called with s.mu held.
func (s *streamer) startCapture(id string, cs *cameraState) {
	ctx, cancel := context.WithCancel(context.Background())
	cs.cancel = cancel

	go func() {
		s.logger.Info("starting MJPEG capture", "id", id, "device", cs.info.DevicePath)
		err := captureFrames(ctx, s.logger, cs.info, func(frame []byte) {
			s.mu.Lock()
			cs.lastFrame = frame
			for sub := range cs.subscribers {
				select {
				case sub.ch <- frame:
				default:
				}
			}
			s.mu.Unlock()
		})
		if err != nil && ctx.Err() == nil {
			s.logger.Error("capture error", "id", id, "error", err)
			if s.onError != nil {
				s.onError(id, err)
			}
		}
	}()
}
