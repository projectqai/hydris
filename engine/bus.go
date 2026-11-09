package engine

import (
	"context"
	"sync"

	pb "github.com/projectqai/proto/go"
	"go.opentelemetry.io/otel/trace"
)

type Bus struct {
	mu        sync.RWMutex
	consumers map[*Consumer]struct{}
}

func NewBus() *Bus {
	return &Bus{
		consumers: make(map[*Consumer]struct{}),
	}
}

func (b *Bus) Register(c *Consumer) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.consumers[c] = struct{}{}
}

func (b *Bus) Unregister(c *Consumer) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.consumers, c)
}

// CloseAll cancels all consumers, forcing their WatchEntities streams to terminate.
func (b *Bus) CloseAll() {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for c := range b.consumers {
		if c.cancel != nil {
			c.cancel()
		}
	}
}

// ConsumerCount is the number of registered watchers.
func (b *Bus) ConsumerCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.consumers)
}

// Dirty notifies every consumer of a change. The span in ctx (if any) is the
// write that produced it; consumers continue its trace when they send.
func (b *Bus) Dirty(ctx context.Context, entityID string, entity *pb.Entity, change pb.EntityChange) {
	sc := trace.SpanContextFromContext(ctx)
	priority := pb.Priority_PriorityRoutine
	if entity != nil && entity.Priority != nil {
		priority = *entity.Priority
	}

	b.mu.RLock()
	defer b.mu.RUnlock()

	for c := range b.consumers {
		c.markDirty(entityID, priority, change, entity, sc)
	}
}
