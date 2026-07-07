package mediaserver

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/pkg/media"
	pb "github.com/projectqai/proto/go"
)

type WHEPHandler struct {
	bridges *media.BridgeManager
}

func NewWHEPHandler(bridges *media.BridgeManager) *WHEPHandler {
	return &WHEPHandler{
		bridges: bridges,
	}
}

func getEntity(ctx context.Context, entityID string) *pb.Entity {
	conn, err := builtin.BuiltinClientConn("mediaserver")
	if err != nil {
		return nil
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)
	resp, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: entityID})
	if err != nil {
		return nil
	}
	return resp.Entity
}

func (h *WHEPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	entityID := r.PathValue("entityId")
	entity := getEntity(r.Context(), entityID)
	if entity == nil || entity.Camera == nil {
		http.Error(w, "entity not found or has no camera", http.StatusNotFound)
		return
	}

	cameraIndex, err := media.ResolveStreamIndex(r, entity.Camera.Streams, media.IsVideoStream)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if cameraIndex < 0 {
		http.Error(w, "no suitable stream found", http.StatusNotFound)
		return
	}
	cam := entity.Camera.Streams[cameraIndex]

	offerSDP, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "failed to read offer", http.StatusBadRequest)
		return
	}

	bridgeKey := entityID + "/" + strconv.Itoa(cameraIndex)
	bridge, err := h.bridges.GetOrCreate(bridgeKey, cam.Url)
	if err != nil {
		slog.Error("whep: failed to create bridge", "entity", entityID, "stream", cameraIndex, "url", cam.Url, "error", err)
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
