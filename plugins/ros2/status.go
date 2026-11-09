package main

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/sdk"
	"google.golang.org/protobuf/proto"
)

// status reports a channel's health and counters on its entity, as
// device.state and device.error and the metric component.
type status struct {
	id     string
	device *pb.DeviceComponent // the child's own: a push replaces the component

	published, publishedBytes atomic.Uint64
	received, receivedBytes   atomic.Uint64
	pushed, dropped           atomic.Uint64
	topics                    atomic.Int64

	mu       sync.Mutex
	degraded string // why the channel runs degraded, or empty
}

func newStatus(e *pb.Entity) *status {
	d := proto.CloneOf(e.GetDevice())
	if d == nil {
		d = &pb.DeviceComponent{}
	}
	return &status{id: e.Id, device: d}
}

// setDegraded marks the channel degraded for reason, or healthy again
// when reason is empty.
func (s *status) setDegraded(reason string) {
	s.mu.Lock()
	s.degraded = reason
	s.mu.Unlock()
}

func count(id uint32, label string, v uint64) *pb.Metric {
	return &pb.Metric{Id: proto.Uint32(id), Label: proto.String(label),
		Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Val: &pb.Metric_Uint64{Uint64: v}}
}

// kilobytes is a data size of n bytes, in KB (1000 bytes).
func kilobytes(id uint32, label string, n uint64) *pb.Metric {
	return &pb.Metric{Id: proto.Uint32(id), Label: proto.String(label),
		Kind: pb.MetricKind_MetricKindDataSize.Enum(), Unit: pb.MetricUnit_MetricUnitKilobyte, Val: &pb.Metric_Double{Double: float64(n) / 1000}}
}

// rate is a data rate of n bytes per second, in KB/s.
func rate(id uint32, label string, n float64) *pb.Metric {
	return &pb.Metric{Id: proto.Uint32(id), Label: proto.String(label),
		Kind: pb.MetricKind_MetricKindDataRate.Enum(), Unit: pb.MetricUnit_MetricUnitKilobytePerSecond, Val: &pb.Metric_Double{Double: n / 1000}}
}

// rates are the data rates over the last report interval, in bytes/s.
type rates struct{ published, received float64 }

func (s *status) entity(state pb.DeviceState, reason string, r rates) *pb.Entity {
	d := proto.CloneOf(s.device)
	d.State = state
	d.Error = nil
	if reason != "" {
		d.Error = proto.String(reason)
	}
	return &pb.Entity{
		Id:     s.id,
		Device: d,
		Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
			count(1, "messages published", s.published.Load()),
			kilobytes(2, "data published", s.publishedBytes.Load()),
			count(3, "messages received", s.received.Load()),
			kilobytes(4, "data received", s.receivedBytes.Load()),
			count(5, "entities pushed", s.pushed.Load()),
			count(6, "messages dropped", s.dropped.Load()),
			count(7, "topics", uint64(max(s.topics.Load(), 0))),
			rate(8, "published rate", r.published),
			rate(9, "received rate", r.received),
		}},
	}
}

// report pushes the status every two seconds while it changes, until ctx
// ends. The rates are over those two seconds.
func (s *status) report(ctx context.Context, world pb.WorldServiceClient) error {
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	var last *pb.Entity
	var r rates
	prevOut, prevIn, prevAt := s.publishedBytes.Load(), s.receivedBytes.Load(), time.Now()
	for {
		s.mu.Lock()
		reason := s.degraded
		s.mu.Unlock()
		state := pb.DeviceState_DeviceStateActive
		if reason != "" {
			state = pb.DeviceState_DeviceStateDegraded
		}
		if e := s.entity(state, reason, r); !proto.Equal(e, last) {
			if _, err := world.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{e}}); err == nil {
				last = e
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case now := <-tick.C:
			out, in := s.publishedBytes.Load(), s.receivedBytes.Load()
			secs := now.Sub(prevAt).Seconds()
			r = rates{published: float64(out-prevOut) / secs, received: float64(in-prevIn) / secs}
			prevOut, prevIn, prevAt = out, in, now
		}
	}
}

// failed reports that a run failed with err. A run that was stopped, by a
// config change for one, reports nothing: the run after it may already
// have reported itself active.
func (s *status) failed(err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = sdk.Push(ctx, s.entity(pb.DeviceState_DeviceStateFailed, err.Error(), rates{}))
}
