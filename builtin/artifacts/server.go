package artifacts

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"hash"
	"io"
	"sync"

	"connectrpc.com/connect"
	pb "github.com/projectqai/proto/go"
)

const chunkSize = 64 * 1024

// ArtifactServer implements the ArtifactService Connect handler.
type ArtifactServer struct {
	mu       sync.RWMutex
	store    Store
	local    *LocalStore
	autoMode bool // when true, getStore() checks plugin registry each call
	world    pb.WorldServiceClient
}

// NewArtifactServer creates an ArtifactServer. store is the active backend;
// local is always available for read-only fallback.
func NewArtifactServer(local *LocalStore, world pb.WorldServiceClient) *ArtifactServer {
	return &ArtifactServer{
		store: local,
		local: local,
		world: world,
	}
}

// Local returns the local filesystem store.
func (s *ArtifactServer) Local() *LocalStore {
	return s.local
}

// SetStore swaps the active storage backend.
// SetStore sets a specific backend. Disables auto mode.
func (s *ArtifactServer) SetStore(store Store) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.store = store
	s.autoMode = false
}

// SetAutoMode enables auto mode: prefer last registered plugin store, fall back to local.
func (s *ArtifactServer) SetAutoMode() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.autoMode = true
}

func (s *ArtifactServer) getStore() Store {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.autoMode {
		if ns, ok := LastPluginStore(); ok {
			return ns.Store
		}
		return s.local
	}
	return s.store
}

// DownloadArtifact streams artifact data to the client.
func (s *ArtifactServer) DownloadArtifact(
	ctx context.Context,
	req *connect.Request[pb.DownloadArtifactRequest],
	stream *connect.ServerStream[pb.DownloadArtifactResponse],
) error {
	entity, err := s.resolveEntity(ctx, req.Msg)
	if err != nil {
		return err
	}

	art := entity.Artifact
	if art == nil {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("entity has no artifact component"))
	}

	// Send metadata first.
	if err := stream.Send(&pb.DownloadArtifactResponse{Meta: art}); err != nil {
		return err
	}

	// Stream blob data if available locally.
	store := s.getStore()
	rc, err := store.Get(ctx, art.Id) //nolint:staticcheck // SA1019: Artifact.Id migration pending
	if err != nil && store != s.local {
		rc, err = s.local.Get(ctx, art.Id) //nolint:staticcheck // SA1019: Artifact.Id migration pending
	}
	if err != nil {
		if len(art.Location) > 0 {
			return nil
		}
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("artifact data not found: %w", err))
	}
	defer rc.Close()

	buf := make([]byte, chunkSize)
	for {
		n, readErr := rc.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			if err := stream.Send(&pb.DownloadArtifactResponse{Chunk: chunk}); err != nil {
				return err
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("read artifact: %w", readErr))
		}
	}
}

// UploadArtifact receives artifact data from the client and stores it.
func (s *ArtifactServer) UploadArtifact(
	ctx context.Context,
	stream *connect.ClientStream[pb.UploadArtifactRequest],
) (*connect.Response[pb.UploadArtifactResponse], error) {
	// First message must contain the entity ID.
	if !stream.Receive() {
		if err := stream.Err(); err != nil {
			return nil, err
		}
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("empty stream"))
	}

	first := stream.Msg()
	entityID := first.GetId()
	if entityID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("first message must contain entity id"))
	}

	// Collect chunks into a buffer; first message may also contain one.
	var buf bytes.Buffer
	if chunk := first.GetChunk(); len(chunk) > 0 {
		buf.Write(chunk)
	}
	for stream.Receive() {
		if chunk := stream.Msg().GetChunk(); len(chunk) > 0 {
			buf.Write(chunk)
		}
	}
	if err := stream.Err(); err != nil {
		return nil, err
	}

	if _, err := s.WriteArtifact(ctx, entityID, &buf); err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.UploadArtifactResponse{}), nil
}

// WriteArtifact stores body as the payload of entityID's artifact component
// and updates the entity's sha256 and size, returning the content type. Shared
// by the gRPC UploadArtifact handler and the HTTP POST /artifacts/{id} handler.
func (s *ArtifactServer) WriteArtifact(ctx context.Context, entityID string, body io.Reader) (string, error) {
	resp, err := s.world.GetEntity(ctx, &pb.GetEntityRequest{Id: entityID})
	if err != nil {
		return "", connect.NewError(connect.CodeNotFound, fmt.Errorf("entity not found: %w", err))
	}
	if resp.Entity == nil || resp.Entity.Artifact == nil {
		return "", connect.NewError(connect.CodeNotFound, fmt.Errorf("entity %s has no artifact component", entityID))
	}
	existing := resp.Entity.Artifact
	artID := existing.Id //nolint:staticcheck // SA1019: Artifact.Id migration pending

	hw := &hashSizeWriter{h: sha256.New()}
	if err := s.getStore().Put(ctx, artID, io.TeeReader(body, hw)); err != nil {
		return "", connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("store artifact: %w", err))
	}

	sum := hex.EncodeToString(hw.h.Sum(nil))
	size := hw.n
	// Component merge replaces the whole Artifact component, so carry the
	// content type set at entity creation forward with the blob metadata.
	if _, err := s.world.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:       entityID,
			Artifact: &pb.ArtifactComponent{Id: artID, ContentType: existing.ContentType, Sha256: &sum, SizeBytes: &size}, //nolint:staticcheck // SA1019: Artifact.Id migration pending
		}},
	}); err != nil {
		return "", connect.NewError(connect.CodeInternal, fmt.Errorf("update artifact metadata: %w", err))
	}
	return existing.ContentType, nil
}

type hashSizeWriter struct {
	h hash.Hash
	n int64
}

func (w *hashSizeWriter) Write(p []byte) (int, error) {
	w.n += int64(len(p))
	return w.h.Write(p)
}

// DeleteBlob deletes the blob for an artifact ID from the active store.
// Safe to call from any goroutine.
func (s *ArtifactServer) DeleteBlob(artID string) error {
	store := s.getStore()
	return store.Delete(context.Background(), artID)
}

// resolveEntity finds the entity by ID or SHA256 lookup.
func (s *ArtifactServer) resolveEntity(ctx context.Context, req *pb.DownloadArtifactRequest) (*pb.Entity, error) {
	switch ref := req.Ref.(type) {
	case *pb.DownloadArtifactRequest_Id:
		resp, err := s.world.GetEntity(ctx, &pb.GetEntityRequest{Id: ref.Id})
		if err != nil {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("entity %s not found: %w", ref.Id, err))
		}
		return resp.Entity, nil

	case *pb.DownloadArtifactRequest_Sha256:
		// List all entities with ArtifactComponent and scan for matching sha256.
		artField := uint32(pb.EntityComponent_EntityComponentArtifact)
		listResp, err := s.world.ListEntities(ctx, &pb.ListEntitiesRequest{
			Filter: &pb.EntityFilter{
				Component: []uint32{artField},
			},
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list entities: %w", err))
		}
		for _, e := range listResp.Entities {
			if e.Artifact != nil && e.Artifact.Sha256 != nil && *e.Artifact.Sha256 == ref.Sha256 {
				return e, nil
			}
		}
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("no artifact with sha256 %s", ref.Sha256))

	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("ref must be set"))
	}
}
