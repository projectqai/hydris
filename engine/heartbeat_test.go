package engine

import (
	"context"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
	"go.opentelemetry.io/otel/trace"
)

func collectEvents(ctx context.Context, c *Consumer) ([]pb.EntityChange, error) {
	var got []pb.EntityChange
	err := c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		got = append(got, ev.T)
		return nil
	})
	return got, err
}

func TestConsumer_HeartbeatWhenIdle(t *testing.T) {
	c := NewConsumer(testWorld(nil), &pb.WatchBehavior{HeartbeatIntervalMs: ptr(uint32(1000))}, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	defer cancel()
	got, err := collectEvents(ctx, c)
	assertContextErr(t, err)

	if len(got) != 2 {
		t.Fatalf("expected 2 heartbeats, got %v", got)
	}
	for _, ch := range got {
		if ch != pb.EntityChange_EntityChangeHeartbeat {
			t.Errorf("expected heartbeat, got %v", ch)
		}
	}
}

func TestConsumer_HeartbeatSuppressedByTraffic(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{"a": {Id: "a"}})
	c := NewConsumer(w, &pb.WatchBehavior{HeartbeatIntervalMs: ptr(uint32(1000))}, nil)

	// an update at 0.5s covers the 1s tick; the 2s tick is idle again
	go func() {
		time.Sleep(500 * time.Millisecond)
		c.markDirty("a", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated, nil, trace.SpanContext{})
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	defer cancel()
	got, err := collectEvents(ctx, c)
	assertContextErr(t, err)

	want := []pb.EntityChange{pb.EntityChange_EntityChangeUpdated, pb.EntityChange_EntityChangeHeartbeat}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestHeartbeatInterval(t *testing.T) {
	cases := []struct {
		limiter *pb.WatchBehavior
		want    time.Duration
	}{
		{nil, defaultHeartbeatInterval},
		{&pb.WatchBehavior{}, defaultHeartbeatInterval},
		{&pb.WatchBehavior{HeartbeatIntervalMs: ptr(uint32(0))}, 0},
		{&pb.WatchBehavior{HeartbeatIntervalMs: ptr(uint32(200))}, time.Second},
		{&pb.WatchBehavior{HeartbeatIntervalMs: ptr(uint32(5000))}, 5 * time.Second},
	}
	for _, tc := range cases {
		if got := heartbeatInterval(tc.limiter); got != tc.want {
			t.Errorf("heartbeatInterval(%v) = %v, want %v", tc.limiter, got, tc.want)
		}
	}
}

func TestConsumer_NoHeartbeatWhenDisabled(t *testing.T) {
	c := NewConsumer(testWorld(nil), &pb.WatchBehavior{HeartbeatIntervalMs: ptr(uint32(0))}, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	got, err := collectEvents(ctx, c)
	assertContextErr(t, err)

	if len(got) != 0 {
		t.Fatalf("expected no events, got %v", got)
	}
}
