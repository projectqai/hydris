package engine

import (
	"context"
	"testing"
	"time"

	"github.com/projectqai/hydris/engine/meta"
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

	w.GC()

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

	w.GC()

	id, change, _, ok := c.popNext()
	if !ok || id != "e1" {
		t.Error("should receive dirty notification for expired entity")
	}
	if change != pb.EntityChange_EntityChangeExpired {
		t.Errorf("expected EntityChangeExpired, got %v", change)
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
	es.lifetimes[int32(pb.EntityComponent_EntityComponentGeo)] = meta.Component{Fresh: past, Until: past}
	es.lifetimes[int32(pb.EntityComponent_EntityComponentAdministrative)] = meta.Component{NoLifetime: true}

	w.GC()

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
	es.lifetimes[int32(pb.EntityComponent_EntityComponentGeo)] = meta.Component{Fresh: past, Until: past}
	es.lifetimes[int32(pb.EntityComponent_EntityComponentTrack)] = meta.Component{Fresh: past, Until: future}
	es.lifetimes[int32(pb.EntityComponent_EntityComponentAdministrative)] = meta.Component{NoLifetime: true}

	w.GC()

	e := w.GetHead("e1")
	if e == nil {
		t.Fatal("entity should survive; Track component is still alive")
		return
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

func TestGC_TransformerGeneratedComponentDoesNotPreventExpiry(t *testing.T) {
	w := NewWorldServer()
	ctx := context.Background()

	past := time.Now().Add(-time.Second)

	// Push a parent with a geo position.
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:  "parent",
			Geo: &pb.GeoSpatialComponent{Latitude: 51, Longitude: 7},
		}},
	}))
	if err != nil {
		t.Fatal(err)
	}

	// Push a child with a PoseComponent + short TTL. The PoseTransformer
	// will resolve it into Geo/Bearing/Orientation on the child entity.
	rng := 1000.0
	_, err = w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{Azimuth: 90, Range: &rng},
				},
			},
			Lifetime: &pb.Lifetime{
				From:  timestamppb.New(past),
				Until: timestamppb.New(past),
			},
		}},
	}))
	if err != nil {
		t.Fatal(err)
	}

	// Verify the transformer produced generated components.
	child := w.GetHead("child")
	if child == nil {
		t.Fatal("child should exist after push")
	}
	if child.Geo == nil {
		t.Fatal("PoseTransformer should have generated Geo on child")
	}

	// Run GC — the child's TTL is in the past, so it should expire.
	w.GC()

	if w.GetHead("child") != nil {
		t.Error("child entity should be expired; transformer-generated components should not keep it alive")
	}
}

func TestGC_GeneratedComponentDoesNotMakeEntityPermanent(t *testing.T) {
	w := NewWorldServer()
	ctx := context.Background()

	now := time.Now()
	until := now.Add(30 * time.Second)

	// Push a parent with a geo position.
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:  "parent",
			Geo: &pb.GeoSpatialComponent{Latitude: 51, Longitude: 7},
		}},
	}))
	if err != nil {
		t.Fatal(err)
	}

	// First push: child with Pose + 30s TTL.
	// Push stamps Controller on the stored entity; markGeneratedComponents
	// then marks Controller and transformer outputs as Generated.
	rng := 1000.0
	_, err = w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{Azimuth: 90, Range: &rng},
				},
			},
			Lifetime: &pb.Lifetime{
				From:  timestamppb.New(now),
				Until: timestamppb.New(until),
			},
		}},
	}))
	if err != nil {
		t.Fatal(err)
	}

	// Second push: ticker refresh with a new TTL window.
	// Controller is NOT in incoming, so it stays as Generated with zero Until.
	until2 := now.Add(60 * time.Second)
	_, err = w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{Azimuth: 90, Range: &rng},
				},
			},
			Lifetime: &pb.Lifetime{
				From:  timestamppb.New(now.Add(time.Second)),
				Until: timestamppb.New(until2),
			},
		}},
	}))
	if err != nil {
		t.Fatal(err)
	}

	child := w.GetHead("child")
	if child == nil {
		t.Fatal("child should exist")
	}
	if child.Lifetime == nil || !child.Lifetime.Until.IsValid() {
		t.Fatal("child Lifetime.Until should be set after refresh; generated components must not make entity permanent")
	}
	if child.Lifetime.Until.AsTime().Before(until) {
		t.Errorf("child Lifetime.Until should be >= %v, got %v", until, child.Lifetime.Until.AsTime())
	}
}

func TestGC_PermanentTrackedSurvivesWhenTTLComponentExpires(t *testing.T) {
	now := time.Now()
	past := now.Add(-time.Second)

	// Entity pushed with Lifetime (tracked, permanent Device) then a TTL
	// component (TargetManualControl) is merged in by a client.
	// When the TTL component expires, the entity must survive.
	entity := &pb.Entity{
		Id:     "e1",
		Device: &pb.DeviceComponent{State: pb.DeviceState_DeviceStateActive},
		Lifetime: &pb.Lifetime{
			From: timestamppb.New(now),
		},
	}

	w := testWorld(map[string]*pb.Entity{"e1": entity})

	es := w.head["e1"]
	es.lifetimes[int32(pb.EntityComponent_EntityComponentTargetManualControl)] = meta.Component{
		Fresh: past, Until: past,
	}
	es.entity.TargetManualControl = &pb.TargetManualControlComponent{}

	w.GC()

	e := w.GetHead("e1")
	if e == nil {
		t.Fatal("entity should survive; Device is permanent and tracked")
	}
	if e.Device == nil {
		t.Error("Device should still be present")
	}
	if e.TargetManualControl != nil {
		t.Error("expired TargetManualControl should be removed")
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

	w.GC()

	if w.GetHead("e1") == nil {
		t.Error("entity with lifetime.from but no until should not be removed")
	}
}
