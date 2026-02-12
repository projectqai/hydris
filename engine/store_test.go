package engine

import (
	"context"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestNewStore(t *testing.T) {
	s := NewStore()
	if s == nil {
		t.Fatal("NewStore returned nil")
	}
	min, max := s.GetTimeline()
	if !min.IsZero() || !max.IsZero() {
		t.Errorf("new store should have zero times, got min=%v max=%v", min, max)
	}
}

func TestStore_Push_UpdatesTimeline(t *testing.T) {
	s := NewStore()
	ctx := context.Background()

	t1 := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)
	t3 := time.Date(2024, 12, 1, 0, 0, 0, 0, time.UTC)

	// Push entity with From only
	err := s.Push(ctx, Event{Entity: &pb.Entity{
		Id:       "e1",
		Lifetime: &pb.Lifetime{From: timestamppb.New(t2)},
	}})
	if err != nil {
		t.Fatal(err)
	}

	min, _ := s.GetTimeline()
	if !min.Equal(t2) {
		t.Errorf("min should be %v, got %v", t2, min)
	}

	// Push earlier entity
	err = s.Push(ctx, Event{Entity: &pb.Entity{
		Id:       "e2",
		Lifetime: &pb.Lifetime{From: timestamppb.New(t1)},
	}})
	if err != nil {
		t.Fatal(err)
	}

	min, _ = s.GetTimeline()
	if !min.Equal(t1) {
		t.Errorf("min should be %v after earlier entity, got %v", t1, min)
	}

	// Push entity with Until
	err = s.Push(ctx, Event{Entity: &pb.Entity{
		Id: "e3",
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(t2),
			Until: timestamppb.New(t3),
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	_, max := s.GetTimeline()
	if !max.Equal(t3) {
		t.Errorf("max should be %v, got %v", t3, max)
	}
}

func TestStore_Push_NoLifetime(t *testing.T) {
	s := NewStore()
	ctx := context.Background()

	// Entity with no lifetime shouldn't change bounds
	err := s.Push(ctx, Event{Entity: &pb.Entity{Id: "e1"}})
	if err != nil {
		t.Fatal(err)
	}

	min, max := s.GetTimeline()
	if !min.IsZero() || !max.IsZero() {
		t.Errorf("entity without lifetime should not change bounds, got min=%v max=%v", min, max)
	}
}

func TestStore_GetEventsInTimeRange(t *testing.T) {
	s := NewStore()
	ctx := context.Background()

	t1 := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)
	t3 := time.Date(2024, 12, 1, 0, 0, 0, 0, time.UTC)

	// Entity valid from t1 with no expiry
	if err := s.Push(ctx, Event{Entity: &pb.Entity{
		Id:       "e1",
		Lifetime: &pb.Lifetime{From: timestamppb.New(t1)},
	}}); err != nil {
		t.Fatal(err)
	}

	// Entity valid from t1 to t2
	if err := s.Push(ctx, Event{Entity: &pb.Entity{
		Id: "e2",
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(t1),
			Until: timestamppb.New(t2),
		},
	}}); err != nil {
		t.Fatal(err)
	}

	// Entity valid from t2
	if err := s.Push(ctx, Event{Entity: &pb.Entity{
		Id:       "e3",
		Lifetime: &pb.Lifetime{From: timestamppb.New(t2)},
	}}); err != nil {
		t.Fatal(err)
	}

	// Query at t1 - should get e1 and e2
	results := s.GetEventsInTimeRange(t1)
	ids := make(map[string]bool)
	for _, e := range results {
		ids[e.Id] = true
	}
	if !ids["e1"] || !ids["e2"] {
		t.Errorf("at t1 expected e1,e2; got %v", ids)
	}
	if ids["e3"] {
		t.Error("e3 should not be visible at t1")
	}

	// Query at t3 - should get e1 and e3 (e2 has expired)
	results = s.GetEventsInTimeRange(t3)
	ids = make(map[string]bool)
	for _, e := range results {
		ids[e.Id] = true
	}
	if !ids["e1"] || !ids["e3"] {
		t.Errorf("at t3 expected e1,e3; got %v", ids)
	}
	if ids["e2"] {
		t.Error("e2 should have expired before t3")
	}
}

func TestStore_GetEventsInTimeRange_LatestVersion(t *testing.T) {
	s := NewStore()
	ctx := context.Background()

	t1 := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)

	// Two versions of same entity
	if err := s.Push(ctx, Event{Entity: &pb.Entity{
		Id:       "e1",
		Label:    ptr("v1"),
		Lifetime: &pb.Lifetime{From: timestamppb.New(t1)},
	}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Push(ctx, Event{Entity: &pb.Entity{
		Id:       "e1",
		Label:    ptr("v2"),
		Lifetime: &pb.Lifetime{From: timestamppb.New(t2)},
	}}); err != nil {
		t.Fatal(err)
	}

	// Query after t2 should get v2
	results := s.GetEventsInTimeRange(t2)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Label == nil || *results[0].Label != "v2" {
		t.Errorf("expected v2, got %v", results[0].Label)
	}

	// Query at t1 should get v1
	results = s.GetEventsInTimeRange(t1)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Label == nil || *results[0].Label != "v1" {
		t.Errorf("expected v1, got %v", results[0].Label)
	}
}

func TestStore_GetEventsInTimeRange_NoLifetime(t *testing.T) {
	s := NewStore()
	ctx := context.Background()

	if err := s.Push(ctx, Event{Entity: &pb.Entity{Id: "e1"}}); err != nil {
		t.Fatal(err)
	}

	results := s.GetEventsInTimeRange(time.Now())
	if len(results) != 0 {
		t.Errorf("entity without lifetime should be excluded, got %d results", len(results))
	}
}

func TestStore_Push_UntilBeforeFrom(t *testing.T) {
	s := NewStore()
	ctx := context.Background()

	t1 := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2024, 12, 1, 0, 0, 0, 0, time.UTC)

	// Push entity where Until comes first (chronologically) but is stored second
	err := s.Push(ctx, Event{Entity: &pb.Entity{
		Id: "e1",
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(t1),
			Until: timestamppb.New(t2),
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	min, max := s.GetTimeline()
	if !min.Equal(t1) {
		t.Errorf("min should be %v, got %v", t1, min)
	}
	if !max.Equal(t2) {
		t.Errorf("max should be %v, got %v", t2, max)
	}
}

func TestStore_Push_OnlyUntil(t *testing.T) {
	s := NewStore()
	ctx := context.Background()

	t1 := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)

	// Entity with only Until set (no From)
	err := s.Push(ctx, Event{Entity: &pb.Entity{
		Id: "e1",
		Lifetime: &pb.Lifetime{
			Until: timestamppb.New(t1),
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	_, max := s.GetTimeline()
	if !max.Equal(t1) {
		t.Errorf("max should be %v, got %v", t1, max)
	}
}
