package engine

import (
	"context"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestStrPtr(t *testing.T) {
	s := strPtr("hello")
	if s == nil || *s != "hello" {
		t.Error("strPtr should return pointer to string")
	}
}

func TestMergeEntity(t *testing.T) {
	dst := &pb.Entity{
		Id:    "e1",
		Label: ptr("original"),
		Geo:   &pb.GeoSpatialComponent{Latitude: 1.0, Longitude: 2.0},
	}
	src := &pb.Entity{
		Id:    "e1",
		Label: ptr("updated"),
		Track: &pb.TrackComponent{Tracker: proto.String("t1")},
	}

	merged := mergeEntity(dst, src)

	// Label should be overwritten
	if merged.Label == nil || *merged.Label != "updated" {
		t.Errorf("expected label 'updated', got %v", merged.Label)
	}
	// Geo should be preserved from dst (src has nil Geo)
	if merged.Geo == nil || merged.Geo.Latitude != 1.0 {
		t.Error("Geo should be preserved from dst")
	}
	// Track should come from src
	if merged.Track == nil || merged.Track.GetTracker() != "t1" {
		t.Error("Track should come from src")
	}
	// Original should not be mutated
	if dst.Track != nil {
		t.Error("dst should not be mutated")
	}
}

func TestMergeEntity_EmptySrc(t *testing.T) {
	dst := &pb.Entity{
		Id:    "e1",
		Label: ptr("keep"),
		Geo:   &pb.GeoSpatialComponent{Latitude: 5.0},
	}
	src := &pb.Entity{Id: "e1"}

	merged := mergeEntity(dst, src)
	if merged.Label == nil || *merged.Label != "keep" {
		t.Error("label should be preserved when src has nil label")
	}
	if merged.Geo == nil || merged.Geo.Latitude != 5.0 {
		t.Error("Geo should be preserved when src has nil Geo")
	}
}

func TestGetHead(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("tank")},
	})

	e := w.GetHead("e1")
	if e == nil || e.Id != "e1" {
		t.Error("GetHead should return existing entity")
	}

	e = w.GetHead("nonexistent")
	if e != nil {
		t.Error("GetHead should return nil for missing entity")
	}
}

func TestEntityCount(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1"},
		"e2": {Id: "e2"},
	})

	if w.EntityCount() != 2 {
		t.Errorf("expected 2, got %d", w.EntityCount())
	}
}

func TestEntityCount_Empty(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	if w.EntityCount() != 0 {
		t.Errorf("expected 0, got %d", w.EntityCount())
	}
}

func peerRequest[T any](msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	return req
}

func TestListEntities(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("tank")},
		"e2": {Id: "e2", Label: ptr("plane")},
		"e3": {Id: "e3"},
	})

	ctx := context.Background()

	// List all
	resp, err := w.ListEntities(ctx, peerRequest(&pb.ListEntitiesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Msg.Entities) != 3 {
		t.Errorf("expected 3 entities, got %d", len(resp.Msg.Entities))
	}

	// Sorted by ID
	for i := 0; i < len(resp.Msg.Entities)-1; i++ {
		if resp.Msg.Entities[i].Id >= resp.Msg.Entities[i+1].Id {
			t.Error("entities should be sorted by ID")
		}
	}
}

func TestListEntities_WithFilter(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("tank")},
		"e2": {Id: "e2", Label: ptr("plane")},
	})

	ctx := context.Background()
	resp, err := w.ListEntities(ctx, peerRequest(&pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{Label: proto.String("tank")},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Msg.Entities) != 1 || resp.Msg.Entities[0].Id != "e1" {
		t.Errorf("expected 1 entity (e1), got %d", len(resp.Msg.Entities))
	}
}

func TestGetEntity(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("tank")},
	})

	ctx := context.Background()
	resp, err := w.GetEntity(ctx, peerRequest(&pb.GetEntityRequest{Id: "e1"}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.Entity.Id != "e1" {
		t.Errorf("expected e1, got %s", resp.Msg.Entity.Id)
	}
}

func TestGetEntity_NotFound(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})

	ctx := context.Background()
	_, err := w.GetEntity(ctx, peerRequest(&pb.GetEntityRequest{Id: "missing"}))
	if err == nil {
		t.Fatal("expected error for missing entity")
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("expected CodeNotFound, got %v", connect.CodeOf(err))
	}
}

func TestGetLocalNode_NoNode(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})

	ctx := context.Background()
	_, err := w.GetLocalNode(ctx, peerRequest(&pb.GetLocalNodeRequest{}))
	if err == nil {
		t.Fatal("expected error when no node entity")
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("expected CodeNotFound, got %v", connect.CodeOf(err))
	}
}

