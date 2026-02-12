package engine

import (
	"context"
	"sync"
	"time"

	"github.com/projectqai/hydris/policy"
	pb "github.com/projectqai/proto/go"
)

type Consumer struct {
	world   *WorldServer
	ability *policy.Ability
	limiter *pb.WatchBehavior
	filter  *pb.EntityFilter

	mu               sync.Mutex
	dirty            [4]map[string]pb.EntityChange // [priority]map[entityID]EntityChange
	expiredSnapshots map[string]*pb.Entity         // last known entity for expired IDs

	signal      chan struct{}
	rateLimiter *time.Ticker
	keepalive   *time.Ticker
}

func NewConsumer(world *WorldServer, ability *policy.Ability, limiter *pb.WatchBehavior, filter *pb.EntityFilter) *Consumer {
	c := &Consumer{
		world:   world,
		ability: ability,
		limiter: limiter,
		filter:  filter,
		signal:  make(chan struct{}, 1),
	}

	for i := range c.dirty {
		c.dirty[i] = make(map[string]pb.EntityChange)
	}
	c.expiredSnapshots = make(map[string]*pb.Entity)

	if limiter != nil && limiter.MaxRateHz != nil && *limiter.MaxRateHz > 0 {
		interval := time.Duration(float64(time.Second) / float64(*limiter.MaxRateHz))
		c.rateLimiter = time.NewTicker(interval)
	}

	if limiter != nil && limiter.KeepaliveIntervalMs != nil && *limiter.KeepaliveIntervalMs > 0 {
		ms := *limiter.KeepaliveIntervalMs
		if ms < 1000 {
			ms = 1000
		}
		c.keepalive = time.NewTicker(time.Duration(ms) * time.Millisecond)
	}

	return c
}

func (c *Consumer) minPriority() pb.Priority {
	if c.limiter != nil && c.limiter.MinPriority != nil {
		return *c.limiter.MinPriority
	}
	return pb.Priority_PriorityRoutine
}

func (c *Consumer) markDirty(entityID string, priority pb.Priority, change pb.EntityChange, entity *pb.Entity) {
	if priority < c.minPriority() {
		return
	}

	c.mu.Lock()

	// just in case priority has changed, reseat it
	for p := range c.dirty {
		delete(c.dirty[p], entityID)
	}
	c.dirty[priority][entityID] = change

	if change == pb.EntityChange_EntityChangeExpired && entity != nil {
		c.expiredSnapshots[entityID] = entity
	} else {
		delete(c.expiredSnapshots, entityID)
	}

	c.mu.Unlock()

	select {
	case c.signal <- struct{}{}:
	default:
	}
}

func (c *Consumer) popNext() (entityID string, change pb.EntityChange, priority pb.Priority, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	minPri := c.minPriority()

	// Drain in priority order: Flash(3) -> Immediate(2) -> Routine(1) -> Unspecified(0)
	for p := pb.Priority_PriorityFlash; p >= pb.Priority_PriorityUnspecified; p-- {
		if p < minPri {
			continue
		}
		for id, ch := range c.dirty[p] {
			delete(c.dirty[p], id)
			return id, ch, p, true
		}
	}
	return "", 0, 0, false
}

func (c *Consumer) SenderLoop(ctx context.Context, send func(*pb.EntityChangeEvent) error) error {
	if c.keepalive != nil {
		defer c.keepalive.Stop()
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		entityID, change, priority, ok := c.popNext()
		if !ok {
			if c.keepalive != nil {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-c.signal:
					continue
				case <-c.keepalive.C:
					c.requeueAll()
					continue
				}
			} else {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-c.signal:
					continue
				}
			}
		}

		entity := c.world.GetHead(entityID)

		if entity == nil && change == pb.EntityChange_EntityChangeExpired {
			c.mu.Lock()
			if snap, ok := c.expiredSnapshots[entityID]; ok {
				entity = snap
				delete(c.expiredSnapshots, entityID)
			} else {
				entity = &pb.Entity{Id: entityID}
			}
			c.mu.Unlock()
		}

		// Check read policy
		if entity != nil && c.ability != nil && !c.ability.CanRead(ctx, entity) {
			continue
		}

		if priority == pb.Priority_PriorityFlash {
			if entity != nil || change == pb.EntityChange_EntityChangeExpired {
				if err := send(&pb.EntityChangeEvent{Entity: entity, T: change}); err != nil {
					return err
				}
			}
			continue
		}

		if entity == nil && change != pb.EntityChange_EntityChangeExpired {
			continue
		}

		if entity != nil && c.filter != nil && !c.world.matchesEntityFilter(entity, c.filter) {
			continue
		}

		if c.rateLimiter != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-c.rateLimiter.C:
			}
		}

		if err := send(&pb.EntityChangeEvent{Entity: entity, T: change}); err != nil {
			return err
		}
	}
}

func (c *Consumer) requeueAll() {
	c.world.l.RLock()
	for id, e := range c.world.head {
		priority := pb.Priority_PriorityRoutine
		if e.Priority != nil {
			priority = *e.Priority
		}
		c.markDirty(id, priority, pb.EntityChange_EntityChangeUpdated, e)
	}
	c.world.l.RUnlock()
}
