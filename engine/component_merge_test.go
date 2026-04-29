package engine

import (
	"context"
	"testing"

	pb "github.com/projectqai/proto/go"

	"google.golang.org/protobuf/proto"
)

func TestMergeRepeatedMetrics_Additive(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Metric: &pb.MetricComponent{
				Metrics: []*pb.Metric{
					{Id: proto.Uint32(2), Val: &pb.Metric_Double{Double: 100}},
				},
			},
		},
	})

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{
				Id: "e1",
				Metric: &pb.MetricComponent{
					Metrics: []*pb.Metric{
						{Id: proto.Uint32(3), Val: &pb.Metric_Double{Double: 200}},
					},
				},
			},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Metric == nil || len(e.Metric.Metrics) != 2 {
		t.Fatalf("expected 2 metrics, got %v", e.Metric)
	}

	byID := map[uint32]float64{}
	for _, m := range e.Metric.Metrics {
		if m.Id != nil {
			byID[*m.Id] = m.GetDouble()
		}
	}
	if byID[2] != 100 {
		t.Errorf("metric 2: want 100, got %v", byID[2])
	}
	if byID[3] != 200 {
		t.Errorf("metric 3: want 200, got %v", byID[3])
	}
}

func TestMergeRepeatedMetrics_UpdateByID(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Metric: &pb.MetricComponent{
				Metrics: []*pb.Metric{
					{Id: proto.Uint32(2), Val: &pb.Metric_Double{Double: 100}},
					{Id: proto.Uint32(3), Val: &pb.Metric_Double{Double: 200}},
				},
			},
		},
	})

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{
				Id: "e1",
				Metric: &pb.MetricComponent{
					Metrics: []*pb.Metric{
						{Id: proto.Uint32(2), Val: &pb.Metric_Double{Double: 999}},
					},
				},
			},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Metric == nil || len(e.Metric.Metrics) != 2 {
		t.Fatalf("expected 2 metrics, got %v", e.Metric)
	}

	byID := map[uint32]float64{}
	for _, m := range e.Metric.Metrics {
		if m.Id != nil {
			byID[*m.Id] = m.GetDouble()
		}
	}
	if byID[2] != 999 {
		t.Errorf("metric 2: want 999 (updated), got %v", byID[2])
	}
	if byID[3] != 200 {
		t.Errorf("metric 3: want 200 (preserved), got %v", byID[3])
	}
}

func TestMergeRepeatedMetrics_Mixed(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Metric: &pb.MetricComponent{
				Metrics: []*pb.Metric{
					{Id: proto.Uint32(1), Val: &pb.Metric_Double{Double: 10}},
					{Id: proto.Uint32(2), Val: &pb.Metric_Double{Double: 20}},
				},
			},
		},
	})

	ctx := context.Background()
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{
				Id: "e1",
				Metric: &pb.MetricComponent{
					Metrics: []*pb.Metric{
						{Id: proto.Uint32(2), Val: &pb.Metric_Double{Double: 99}},
						{Id: proto.Uint32(3), Val: &pb.Metric_Double{Double: 30}},
					},
				},
			},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}

	e := w.GetHead("e1")
	if e.Metric == nil || len(e.Metric.Metrics) != 3 {
		t.Fatalf("expected 3 metrics, got %d", len(e.Metric.Metrics))
	}

	byID := map[uint32]float64{}
	for _, m := range e.Metric.Metrics {
		if m.Id != nil {
			byID[*m.Id] = m.GetDouble()
		}
	}
	if byID[1] != 10 {
		t.Errorf("metric 1: want 10 (preserved), got %v", byID[1])
	}
	if byID[2] != 99 {
		t.Errorf("metric 2: want 99 (updated), got %v", byID[2])
	}
	if byID[3] != 30 {
		t.Errorf("metric 3: want 30 (new), got %v", byID[3])
	}
}

func TestMergeRepeatedMetrics_NoIDNotAccumulated(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Metric: &pb.MetricComponent{
				Metrics: []*pb.Metric{
					{Id: proto.Uint32(1), Val: &pb.Metric_Double{Double: 10}},
					{Val: &pb.Metric_Double{Double: 999}}, // no ID
				},
			},
		},
	})

	ctx := context.Background()
	for i := 0; i < 5; i++ {
		_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
			Changes: []*pb.Entity{
				{
					Id: "e1",
					Metric: &pb.MetricComponent{
						Metrics: []*pb.Metric{
							{Id: proto.Uint32(2), Val: &pb.Metric_Double{Double: float64(i)}},
						},
					},
				},
			},
		}))
		if err != nil {
			t.Fatal(err)
		}
	}

	e := w.GetHead("e1")
	if e.Metric == nil {
		t.Fatal("expected metric component")
	}
	if len(e.Metric.Metrics) != 2 {
		t.Fatalf("expected 2 metrics (id=1 preserved, id=2 latest), got %d", len(e.Metric.Metrics))
	}
}
