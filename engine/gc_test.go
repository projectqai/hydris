package engine

import (
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestGC_RemovesExpired(t *testing.T) {
	expired := &pb.Entity{
		Id: "e1",
		Lifetime: &pb.Lifetime{
			Until: timestamppb.New(time.Now().Add(-time.Hour)),
		},
	}
	alive := &pb.Entity{
		Id: "e2",
		Lifetime: &pb.Lifetime{
			Until: timestamppb.New(time.Now().Add(time.Hour)),
		},
	}
	noLifetime := &pb.Entity{Id: "e3"}

	w := testWorld(map[string]*pb.Entity{
		"e1": expired,
		"e2": alive,
		"e3": noLifetime,
	})

	w.gc()

	if w.GetHead("e1") != nil {
		t.Error("expired entity should be removed")
	}
	if w.GetHead("e2") == nil {
		t.Error("alive entity should remain")
	}
	if w.GetHead("e3") == nil {
		t.Error("entity without lifetime should remain")
	}
}

func TestGC_BroadcastsExpiry(t *testing.T) {
	expired := &pb.Entity{
		Id: "e1",
		Lifetime: &pb.Lifetime{
			Until: timestamppb.New(time.Now().Add(-time.Hour)),
		},
	}

	w := testWorld(map[string]*pb.Entity{
		"e1": expired,
	})

	c := NewConsumer(w, nil, nil)
	w.bus.Register(c)
	defer w.bus.Unregister(c)

	w.gc()

	id, change, _, ok := c.popNext()
	if !ok || id != "e1" {
		t.Error("should receive dirty notification for expired entity")
	}
	if change != pb.EntityChange_EntityChangeExpired {
		t.Errorf("expected EntityChangeExpired, got %v", change)
	}
}

func TestGC_FrozenTimeline(t *testing.T) {
	// Entity expires at t2, freeze at t1 (before expiry) - should NOT be removed
	t1 := time.Now().Add(-2 * time.Hour)
	t2 := time.Now().Add(-time.Hour)

	entity := &pb.Entity{
		Id: "e1",
		Lifetime: &pb.Lifetime{
			Until: timestamppb.New(t2),
		},
	}

	w := testWorld(map[string]*pb.Entity{
		"e1": entity,
	})
	w.frozen.Store(true)
	w.frozenAt = t1

	w.gc()

	if w.GetHead("e1") == nil {
		t.Error("entity should NOT be removed when frozen before its expiry")
	}

	// Now freeze after expiry
	w.frozenAt = time.Now()
	w.gc()

	if w.GetHead("e1") != nil {
		t.Error("entity should be removed when frozen after its expiry")
	}
}

func TestGC_NoLifetimeComponentDoesNotPreventExpiry(t *testing.T) {
	past := time.Now().Add(-time.Second)

	// Entity has Geo (with lifetime+until) and Administrative (no lifetime).
	// Simulates adsblol + adsbdb enrichment scenario.
	entity := &pb.Entity{
		Id:             "e1",
		Geo:            &pb.GeoSpatialComponent{Latitude: 48},
		Administrative: &pb.AdministrativeComponent{Id: ptr("REG-123")},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(past),
			Until: timestamppb.New(past),
		},
	}

	w := testWorld(map[string]*pb.Entity{"e1": entity})

	// Geo has a real lifetime that expires. Administrative has noLifetime.
	es := w.head["e1"]
	es.lifetimes[int32(pb.EntityComponent_EntityComponentGeo)] = componentMeta{fresh: past, until: past}
	es.lifetimes[int32(pb.EntityComponent_EntityComponentAdministrative)] = componentMeta{noLifetime: true}

	w.gc()

	if w.GetHead("e1") != nil {
		t.Error("entity should be expired; noLifetime component should not keep it alive")
	}
}

func TestGC_NoLifetimeComponentKeptWhenTrackedSurvives(t *testing.T) {
	past := time.Now().Add(-time.Second)
	future := time.Now().Add(time.Hour)

	entity := &pb.Entity{
		Id:             "e1",
		Geo:            &pb.GeoSpatialComponent{Latitude: 48},
		Track:          &pb.TrackComponent{Tracker: ptr("t1")},
		Administrative: &pb.AdministrativeComponent{Id: ptr("REG-123")},
		Lifetime: &pb.Lifetime{
			From: timestamppb.New(past),
		},
	}

	w := testWorld(map[string]*pb.Entity{"e1": entity})

	es := w.head["e1"]
	es.lifetimes[int32(pb.EntityComponent_EntityComponentGeo)] = componentMeta{fresh: past, until: past}
	es.lifetimes[int32(pb.EntityComponent_EntityComponentTrack)] = componentMeta{fresh: past, until: future}
	es.lifetimes[int32(pb.EntityComponent_EntityComponentAdministrative)] = componentMeta{noLifetime: true}

	w.gc()

	e := w.GetHead("e1")
	if e == nil {
		t.Fatal("entity should survive; Track component is still alive")
	}
	if e.Geo != nil {
		t.Error("expired Geo should be removed")
	}
	if e.Track == nil {
		t.Error("Track should still be present")
	}
	if e.Administrative == nil {
		t.Error("Administrative (noLifetime) should be kept when entity survives")
	}
}

func TestGC_NoLifetimeUntil(t *testing.T) {
	entity := &pb.Entity{
		Id: "e1",
		Lifetime: &pb.Lifetime{
			From: timestamppb.Now(),
		},
	}

	w := testWorld(map[string]*pb.Entity{
		"e1": entity,
	})

	w.gc()

	if w.GetHead("e1") == nil {
		t.Error("entity with lifetime.from but no until should not be removed")
	}
}
