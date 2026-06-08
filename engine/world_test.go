package engine

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/engine/meta"
	"github.com/projectqai/hydris/pkg/missionpkg"
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

func TestMergeEntityComponents(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {
			Id:       "e1",
			Label:    ptr("original"),
			Geo:      &pb.GeoSpatialComponent{Latitude: 1.0, Longitude: 2.0},
			Lifetime: &pb.Lifetime{From: timestamppb.New(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC))},
		},
	})

	src := &pb.Entity{
		Id:       "e1",
		Label:    ptr("updated"),
		Track:    &pb.TrackComponent{Tracker: proto.String("t1")},
		Lifetime: &pb.Lifetime{From: timestamppb.New(time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC))},
	}

	merged, accepted := w.mergeEntityComponents("e1", w.head["e1"], src, "test", false)
	if !accepted {
		t.Fatal("expected merge to accept components")
	}

	if merged.Label == nil || *merged.Label != "updated" {
		t.Errorf("expected label 'updated', got %v", merged.Label)
	}
	if merged.Geo == nil || merged.Geo.Latitude != 1.0 {
		t.Error("Geo should be preserved from dst")
	}
	if merged.Track == nil || merged.Track.GetTracker() != "t1" {
		t.Error("Track should come from src")
	}
	// Original should not be mutated
	if w.head["e1"].entity.Track != nil {
		t.Error("dst should not be mutated")
	}
}

func TestMergeEntityComponents_EmptySrc(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {
			Id:       "e1",
			Label:    ptr("keep"),
			Geo:      &pb.GeoSpatialComponent{Latitude: 5.0},
			Lifetime: &pb.Lifetime{From: timestamppb.New(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC))},
		},
	})

	src := &pb.Entity{
		Id:       "e1",
		Lifetime: &pb.Lifetime{From: timestamppb.New(time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC))},
	}

	_, accepted := w.mergeEntityComponents("e1", w.head["e1"], src, "test", false)
	if accepted {
		t.Error("merge with no components should not accept anything")
	}
}

func TestComponentAccepted(t *testing.T) {
	t1 := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)
	t3 := time.Date(2025, 1, 3, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name          string
		incomingFresh time.Time
		incomingUntil time.Time
		existing      meta.Component
		want          bool
	}{
		{"existing zero fresh", t1, time.Time{}, meta.Component{}, true},
		{"incoming zero fresh", time.Time{}, time.Time{}, meta.Component{Fresh: t1}, true},
		{"incoming fresher", t2, time.Time{}, meta.Component{Fresh: t1}, true},
		{"incoming older", t1, time.Time{}, meta.Component{Fresh: t2}, false},
		{"equal fresh both permanent", t1, time.Time{}, meta.Component{Fresh: t1}, true},
		{"equal fresh incoming shorter until", t1, t2, meta.Component{Fresh: t1, Until: t3}, true},
		{"equal fresh incoming longer until", t1, t3, meta.Component{Fresh: t1, Until: t2}, false},
		{"equal fresh incoming has until existing permanent", t1, t2, meta.Component{Fresh: t1}, true},
		{"equal fresh incoming permanent existing has until", t1, time.Time{}, meta.Component{Fresh: t1, Until: t2}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := componentAccepted(tt.incomingFresh, tt.incomingUntil, tt.existing); got != tt.want {
				t.Errorf("componentAccepted() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestPush_LWW_RejectsOlder(t *testing.T) {
	t1 := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)

	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("newer"), Lifetime: &pb.Lifetime{From: timestamppb.New(t2)}},
	})

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Label: ptr("older"), Lifetime: &pb.Lifetime{From: timestamppb.New(t1)}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Label == nil || *e.Label != "newer" {
		t.Error("older push should not overwrite newer entity")
	}
}

func TestPush_LWW_AcceptsNewer(t *testing.T) {
	t1 := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)

	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("old"), Lifetime: &pb.Lifetime{From: timestamppb.New(t1)}},
	})

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Label: ptr("new"), Lifetime: &pb.Lifetime{From: timestamppb.New(t2)}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Label == nil || *e.Label != "new" {
		t.Error("newer push should overwrite older entity")
	}
}

