package simcam

import (
	"context"
	"errors"
	"net/http"
	"sync"

	"github.com/projectqai/hydris/builtin"
)

const (
	streamWidth  = 640
	streamHeight = 360
	jpegQuality  = 75
)

var errStoreClosed = errors.New("frame store closed")

// frameStore holds the latest JPEG for one camera and wakes HTTP clients
// when a new one lands. All clients share the same bytes. It also counts
// viewers so the camera only renders while someone is watching.
type frameStore struct {
	mu      sync.Mutex
	frame   []byte
	seq     uint64
	waiters []chan struct{}
	closed  bool
	viewers int
	// joined is signalled when a viewer connects so the camera can render a
	// fresh frame immediately.
	joined chan struct{}
}

func newFrameStore() *frameStore {
	return &frameStore{joined: make(chan struct{}, 1)}
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
	defer fs.mu.Unlock()
	return fs.frame, fs.seq
}

// wait blocks until a frame newer than lastSeq is available, ctx is done,
// or the store is closed.
func (fs *frameStore) wait(ctx context.Context, lastSeq uint64) ([]byte, uint64, error) {
	fs.mu.Lock()
	if fs.closed {
		fs.mu.Unlock()
		return nil, 0, errStoreClosed
	}
	if fs.seq > lastSeq {
		f, s := fs.frame, fs.seq
		fs.mu.Unlock()
		return f, s, nil
	}
	ch := make(chan struct{})
	fs.waiters = append(fs.waiters, ch)
	fs.mu.Unlock()

	select {
	case <-ctx.Done():
		return nil, 0, ctx.Err()
	case <-ch:
		return fs.wait(ctx, lastSeq)
	}
}

func (fs *frameStore) addViewer() {
	fs.mu.Lock()
	fs.viewers++
	fs.mu.Unlock()
	signalDirty(fs.joined)
}

func (fs *frameStore) removeViewer() {
	fs.mu.Lock()
	fs.viewers--
	fs.mu.Unlock()
}

func (fs *frameStore) hasViewers() bool {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	return fs.viewers > 0
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

var (
	regMu  sync.Mutex
	stores = make(map[string]*frameStore)
)

func ensureMounted() {
	builtin.PluginHandleFunc(controllerName, "GET /cam/{id}", handleMJPEG)
}

func registerFrameStore(id string, fs *frameStore) {
	regMu.Lock()
	stores[id] = fs
	regMu.Unlock()
}

// unregisterFrameStore removes fs only if it is still the registered store
// for id, so a late teardown can never unregister its successor.
func unregisterFrameStore(id string, fs *frameStore) {
	regMu.Lock()
	if stores[id] == fs {
		delete(stores, id)
	}
	regMu.Unlock()
	fs.stop()
}

// instances tracks the running instance of each camera. controller.Run
// starts a new instance on config changes without waiting for the old one
// to return, so runCamera waits for the predecessor's teardown (which
// expires its focal point and detections) before taking over.
var instances = make(map[string]chan struct{})

// claimInstance blocks until no other instance of camera id is running. The
// returned release must be called once this instance has fully shut down.
func claimInstance(ctx context.Context, id string) (release func(), err error) {
	for {
		regMu.Lock()
		prev := instances[id]
		if prev == nil {
			done := make(chan struct{})
			instances[id] = done
			regMu.Unlock()
			return func() {
				regMu.Lock()
				delete(instances, id)
				regMu.Unlock()
				close(done)
			}, nil
		}
		regMu.Unlock()
		select {
		case <-prev:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func getFrameStore(id string) *frameStore {
	regMu.Lock()
	defer regMu.Unlock()
	return stores[id]
}

func streamURL(id string) string {
	return builtin.PluginPath(controllerName, "cam/"+id)
}

func handleMJPEG(w http.ResponseWriter, r *http.Request) {
	fs := getFrameStore(r.PathValue("id"))
	if fs == nil {
		http.NotFound(w, r)
		return
	}
	fs.addViewer()
	defer fs.removeViewer()

	const boundary = "simcamframe"
	hdr := w.Header()
	hdr.Set("Content-Type", "multipart/x-mixed-replace; boundary="+boundary)
	hdr.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	hdr.Set("Pragma", "no-cache")
	hdr.Set("Connection", "close")
	hdr.Set("X-Accel-Buffering", "no")

	// Each frame is followed immediately by the next part's boundary and
	// headers. Browsers only display a part once they have parsed the next
	// part's headers; with the boundary sent at the start of the next frame,
	// every frame would stay invisible until its successor arrived (a full
	// frame behind the detections, a second when idle). Content-Length is
	// therefore omitted: parts are delimited by the boundary alone.
	partHeader := []byte("\r\n--" + boundary + "\r\nContent-Type: image/jpeg\r\n\r\n")
	flusher, _ := w.(http.Flusher)
	write := func(b ...[]byte) bool {
		for _, p := range b {
			if _, err := w.Write(p); err != nil {
				return false
			}
		}
		if flusher != nil {
			flusher.Flush()
		}
		return true
	}
	if !write(partHeader[2:]) {
		return
	}

	// Send whatever we have straight away; a fresh frame follows as soon as
	// the camera notices the new viewer.
	frame, seq := fs.latest()
	if frame != nil && !write(frame, partHeader) {
		return
	}
	for {
		var err error
		if frame, seq, err = fs.wait(r.Context(), seq); err != nil {
			return
		}
		// Slow clients skip straight to the newest frame instead of queueing,
		// which keeps latency bounded.
		if !write(frame, partHeader) {
			return
		}
	}
}
