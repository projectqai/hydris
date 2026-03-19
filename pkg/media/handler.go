package media

import (
	"io"
	"log/slog"
	"net/http"
	"strconv"

	pb "github.com/projectqai/proto/go"
)

// EntityLookup provides entity access without importing the engine package.
type EntityLookup interface {
	GetHead(id string) *pb.Entity
	// GetSourceURL returns the original source URL for a camera stream
	// before the MediaTransformer rewrote it to a proxy URL.
	GetSourceURL(entityID string, streamIndex int) string
}

// Handler is the HTTP handler for WHEP requests.
type Handler struct {
	lookup  EntityLookup
	bridges *BridgeManager
}

func NewHandler(lookup EntityLookup, bridges *BridgeManager) *Handler {
	return &Handler{
		lookup:  lookup,
		bridges: bridges,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	entityID := r.PathValue("entityId")
	entity := h.lookup.GetHead(entityID)
	if entity == nil {
		// Try legacy format: /media/whep/{entityId}/{streamIndex}
		entityID = parseEntityID(r)
		entity = h.lookup.GetHead(entityID)
	}
	if entity == nil || entity.Camera == nil {
		http.Error(w, "entity not found or has no camera", http.StatusNotFound)
		return
	}

	cameraIndex, err := resolveStreamIndex(r, entity.Camera.Streams, isVideoStream)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if cameraIndex < 0 {
		http.Error(w, "no suitable stream found", http.StatusNotFound)
		return
	}
	cam := entity.Camera.Streams[cameraIndex]

	// Use the original source URL (before the media transform rewrote it).
	sourceURL := h.lookup.GetSourceURL(entityID, cameraIndex)
	if sourceURL == "" {
		sourceURL = cam.Url
	}

	offerSDP, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "failed to read offer", http.StatusBadRequest)
		return
	}

	bridgeKey := entityID + "/" + strconv.Itoa(cameraIndex)
	bridge, err := h.bridges.GetOrCreate(bridgeKey, sourceURL)
	if err != nil {
		slog.Error("whep: failed to create bridge", "key", bridgeKey, "error", err)
		http.Error(w, "failed to connect to camera", http.StatusBadGateway)
		return
	}

	answerSDP, err := bridge.AddPeer(string(offerSDP))
	if err != nil {
		slog.Error("whep: failed to add peer", "key", bridgeKey, "error", err)
		http.Error(w, "WebRTC negotiation failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/sdp")
	w.Header().Set("Location", r.URL.String())
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(answerSDP))
}