func TestPush_LWW_FreshTakesPrecedence(t *testing.T) {
	t1 := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)

	// Existing has newer From but older Fresh
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("old"), Lifetime: &pb.Lifetime{From: timestamppb.New(t2), Fresh: timestamppb.New(t1)}},
	})

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Label: ptr("new"), Lifetime: &pb.Lifetime{From: timestamppb.New(t1), Fresh: timestamppb.New(t2)}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Label == nil || *e.Label != "new" {
		t.Error("Fresh should take precedence over From for LWW comparison")
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
	node := &pb.Entity{Id: "node.test"}
	w := testWorld(map[string]*pb.Entity{"node.test": node})
	w.nodeID = "test"
	w.nodeEntity = node

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
		return
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

func TestPush_ReplacementSwapsEntity(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("original"), Geo: &pb.GeoSpatialComponent{Latitude: 1.0}, Track: &pb.TrackComponent{Tracker: proto.String("t1")}},
	})

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Replacements: []*pb.Entity{
			{Id: "e1", Label: ptr("replaced")},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Label == nil || *e.Label != "replaced" {
		t.Error("label should be replaced")
	}
	if e.Geo != nil {
		t.Error("Geo should be gone after replacement")
	}
	if e.Track != nil {
		t.Error("Track should be gone after replacement")
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

	// Only the federation builtin may set a foreign Controller.Node.
	ctx := context.WithValue(context.Background(), builtinNameKey, "federation")
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

func TestPush_RejectsForeignNodeFromNonFederation(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	w.nodeID = "localnode"

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Controller: &pb.Controller{Node: proto.String("remotenode")}},
		},
	}))
	if err == nil {
		t.Fatal("expected rejection when non-federation caller sets foreign Controller.Node")
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

func TestMergeLifetime_ReflectsLargestSpan(t *testing.T) {
	t1 := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)
	t3 := time.Date(2025, 1, 3, 0, 0, 0, 0, time.UTC)

	w := testWorld(map[string]*pb.Entity{
		"e1": {
			Id:       "e1",
			Label:    ptr("a"),
			Geo:      &pb.GeoSpatialComponent{Latitude: 1},
			Lifetime: &pb.Lifetime{From: timestamppb.New(t1), Until: timestamppb.New(t3)},
		},
	})

	// Push a newer component with a shorter until.
	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Track: &pb.TrackComponent{Tracker: proto.String("t1")},
				Lifetime: &pb.Lifetime{From: timestamppb.New(t2), Until: timestamppb.New(t2)}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	// From should be the earliest (t1), fresh should be the latest (t2).
	if e.Lifetime.From.AsTime() != t1 {
		t.Errorf("From should be earliest component time %v, got %v", t1, e.Lifetime.From.AsTime())
	}
	if e.Lifetime.Fresh.AsTime() != t2 {
		t.Errorf("Fresh should be latest component time %v, got %v", t2, e.Lifetime.Fresh.AsTime())
	}
	// Until should be the latest (t3).
	if e.Lifetime.Until.AsTime() != t3 {
		t.Errorf("Until should be latest component until %v, got %v", t3, e.Lifetime.Until.AsTime())
	}
}

func TestMergeLifetime_NoLifetimePushDoesNotAffectSpan(t *testing.T) {
	now := time.Now()
	until := now.Add(30 * time.Second)

	// Simulate adsblol: entity with Geo, Symbol, and a finite lifetime.
	w := testWorld(map[string]*pb.Entity{
		"e1": {
			Id:       "e1",
			Label:    ptr("flight"),
			Geo:      &pb.GeoSpatialComponent{Latitude: 48},
			Symbol:   &pb.SymbolComponent{MilStd2525C: "SFAPMF--------*"},
			Lifetime: &pb.Lifetime{From: timestamppb.New(now), Until: timestamppb.New(until)},
		},
	})

	// Simulate adsbdb enrichment: push Administrative with no Lifetime at all.
	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Administrative: &pb.AdministrativeComponent{
				Id: proto.String("REG-123"),
			}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Administrative == nil || e.Administrative.GetId() != "REG-123" {
		t.Fatal("Administrative should be merged")
	}
	// The enrichment push (no Lifetime) must not remove Until.
	if e.Lifetime == nil || !e.Lifetime.Until.IsValid() {
		t.Fatal("Lifetime.Until should still be set after no-lifetime enrichment push")
	}
	if !e.Lifetime.Until.AsTime().Equal(until) {
		t.Errorf("Until should remain %v, got %v", until, e.Lifetime.Until.AsTime())
	}
}

func initBuiltins(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	builtin.StartAll(ctx, "")
}

func TestHardReset_ClearsAllEntities(t *testing.T) {
	initBuiltins(t)
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("one")},
		"e2": {Id: "e2", Label: ptr("two")},
	})

	ctx := context.Background()
	_, err := w.HardReset(ctx, peerRequest(&pb.HardResetRequest{}))
	if err != nil {
		t.Fatal(err)
	}

	if w.GetHead("e1") != nil {
		t.Error("e1 should be deleted")
	}
	if w.GetHead("e2") != nil {
		t.Error("e2 should be deleted")
	}
}

