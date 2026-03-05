package engine

import (
	"context"
	"testing"

	pb "github.com/projectqai/proto/go"

	"connectrpc.com/connect"
)

// ---------------------------------------------------------------------------
// Lease enforcement
// ---------------------------------------------------------------------------

func TestLease_AcquireOnNewEntity(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	ctx := context.Background()

	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:    "dev.ttyACM0",
			Lease: &pb.Lease{Controller: "meshtastic"},
		}},
	}))
	if err != nil {
		t.Fatalf("should acquire lease on new entity: %v", err)
	}

	e := w.GetHead("dev.ttyACM0")
	if e.Lease == nil || e.Lease.Controller != "meshtastic" {
		t.Error("lease should be set on entity")
	}
}

func TestLease_SameHolderCanUpdate(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"dev.ttyACM0": {
			Id:    "dev.ttyACM0",
			Lease: &pb.Lease{Controller: "meshtastic"},
		},
	})
	ctx := context.Background()

	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:    "dev.ttyACM0",
			Lease: &pb.Lease{Controller: "meshtastic"},
			Label: ptr("updated"),
		}},
	}))
	if err != nil {
		t.Fatalf("same holder should be able to update: %v", err)
	}

	e := w.GetHead("dev.ttyACM0")
	if e.Label == nil || *e.Label != "updated" {
		t.Error("entity should be updated")
	}
}

func TestLease_DifferentHolderRejected(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"dev.ttyACM0": {
			Id:    "dev.ttyACM0",
			Lease: &pb.Lease{Controller: "meshtastic"},
		},
	})
	ctx := context.Background()

	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:    "dev.ttyACM0",
			Lease: &pb.Lease{Controller: "mavlink"},
		}},
	}))
	if err == nil {
		t.Fatal("should reject lease from different holder")
	}
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("expected FailedPrecondition, got %v", connect.CodeOf(err))
	}
}

func TestLease_PushWithoutLeaseFieldAllowed(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"dev.ttyACM0": {
			Id:    "dev.ttyACM0",
			Lease: &pb.Lease{Controller: "meshtastic"},
		},
	})
	ctx := context.Background()

	// Push without lease field should succeed (merge semantics, lease not touched)
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:    "dev.ttyACM0",
			Label: ptr("telemetry update"),
		}},
	}))
	if err != nil {
		t.Fatalf("push without lease field should be allowed: %v", err)
	}

	// Lease should be preserved
	e := w.GetHead("dev.ttyACM0")
	if e.Lease == nil || e.Lease.Controller != "meshtastic" {
		t.Error("lease should be preserved after non-lease push")
	}
}

func TestLease_TwoEntitiesDifferentHolders(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	ctx := context.Background()

	// Two different entities can be leased by different controllers
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "dev.ttyACM0", Lease: &pb.Lease{Controller: "meshtastic"}},
			{Id: "dev.ttyACM1", Lease: &pb.Lease{Controller: "mavlink"}},
		},
	}))
	if err != nil {
		t.Fatalf("different entities should be leasable by different controllers: %v", err)
	}
}

func TestLease_BatchRejectsIfAnyConflicts(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"dev.ttyACM0": {
			Id:    "dev.ttyACM0",
			Lease: &pb.Lease{Controller: "meshtastic"},
		},
	})
	ctx := context.Background()

	// Batch: first entity is fine, second conflicts
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "dev.ttyACM1", Lease: &pb.Lease{Controller: "mavlink"}},
			{Id: "dev.ttyACM0", Lease: &pb.Lease{Controller: "mavlink"}},
		},
	}))
	if err == nil {
		t.Fatal("batch should be rejected if any entity has a lease conflict")
	}
}

func TestLease_UnleasedEntityAcceptsAnyHolder(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"dev.ttyACM0": {
			Id:    "dev.ttyACM0",
			Label: ptr("existing device"),
		},
	})
	ctx := context.Background()

	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:    "dev.ttyACM0",
			Lease: &pb.Lease{Controller: "mavlink"},
		}},
	}))
	if err != nil {
		t.Fatalf("should be able to lease an unleased entity: %v", err)
	}
}