func TestGetLocalNode_WithNode(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	w.nodeEntity = &pb.Entity{Id: "node.test"}

	ctx := context.Background()
	resp, err := w.GetLocalNode(ctx, peerRequest(&pb.GetLocalNodeRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.Entity.Id != "node.test" {
		t.Errorf("expected node.test, got %s", resp.Msg.Entity.Id)
	}
}

func TestPush(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})

	ctx := context.Background()
	resp, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Label: ptr("new")},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if !resp.Msg.Accepted {
		t.Error("expected accepted=true")
	}

	// Entity should be in head
	e := w.GetHead("e1")
	if e == nil {
		t.Fatal("entity should exist in head")
	}
	if e.Label == nil || *e.Label != "new" {
		t.Errorf("expected label 'new', got %v", e.Label)
	}
	// Lifetime.From should be stamped
	if e.Lifetime == nil || !e.Lifetime.From.IsValid() {
		t.Error("Lifetime.From should be set")
	}
}

func TestPush_MergesExisting(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("original"), Geo: &pb.GeoSpatialComponent{Latitude: 1.0}},
	})

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Label: ptr("updated")},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Label == nil || *e.Label != "updated" {
		t.Error("label should be updated")
	}
	if e.Geo == nil || e.Geo.Latitude != 1.0 {
		t.Error("Geo should be preserved from original")
	}
}

func TestPush_StampsNodeID(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	w.nodeID = "testnode"

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1"},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Controller == nil || e.Controller.Node == nil || *e.Controller.Node != "testnode" {
		t.Error("node ID should be stamped on controller")
	}
}

func TestPush_DoesNotOverwriteExistingNode(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	w.nodeID = "localnode"

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Controller: &pb.Controller{Node: proto.String("remotenode")}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Controller.Node == nil || *e.Controller.Node != "remotenode" {
		t.Error("existing controller.Node should not be overwritten")
	}
}

func TestPush_Frozen(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	w.frozen.Store(true)

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Label: ptr("frozen")},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	// Entity should NOT be in head when frozen
	e := w.GetHead("e1")
	if e != nil {
		t.Error("entity should not be in head when frozen")
	}
}

func TestExpireEntity(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("alive")},
	})

	ctx := context.Background()
	_, err := w.ExpireEntity(ctx, peerRequest(&pb.ExpireEntityRequest{Id: "e1"}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Lifetime == nil || e.Lifetime.Until == nil {
		t.Fatal("Lifetime.Until should be set")
	}
	if e.Lifetime.Until.AsTime().After(time.Now().Add(time.Second)) {
		t.Error("Until should be approximately now")
	}
}

func TestExpireEntity_NotFound(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})

	ctx := context.Background()
	_, err := w.ExpireEntity(ctx, peerRequest(&pb.ExpireEntityRequest{Id: "missing"}))
	if err == nil {
		t.Fatal("expected error for missing entity")
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("expected CodeNotFound, got %v", connect.CodeOf(err))
	}
}

func TestInitNodeIdentity_ExistingNode(t *testing.T) {
	nodeID := "existingid"
	w := testWorld(map[string]*pb.Entity{
		"node.existingid": {
			Id:     "node.existingid",
			Device: &pb.DeviceComponent{Node: &pb.NodeDevice{}},
		},
	})

	w.InitNodeIdentity()

	if w.nodeID != nodeID {
		t.Errorf("expected nodeID=%s, got %s", nodeID, w.nodeID)
	}
	if w.nodeEntity == nil || w.nodeEntity.Id != "node.existingid" {
		t.Error("nodeEntity should be set to existing entity")
	}
}

func TestInitNodeIdentity_CreatesNew(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	w.InitNodeIdentity()

	if w.nodeID == "" {
		t.Error("nodeID should not be empty")
	}
	if w.nodeEntity == nil {
		t.Fatal("nodeEntity should be created")
	}
	if w.nodeEntity.Device == nil || w.nodeEntity.Device.Node == nil {
		t.Error("nodeEntity should have NodeDevice")
	}

	// Entity should be in head
	e := w.GetHead(w.nodeEntity.Id)
	if e == nil {
		t.Error("node entity should be in head")
	}
}

func TestSetWorldFile(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	w.SetWorldFile("/tmp/test.yaml")
	if w.worldFile != "/tmp/test.yaml" {
		t.Errorf("expected /tmp/test.yaml, got %s", w.worldFile)
	}
}

func TestRunTask(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	ctx := context.Background()

	resp, err := w.RunTask(ctx, peerRequest(&pb.RunTaskRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.Status != pb.TaskStatus_TaskStatusInvalid {
		t.Errorf("expected TaskStatusInvalid, got %v", resp.Msg.Status)
	}
	if resp.Msg.ExecutionId != "" {
		t.Errorf("expected empty execution ID, got %s", resp.Msg.ExecutionId)
	}
}

func TestPush_StoresInStore(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Lifetime: &pb.Lifetime{From: timestamppb.Now()}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	// Store should have the event
	min, _ := w.store.GetTimeline()
	if min.IsZero() {
		t.Error("store should have non-zero min time after Push")
	}
}
