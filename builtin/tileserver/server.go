package tileserver

import (
	"context"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/artifacts"
	pb "github.com/projectqai/proto/go"
)

type Server struct {
	store    *artifacts.LocalStore
	mu       sync.RWMutex
	tilesets map[string]*tileset
}

func NewServer(store *artifacts.LocalStore) *Server {
	return &Server{store: store, tilesets: make(map[string]*tileset)}
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(s.serve)
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	entityID := r.PathValue("entityID")
	zRaw := r.PathValue("z")
	xRaw := r.PathValue("x")
	yRaw := r.PathValue("y")
	z, errZ := strconv.Atoi(zRaw)
	x, errX := strconv.Atoi(xRaw)
	y, errY := strconv.Atoi(strings.TrimSuffix(yRaw, filepath.Ext(yRaw)))
	if errZ != nil || errX != nil || errY != nil || z < 0 || x < 0 || y < 0 {
		http.Error(w, "bad tile coordinates", http.StatusBadRequest)
		return
	}

	ts := s.get(r.Context(), entityID)
	if ts == nil {
		http.NotFound(w, r)
		return
	}
	data, err := ts.tile(r.Context(), z, x, y)
	if err != nil {
		http.Error(w, "read tile", http.StatusInternalServerError)
		return
	}
	if data == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentTypeFor(ts.format))
	w.Header().Set("Cache-Control", "public, max-age=86400")
	if ts.format == "pbf" {
		w.Header().Set("Content-Encoding", "gzip")
	}
	_, _ = w.Write(data)
}

// get returns the opened tileset for entityID, opening it lazily on first use.
func (s *Server) get(ctx context.Context, entityID string) *tileset {
	s.mu.RLock()
	ts, ok := s.tilesets[entityID]
	s.mu.RUnlock()
	if ok {
		return ts
	}

	artID := artifactIDFor(ctx, entityID)
	if artID == "" {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if ts, ok := s.tilesets[entityID]; ok {
		return ts
	}
	ts, err := openTileset(s.store.Path(artID))
	if err != nil {
		slog.Warn("tileserver: open", "entity", entityID, "error", err)
		return nil
	}
	s.tilesets[entityID] = ts
	return ts
}

func artifactIDFor(ctx context.Context, entityID string) string {
	conn, err := builtin.BuiltinClientConn("tileserver")
	if err != nil {
		return ""
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)
	resp, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: entityID})
	if err != nil || resp.Entity == nil {
		return ""
	}
	return resp.Entity.Id
}

// MbtilesContentType marks an artifact as mbtiles.
const MbtilesContentType = "application/vnd.mbtiles"

// OnArtifactWritten reads tile format from uploaded mbtiles and pushes MapLayer.Tiles.Url.
func (s *Server) OnArtifactWritten(ctx context.Context, entityID, contentType string) {
	if contentType != MbtilesContentType {
		return
	}
	ts := s.get(ctx, entityID)
	if ts == nil {
		return
	}
	url := "/tiles/" + entityID + "/{z}/{x}/{y}." + ts.format
	conn, err := builtin.BuiltinClientConn("tileserver")
	if err != nil {
		slog.Warn("tileserver: connect", "entity", entityID, "error", err)
		return
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)
	if _, err := client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: entityID,
			MapLayer: &pb.MapLayerComponent{
				Source: &pb.MapLayerComponent_Tiles{Tiles: &pb.MapLayerComponent_Tile{Url: url}},
			},
		}},
	}); err != nil {
		slog.Warn("tileserver: push map layer", "entity", entityID, "error", err)
	}
}

func contentTypeFor(format string) string {
	switch format {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	case "pbf":
		return "application/x-protobuf"
	default:
		return "image/png"
	}
}
