package transform

import (
	"math"
	"testing"

	pb "github.com/projectqai/proto/go"
)

func fptr(f float64) *float64 { return &f }

func TestBuildWedge_Shape(t *testing.T) {
	wedge := buildWedge(90, 0, 100, 0)
	// origin + 17 arc points + closing origin = 19
	if len(wedge.Outer.Points) != wedgeSegments+3 {
		t.Fatalf("expected %d points, got %d", wedgeSegments+3, len(wedge.Outer.Points))
	}
	if wedge.Outer.Points[0].EastM != 0 || wedge.Outer.Points[0].NorthM != 0 {
		t.Error("first point should be origin")
	}
	last := wedge.Outer.Points[len(wedge.Outer.Points)-1]
	if last.EastM != 0 || last.NorthM != 0 {
		t.Error("last point should be origin")
	}
	mid := wedge.Outer.Points[wedgeSegments/2+1]
	if math.Abs(mid.NorthM-100) > 1 {
		t.Errorf("middle arc point north should be ~100, got %v", mid.NorthM)
	}
	if math.Abs(mid.EastM) > 1 {
		t.Errorf("middle arc point east should be ~0, got %v", mid.EastM)
	}
}

func TestBuildWedge_FullCircle(t *testing.T) {
	wedge := buildWedge(360, 0, 50, 0)
	for i := 1; i < len(wedge.Outer.Points)-1; i++ {
		p := wedge.Outer.Points[i]
		dist := math.Sqrt(p.EastM*p.EastM + p.NorthM*p.NorthM)
		if math.Abs(dist-50) > 0.1 {
			t.Errorf("arc point %d distance should be 50, got %v", i, dist)
		}
	}
}

func TestBuildWedge_AnnularSector(t *testing.T) {
	wedge := buildWedge(90, 20, 100, 0)
	// Annular sector: outer arc (17 pts) + inner arc (17 pts) + closing = 35
	expected := 2*(wedgeSegments+1) + 1
	if len(wedge.Outer.Points) != expected {
		t.Fatalf("expected %d points, got %d", expected, len(wedge.Outer.Points))
	}
	// First point should be on outer arc at -halfFOV
	first := wedge.Outer.Points[0]
	dist := math.Sqrt(first.EastM*first.EastM + first.NorthM*first.NorthM)
	if math.Abs(dist-100) > 0.1 {
		t.Errorf("first point should be at range_max, got dist %v", dist)
	}
	// Inner arc points should be at range_min distance
	innerStart := wedgeSegments + 1
	inner := wedge.Outer.Points[innerStart]
	innerDist := math.Sqrt(inner.EastM*inner.EastM + inner.NorthM*inner.NorthM)
	if math.Abs(innerDist-20) > 0.1 {
		t.Errorf("inner arc point should be at range_min, got dist %v", innerDist)
	}
}

func TestCameraTransformer_GeneratesCoverage(t *testing.T) {
	ct := NewCameraTransformer()
	head := map[string]*pb.Entity{
		"cam1": {
			Id: "cam1",
			Camera: &pb.CameraComponent{
				Streams:  []*pb.MediaStream{{Label: "wide"}, {Label: "tele"}},
				Fov:      fptr(120),
				RangeMax: fptr(200),
			},
			Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
		},
	}

	upsert, remove := ct.Resolve(head, "cam1")
	if len(remove) != 0 {
		t.Errorf("expected 0 removes, got %d", len(remove))
	}
	if len(upsert) != 1 {
		t.Fatalf("expected 1 upsert, got %d", len(upsert))
	}
	if upsert[0].Id != "cam1~coverage~0" {
		t.Errorf("unexpected coverage ID: %s", upsert[0].Id)
	}
	if upsert[0].LocalShape == nil || upsert[0].LocalShape.RelativeTo != "cam1" {
		t.Error("coverage entity should have relative_to=cam1")
	}
}

func TestCameraTransformer_PopulatesSensorCoverage(t *testing.T) {
	ct := NewCameraTransformer()
	head := map[string]*pb.Entity{
		"cam1": {
			Id: "cam1",
			Camera: &pb.CameraComponent{
				Streams:  []*pb.MediaStream{{Label: "main"}},
				Fov:      fptr(90),
				RangeMax: fptr(500),
			},
		},
	}

	ct.Resolve(head, "cam1")

	if head["cam1"].Sensor == nil {
		t.Fatal("expected SensorComponent on camera entity")
	}
	if len(head["cam1"].Sensor.Coverage) != 1 {
		t.Fatalf("expected 1 coverage entry, got %d", len(head["cam1"].Sensor.Coverage))
	}
	if head["cam1"].Sensor.Coverage[0] != "cam1~coverage~0" {
		t.Errorf("unexpected coverage ID: %s", head["cam1"].Sensor.Coverage[0])
	}
}

func TestCameraTransformer_SkipsWithoutFovOrRange(t *testing.T) {
	ct := NewCameraTransformer()

	// No range_max → no coverage
	head := map[string]*pb.Entity{
		"cam1": {
			Id: "cam1",
			Camera: &pb.CameraComponent{
				Streams: []*pb.MediaStream{{Label: "main"}},
				Fov:     fptr(90),
			},
		},
	}
	upsert, _ := ct.Resolve(head, "cam1")
	if len(upsert) != 0 {
		t.Errorf("expected 0 upserts without range_max, got %d", len(upsert))
	}

	// No fov → no coverage
	head["cam1"].Camera = &pb.CameraComponent{
		Streams:  []*pb.MediaStream{{Label: "main"}},
		RangeMax: fptr(500),
	}
	upsert, _ = ct.Resolve(head, "cam1")
	if len(upsert) != 0 {
		t.Errorf("expected 0 upserts without fov, got %d", len(upsert))
	}
}

func TestCameraTransformer_CleansUpOnExpiry(t *testing.T) {
	ct := NewCameraTransformer()
	head := map[string]*pb.Entity{
		"cam1": {
			Id: "cam1",
			Camera: &pb.CameraComponent{
				Streams:  []*pb.MediaStream{{Label: "a"}},
				Fov:      fptr(90),
				RangeMax: fptr(500),
			},
		},
	}

	upsert, _ := ct.Resolve(head, "cam1")
	for _, e := range upsert {
		head[e.Id] = e
	}

	delete(head, "cam1")
	_, remove := ct.Resolve(head, "cam1")
	if len(remove) != 1 {
		t.Fatalf("expected 1 remove, got %d", len(remove))
	}
	if len(ct.managed) != 0 {
		t.Error("managed should be empty after expiry")
	}
}

func TestCameraTransformer_IgnoresNoCameraComponent(t *testing.T) {
	ct := NewCameraTransformer()
	head := map[string]*pb.Entity{
		"track1": {
			Id:  "track1",
			Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
		},
	}

	upsert, remove := ct.Resolve(head, "track1")
	if len(upsert) != 0 || len(remove) != 0 {
		t.Error("should not generate anything for entities without CameraComponent")
	}
}
