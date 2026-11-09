package engine

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"connectrpc.com/connect"
	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/builtin/tileserver"
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

		rc, err := artifacts.Server.OpenBlob(r.Context(), art.Id) //nolint:staticcheck // SA1019: Artifact.Id migration pending
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
		// Media players seek via Range requests and revalidate via ETag; the
		// sha256 is the natural validator. no-cache means "revalidate", not
		// "don't store", so an unchanged blob is served from cache with a 304.
		w.Header().Set("Cache-Control", "no-cache")
		if art.Sha256 != nil && *art.Sha256 != "" {
			w.Header().Set("ETag", `"`+*art.Sha256+`"`)
		}
		if rs, ok := rc.(io.ReadSeeker); ok {
			http.ServeContent(w, r, "", time.Time{}, rs)
			return
		}
		if art.SizeBytes != nil {
			w.Header().Set("Content-Length", strconv.FormatInt(*art.SizeBytes, 10))
		}
		io.Copy(w, rc)
	})
}

func handleArtifactPost(ts *tileserver.Server) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		contentType, err := artifacts.Server.WriteArtifact(r.Context(), id, r.Body)
		if err != nil {
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
		if ts != nil {
			ts.OnArtifactWritten(r.Context(), id, contentType)
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
