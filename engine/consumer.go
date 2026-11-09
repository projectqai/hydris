package engine

import (
	"context"
	"sync"
	"time"

	"github.com/projectqai/hydris/pkg/metrics"
	"github.com/projectqai/hydris/pkg/tracing"
	pb "github.com/projectqai/proto/go"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// dirtyEntry is a pending change for one entity. trace is the span of the
// write that produced it; invalid for keepalive re-sends, which continue no
// trace. queued is when the change was marked, so the drain latency (how long
// a change waited in this consumer before being sent) can be measured.
type dirtyEntry struct {
	change pb.EntityChange
	trace  trace.SpanContext
	queued time.Time
}

type Consumer struct {
	world   *WorldServer
	limiter *pb.WatchBehavior
	filter  *pb.EntityFilter

	// actor and builtin identify the watcher, for the send spans.
	actor   string
	builtin string

	mu               sync.Mutex
	dirty            [4]map[string]dirtyEntry // [priority]map[entityID]pending change
	expiredSnapshots map[string]*pb.Entity    // last known entity for expired IDs
	observed         map[string]struct{}      // entity IDs sent to this client

	signal      chan struct{}
	cancel      context.CancelFunc // cancels SenderLoop's ctx; set by WatchEntities
	rateLimiter *time.Ticker
	keepalive   *time.Ticker
	heartbeat   *time.Ticker
}

func NewConsumer(world *WorldServer, limiter *pb.WatchBehavior, filter *pb.EntityFilter) *Consumer {
	c := &Consumer{
		world:   world,
		limiter: limiter,
		filter:  filter,
		signal:  make(chan struct{}, 1),
	}

	for i := range c.dirty {
		c.dirty[i] = make(map[string]dirtyEntry)
	}
	c.expiredSnapshots = make(map[string]*pb.Entity)
	c.observed = make(map[string]struct{})

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

	if interval := heartbeatInterval(limiter); interval > 0 {
		c.heartbeat = time.NewTicker(interval)
	}

	return c
}

const defaultHeartbeatInterval = 30 * time.Second

// heartbeatInterval returns how long a stream may stay idle before a
// heartbeat is sent. unset means the default, 0 disables heartbeats.
func heartbeatInterval(limiter *pb.WatchBehavior) time.Duration {
	if limiter == nil || limiter.HeartbeatIntervalMs == nil {
		return defaultHeartbeatInterval
	}
	ms := *limiter.HeartbeatIntervalMs
	if ms == 0 {
		return 0
	}
	return time.Duration(max(ms, 1000)) * time.Millisecond
}

func (c *Consumer) minPriority() pb.Priority {
	if c.limiter != nil && c.limiter.MinPriority != nil {
		return *c.limiter.MinPriority
	}
	return pb.Priority_PriorityRoutine
}

func (c *Consumer) markDirty(entityID string, priority pb.Priority, change pb.EntityChange, entity *pb.Entity, sc trace.SpanContext) {
	if priority < c.minPriority() {
		return
	}

	c.mu.Lock()

	// just in case priority has changed, reseat it
	for p := range c.dirty {
		delete(c.dirty[p], entityID)
	}
	c.dirty[priority][entityID] = dirtyEntry{change: change, trace: sc, queued: time.Now()}

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

func (c *Consumer) popNext() (entityID string, entry dirtyEntry, priority pb.Priority, ok bool) {
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
	return "", dirtyEntry{}, 0, false
}

// send delivers one event and records how long it waited in the queue (from
// Dirty to drain). When the change came from a traced write, the delivery is
// a "watch.send" span under that write: it starts when the change was queued,
// marks the drain as an event, and ends when the stream write returns, so
// queueing and send time are both visible.
func (c *Consumer) send(ctx context.Context, sendFn func(*pb.EntityChangeEvent) error, entity *pb.Entity, change pb.EntityChange, entry dirtyEntry) error {
	ev := &pb.EntityChangeEvent{Entity: entity, T: change}
	drained := time.Now()
	queueLatency := drained.Sub(entry.queued)
	metrics.RecordWatchQueueLatency(queueLatency)
	sc := entry.trace
	if !sc.IsValid() || entity == nil {
		return sendFn(ev)
	}
	_, span := tracing.Tracer().Start(trace.ContextWithSpanContext(ctx, sc), "watch.send",
		trace.WithSpanKind(trace.SpanKindProducer), trace.WithTimestamp(entry.queued))
	defer span.End()
	if span.IsRecording() {
		attrs := []attribute.KeyValue{
			tracing.AttrEntityID.String(entity.Id),
			tracing.AttrChange.String(change.String()),
			attribute.Float64("hydris.watch.queue_ms", float64(queueLatency)/float64(time.Millisecond)),
		}
		if c.actor != "" {
			attrs = append(attrs, tracing.AttrActor.String(c.actor))
		}
		if c.builtin != "" {
			attrs = append(attrs, tracing.AttrBuiltin.String(c.builtin))
		}
		span.SetAttributes(attrs...)
		span.AddEvent("drained", trace.WithTimestamp(drained))
	}
	err := sendFn(ev)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	return err
}

func (c *Consumer) SenderLoop(ctx context.Context, sendFn func(*pb.EntityChangeEvent) error) error {
	// nil channels block forever, so disabled tickers never fire
	var keepaliveC, heartbeatC <-chan time.Time
	if c.keepalive != nil {
		defer c.keepalive.Stop()
		keepaliveC = c.keepalive.C
	}
	if c.heartbeat != nil {
		defer c.heartbeat.Stop()
		heartbeatC = c.heartbeat.C
	}

	// heartbeats only go out when nothing else was sent for a full interval,
	// since every event already carries now
	sentSinceHeartbeat := false
	send := func(ev *pb.EntityChangeEvent) error {
		sentSinceHeartbeat = true
		return sendFn(ev)
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		entityID, entry, priority, ok := c.popNext()
		change := entry.change
		if !ok {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-c.signal:
			case <-keepaliveC:
				c.requeueAll()
			case <-heartbeatC:
				if !sentSinceHeartbeat {
					if err := sendFn(&pb.EntityChangeEvent{T: pb.EntityChange_EntityChangeHeartbeat}); err != nil {
						return err
					}
				}
				sentSinceHeartbeat = false
			}
			continue
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

		if priority == pb.Priority_PriorityFlash {
			if entity != nil || change == pb.EntityChange_EntityChangeExpired {
				if err := c.send(ctx, send, entity, change, entry); err != nil {
					return err
				}
			}
			continue
		}

		if entity == nil && change != pb.EntityChange_EntityChangeExpired {
			continue
		}

		if entity != nil && c.filter != nil && !c.world.matchesEntityFilter(entity, c.filter) {
			// Entity no longer matches filter — send Unobserved if we previously sent it.
			if _, wasObserved := c.observed[entityID]; wasObserved {
				delete(c.observed, entityID)
				if err := send(&pb.EntityChangeEvent{Entity: entity, T: pb.EntityChange_EntityChangeUnobserved}); err != nil {
					return err
				}
			}
			continue
		}

		if c.rateLimiter != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-c.rateLimiter.C:
			}
		}

		if change == pb.EntityChange_EntityChangeExpired {
			delete(c.observed, entityID)
		} else {
			c.observed[entityID] = struct{}{}
		}

		if err := c.send(ctx, send, entity, change, entry); err != nil {
			return err
		}
	}
}

func (c *Consumer) requeueAll() {
	c.world.l.RLock()
	for id, es := range c.world.head {
		e := es.entity
		priority := pb.Priority_PriorityRoutine
		if e.Priority != nil {
			priority = *e.Priority
		}
		c.markDirty(id, priority, pb.EntityChange_EntityChangeUpdated, e, trace.SpanContext{})
	}
	c.world.l.RUnlock()
}
