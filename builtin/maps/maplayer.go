package maps

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
)

// TileStore reads bundled XYZ tiles by blob ID.
type TileStore interface {
	Get(ctx context.Context, id string) (io.ReadCloser, error)
}

// TileBlobID returns the artifact ID for a bundled XYZ tile.
func TileBlobID(entity string, z, x, y int) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s:%d/%d/%d", entity, z, x, y)))
	return "maplayer-" + hex.EncodeToString(h[:])
}

func getEntity(ctx context.Context, id string) *pb.Entity {
	conn, err := builtin.BuiltinClientConn("maps")
	if err != nil {
		return nil
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)
	resp, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: id})
	if err != nil {
		return nil
	}
	return resp.Entity
}

// NewMapLayerHandler proxies plugin map layer tiles/images, using local store over upstream.
func NewMapLayerHandler(store TileStore) http.Handler {
	client := &http.Client{Timeout: 10 * time.Second}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/map/")
		id, tail, _ := strings.Cut(rest, "/")

		entity := getEntity(r.Context(), id)
		if entity == nil || entity.MapLayer == nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		var src string
		if tiles := entity.MapLayer.GetTiles(); tiles != nil {
			parts := strings.SplitN(strings.TrimSuffix(tail, ".png"), "/", 3)
			if len(parts) != 3 {
				http.Error(w, "bad tile path", http.StatusBadRequest)
				return
			}
			z, _ := strconv.Atoi(parts[0])
			x, _ := strconv.Atoi(parts[1])
			y, _ := strconv.Atoi(parts[2])

			if store != nil {
				if rc, err := store.Get(r.Context(), TileBlobID(id, z, x, y)); err == nil {
					defer rc.Close()
					w.Header().Set("Content-Type", "image/png")
					w.Header().Set("Cache-Control", "public, max-age=86400")
					_, _ = io.Copy(w, rc)
					return
				}
			}

			src = strings.NewReplacer("{z}", parts[0], "{x}", parts[1], "{y}", parts[2]).Replace(tiles.Url)
		} else if img := entity.MapLayer.GetImage(); img != nil {
			src = img.Url
		} else {
			http.Error(w, "map layer has no source", http.StatusBadRequest)
			return
		}

		req, _ := http.NewRequestWithContext(r.Context(), "GET", src, nil)
		req.Header.Set("User-Agent", "hydris-tile-proxy/1.0")
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "fetch failed", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		if ct := resp.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		if resp.StatusCode == http.StatusOK {
			w.Header().Set("Cache-Control", "public, max-age=86400")
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	})
}
