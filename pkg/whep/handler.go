package whep

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
}

// Handler is the HTTP handler for WHEP requests.
type Handler struct {
	lookup  EntityLookup
	bridges *BridgeManager
}

func NewHandler(lookup EntityLookup) *Handler {
	return &Handler{
		lookup:  lookup,
		bridges: NewBridgeManager(),
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	entityID := r.PathValue("entityId")
	cameraIndexStr := r.PathValue("cameraIndex")
	cameraIndex, err := strconv.Atoi(cameraIndexStr)
	if err != nil {
		http.Error(w, "invalid camera index", http.StatusBadRequest)
		return
	}

	entity := h.lookup.GetHead(entityID)
	if entity == nil || entity.Camera == nil {
		http.Error(w, "entity not found or has no camera", http.StatusNotFound)
		return
	}
	if cameraIndex < 0 || cameraIndex >= len(entity.Camera.Streams) {
		http.Error(w, "camera index out of range", http.StatusNotFound)
		return
	}
	cam := entity.Camera.Streams[cameraIndex]
	if cam.Url == "" {
		http.Error(w, "camera has no URL", http.StatusBadRequest)
		return
	}

	offerSDP, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "failed to read offer", http.StatusBadRequest)
		return
	}

	bridgeKey := entityID + "/" + cameraIndexStr
	bridge, err := h.bridges.GetOrCreate(bridgeKey, cam.Url)
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
