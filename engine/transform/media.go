package transform

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/projectqai/hydris/engine/meta"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// MediaTransformer stamps epoch timestamps onto CameraComponent streams.
// Source URLs are kept as-is in the entity — proxy handlers read them
// directly from the entity when needed.
type MediaTransformer struct {
	mu sync.RWMutex
	// epochs maps "entityID/streamIndex" → wall-clock time of first frame.
	epochs map[string]time.Time
}

func NewMediaTransformer() *MediaTransformer {
	return &MediaTransformer{
		epochs: make(map[string]time.Time),
	}
}

func (mt *MediaTransformer) Validate(_ map[string]*pb.Entity, _ *pb.Entity) error {
	return nil
}

func (mt *MediaTransformer) Reindex(_ map[string]*pb.Entity, _ string) {}

func (mt *MediaTransformer) Name() string { return "media" }

func (mt *MediaTransformer) Resolve(head map[string]*pb.Entity, changedID string, _ map[int32]meta.Component) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]
	if entity == nil || entity.Camera == nil || len(entity.Camera.Streams) == 0 {
		mt.clearEntity(changedID)
		return nil, nil
	}

	mt.mu.RLock()
	defer mt.mu.RUnlock()

	for idx, stream := range entity.Camera.Streams {
		key := fmt.Sprintf("%s/%d", changedID, idx)
		if epoch, ok := mt.epochs[key]; ok {
			stream.Epoch = timestamppb.New(epoch)
		}
	}

	return nil, nil
}

func (mt *MediaTransformer) clearEntity(entityID string) {
	prefix := entityID + "/"
	mt.mu.Lock()
	defer mt.mu.Unlock()
	for k := range mt.epochs {
		if strings.HasPrefix(k, prefix) {
			delete(mt.epochs, k)
		}
	}
}

// SetEpoch records the wall-clock time of the first frame for a stream.
func (mt *MediaTransformer) SetEpoch(entityID string, streamIndex int, t time.Time) {
	mt.mu.Lock()
	mt.epochs[fmt.Sprintf("%s/%d", entityID, streamIndex)] = t
	mt.mu.Unlock()
}
