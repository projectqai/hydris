package simcam

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/projectqai/hydris/builtin"
)

// poseSnapshot is what the renderer needs to draw a frame. Cameras build one
// from camState; the renderLoop passes it inside a renderContext.
type poseSnapshot struct {
	Pan, Tilt, Zoom float64
	FovDeg          float64
	RangeMax        float64
	Label           string
	Frame           uint64
}

// frameStore holds the latest rendered JPEG and wakes HTTP clients when a new
// frame arrives. Rendering happens once per dirty signal; all connected
// clients share the same bytes.
type frameStore struct {
	mu      sync.Mutex
	frame   []byte
	seq     uint64
	waiters []chan struct{}
	closed  bool
}

func newFrameStore() *frameStore {
	return &frameStore{}
}

func (fs *frameStore) put(jpeg []byte) {
	fs.mu.Lock()
	fs.frame = jpeg
	fs.seq++
	waiters := fs.waiters
	fs.waiters = nil
	fs.mu.Unlock()
	for _, ch := range waiters {
		close(ch)
	}
}

func (fs *frameStore) latest() ([]byte, uint64) {
	fs.mu.Lock()
	f, s := fs.frame, fs.seq
	fs.mu.Unlock()
	return f, s
}

// wait blocks until a frame newer than lastSeq is available, or ctx is done,
// or the store is closed.
func (fs *frameStore) wait(ctx context.Context, lastSeq uint64) ([]byte, uint64, error) {
	fs.mu.Lock()
	if fs.seq > lastSeq {
		f, s := fs.frame, fs.seq
		fs.mu.Unlock()
		return f, s, nil
	}
	if fs.closed {
		fs.mu.Unlock()
		return nil, 0, fmt.Errorf("closed")
	}
	ch := make(chan struct{})
	fs.waiters = append(fs.waiters, ch)
	fs.mu.Unlock()

	select {
	case <-ctx.Done():
		return nil, 0, ctx.Err()
	case <-ch:
		fs.mu.Lock()
		if fs.closed {
			fs.mu.Unlock()
			return nil, 0, fmt.Errorf("closed")
		}
		f, s := fs.frame, fs.seq
		fs.mu.Unlock()
		return f, s, nil
	}
}

func (fs *frameStore) stop() {
	fs.mu.Lock()
	fs.closed = true
	waiters := fs.waiters
	fs.waiters = nil
	fs.mu.Unlock()
	for _, ch := range waiters {
		close(ch)
	}
}

// -- frame store registry -----------------------------------------------------

type frameStoreRegistry struct {
	mu     sync.Mutex
	stores map[string]*frameStore
}

var reg = &frameStoreRegistry{stores: make(map[string]*frameStore)}

func ensureMounted() {
	builtin.PluginHandleFunc(controllerName, "GET /cam/{id}", handleMJPEG)
}

func registerFrameStore(id string, fs *frameStore) {
	reg.mu.Lock()
	reg.stores[id] = fs
	reg.mu.Unlock()
}

func unregisterFrameStore(id string) {
	reg.mu.Lock()
	fs := reg.stores[id]
	delete(reg.stores, id)
	reg.mu.Unlock()
	if fs != nil {
		fs.stop()
	}
}

func getFrameStore(id string) *frameStore {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	return reg.stores[id]
}

func streamURL(id string) string {
	return builtin.PluginPath(controllerName, "cam/"+id)
}

const (
	streamWidth  = 640
	streamHeight = 360
	streamFPS    = 12 // used by live-dot pulse timing
)

func handleMJPEG(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	fs := getFrameStore(id)
	if fs == nil {
		http.NotFound(w, r)
		return
	}

	const boundary = "simcamframe"
	hdr := w.Header()
	hdr.Set("Content-Type", "multipart/x-mixed-replace; boundary="+boundary)
	hdr.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	hdr.Set("Pragma", "no-cache")
	hdr.Set("Connection", "close")

	flusher, _ := w.(http.Flusher)
	ctx := r.Context()

	frame, seq := fs.latest()
	if frame != nil {
		if !writeMJPEGFrame(w, boundary, frame) {
			return
		}
		if flusher != nil {
			flusher.Flush()
		}
	}

	for {
		var err error
		frame, seq, err = fs.wait(ctx, seq)
		if err != nil {
			return
		}
		if !writeMJPEGFrame(w, boundary, frame) {
			return
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
}

func writeMJPEGFrame(w http.ResponseWriter, boundary string, frame []byte) bool {
	header := fmt.Sprintf("--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n",
		boundary, len(frame))
	if _, err := w.Write([]byte(header)); err != nil {
		return false
	}
	if _, err := w.Write(frame); err != nil {
		return false
	}
	if _, err := w.Write([]byte("\r\n")); err != nil {
		return false
	}
	return true
}