func TestLoadMission_Success(t *testing.T) {
	initBuiltins(t)
	dir := t.TempDir()
	store, err := artifacts.NewLocalStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	artifacts.Server = artifacts.NewArtifactServer(store, nil)
	t.Cleanup(func() { artifacts.Server = nil })

	var buf bytes.Buffer
	p := missionpkg.NewPacker(&buf, time.Now())
	p.WriteWorld([]byte("id: sensor.1\nlabel: test\ndevice:\n  state: 1\n"))
	p.WriteIndex(missionpkg.Index{
		MissionKit: &missionpkg.MissionKit{Layouts: map[string]string{"default": "{}"}},
	})
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	artID := "test.mission.zip"
	if err := store.Put(ctx, artID, bytes.NewReader(buf.Bytes())); err != nil {
		t.Fatal(err)
	}

	w := testWorld(map[string]*pb.Entity{
		"old.entity": {Id: "old.entity", Label: ptr("should be wiped")},
	})

	resp, err := w.LoadMission(ctx, peerRequest(&pb.LoadMissionRequest{ArtifactId: artID}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.Mission == nil {
		t.Fatal("response should have mission")
	}
	if resp.Msg.Mission.GetEntityCount() != 1 {
		t.Errorf("entity_count: got %d, want 1", resp.Msg.Mission.GetEntityCount())
	}
	if resp.Msg.Error != nil {
		t.Errorf("unexpected error: %s", *resp.Msg.Error)
	}
	if w.GetHead("old.entity") != nil {
		t.Error("old entity should be wiped")
	}
	if w.GetHead("sensor.1") == nil {
		t.Error("sensor.1 should exist after load")
	}
}

func TestLoadMission_BadArtifact(t *testing.T) {
	initBuiltins(t)
	dir := t.TempDir()
	store, err := artifacts.NewLocalStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	artifacts.Server = artifacts.NewArtifactServer(store, nil)
	t.Cleanup(func() { artifacts.Server = nil })

	ctx := context.Background()
	artID := "bad.zip"
	if err := store.Put(ctx, artID, bytes.NewReader([]byte("not a zip"))); err != nil {
		t.Fatal(err)
	}

	w := testWorld(map[string]*pb.Entity{
		"existing": {Id: "existing", Label: ptr("should survive")},
	})

	_, err = w.LoadMission(ctx, peerRequest(&pb.LoadMissionRequest{ArtifactId: artID}))
	if err == nil {
		t.Fatal("expected error for bad zip")
	}
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("expected CodeInvalidArgument, got %v", connect.CodeOf(err))
	}
	if w.GetHead("existing") == nil {
		t.Error("existing entity should survive — bad zip should not trigger wipe")
	}
}

func TestLoadMission_MissingArtifact(t *testing.T) {
	initBuiltins(t)
	dir := t.TempDir()
	store, err := artifacts.NewLocalStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	artifacts.Server = artifacts.NewArtifactServer(store, nil)
	t.Cleanup(func() { artifacts.Server = nil })

	w := testWorld(map[string]*pb.Entity{})
	ctx := context.Background()

	_, err = w.LoadMission(ctx, peerRequest(&pb.LoadMissionRequest{ArtifactId: "nonexistent"}))
	if err == nil {
		t.Fatal("expected error for missing artifact")
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("expected CodeNotFound, got %v", connect.CodeOf(err))
	}
}

func TestMergeLifetime_NoLifetimeFirstPushDoesNotMakePermanent(t *testing.T) {
	// Edge case: pushing a component with no lifetime creates a new entity,
	// then a second push adds a component with a finite lifetime.
	// The entity should NOT appear permanent — the no-lifetime component
	// should inherit the lifetime from the rest.
	w := testWorld(map[string]*pb.Entity{})

	ctx := context.Background()

	// First push: create entity with no Lifetime at all.
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Administrative: &pb.AdministrativeComponent{
				Id: proto.String("REG-123"),
			}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	// Second push: add a component with a finite lifetime.
	now := time.Now()
	until := now.Add(30 * time.Second)
	_, err = w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "e1", Geo: &pb.GeoSpatialComponent{Latitude: 48},
				Lifetime: &pb.Lifetime{From: timestamppb.New(now), Until: timestamppb.New(until)}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Lifetime == nil || !e.Lifetime.Until.IsValid() {
		t.Fatal("Lifetime.Until should be set — entity must not appear permanent")
	}
	if !e.Lifetime.Until.AsTime().Equal(until) {
		t.Errorf("Until should be %v, got %v", until, e.Lifetime.Until.AsTime())
	}
}
