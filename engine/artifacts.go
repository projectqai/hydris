package engine

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"connectrpc.com/connect"
	"github.com/projectqai/hydris/builtin/artifacts"
	pb "github.com/projectqai/proto/go"
)

func handleArtifactGet(engine *WorldServer) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		resp, err := engine.GetEntity(r.Context(), connect.NewRequest(&pb.GetEntityRequest{Id: id}))
		if err != nil || resp.Msg.Entity == nil || resp.Msg.Entity.Artifact == nil {
			http.NotFound(w, r)
			return
		}
		art := resp.Msg.Entity.Artifact

		rc, err := artifacts.Server.Local().Get(r.Context(), art.Id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer rc.Close()

		if art.ContentType != "" {
			w.Header().Set("Content-Type", art.ContentType)
		} else {
			w.Header().Set("Content-Type", "application/octet-stream")
		}
		if art.SizeBytes != nil {
			w.Header().Set("Content-Length", strconv.FormatInt(*art.SizeBytes, 10))
		}
		io.Copy(w, rc)
	})
}

func handleArtifactPost() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := artifacts.Server.WriteArtifact(r.Context(), id, r.Body); err != nil {
			slog.Error("artifact upload failed", "entity", id, "error", err)
			status := http.StatusInternalServerError
			var ce *connect.Error
			if errors.As(err, &ce) {
				switch ce.Code() {
				case connect.CodeNotFound:
					status = http.StatusNotFound
				case connect.CodeResourceExhausted:
					status = http.StatusInsufficientStorage
				}
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
