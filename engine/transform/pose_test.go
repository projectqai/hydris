package transform

import (
	"math"
	"testing"

	pb "github.com/projectqai/proto/go"
)

func TestPoseTransformer_CartesianOffset(t *testing.T) {
	pt := NewPoseTransformer()
	head := map[string]*pb.Entity{
		"parent": {
			Id: "parent",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
		},
		"child": {
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Cartesian{
					Cartesian: &pb.CartesianOffset{
						EastM:  100,
						NorthM: 200,
					},
				},
			},
		},
	}

	pt.Resolve(head, "child")

	child := head["child"]
	if child.Geo == nil {
		t.Fatal("expected Geo to be set on child")
	}
	// 200m north should move latitude up
	if child.Geo.Latitude <= 51.0 {
		t.Errorf("expected latitude > 51.0, got %f", child.Geo.Latitude)
	}
	// 100m east should move longitude up
	if child.Geo.Longitude <= 7.0 {
		t.Errorf("expected longitude > 7.0, got %f", child.Geo.Longitude)
	}
}

func TestPoseTransformer_PolarOffsetWithRange(t *testing.T) {
	pt := NewPoseTransformer()
	rng := 1000.0
	head := map[string]*pb.Entity{
		"parent": {
			Id: "parent",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
		},
		"child": {
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth: 0, // due north
						Range:   &rng,
					},
				},
			},
		},
	}

	pt.Resolve(head, "child")

	child := head["child"]
	if child.Geo == nil {
		t.Fatal("expected Geo to be set on child")
	}
	// Due north = latitude increase
	if child.Geo.Latitude <= 51.0 {
		t.Errorf("expected latitude > 51.0, got %f", child.Geo.Latitude)
	}
	// Longitude should be roughly the same
	if math.Abs(child.Geo.Longitude-7.0) > 0.0001 {
		t.Errorf("expected longitude ~7.0, got %f", child.Geo.Longitude)
	}
	// Bearing should be set
	if child.Bearing == nil || child.Bearing.Azimuth == nil {
		t.Fatal("expected Bearing to be set")
	}
	if math.Abs(*child.Bearing.Azimuth) > 0.001 {
		t.Errorf("expected azimuth ~0, got %f", *child.Bearing.Azimuth)
	}
}

func TestPoseTransformer_PolarBearingOnly(t *testing.T) {
	pt := NewPoseTransformer()
	head := map[string]*pb.Entity{
		"parent": {
			Id: "parent",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
		},
		"child": {
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth: 90, // due east
						// no range — bearing only
					},
				},
			},
		},
	}

	pt.Resolve(head, "child")

	child := head["child"]
	// No geo without range
	if child.Geo != nil {
		t.Errorf("expected no Geo for bearing-only, got %+v", child.Geo)
	}
	// Bearing should be set
	if child.Bearing == nil || child.Bearing.Azimuth == nil {
		t.Fatal("expected Bearing to be set")
	}
	if math.Abs(*child.Bearing.Azimuth-90) > 0.001 {
		t.Errorf("expected azimuth ~90, got %f", *child.Bearing.Azimuth)
	}
}

func TestPoseTransformer_ParentChangeRecalculatesChild(t *testing.T) {
	pt := NewPoseTransformer()
	head := map[string]*pb.Entity{
		"parent": {
			Id: "parent",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
		},
		"child": {
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Cartesian{
					Cartesian: &pb.CartesianOffset{
						NorthM: 100,
					},
				},
			},
		},
	}

	// Initial resolve
	pt.Resolve(head, "child")
	lat1 := head["child"].Geo.Latitude

	// Move parent north
	head["parent"].Geo.Latitude = 52.0

	// Resolve parent — should re-resolve child
	pt.Resolve(head, "parent")
	lat2 := head["child"].Geo.Latitude

	if lat2 <= lat1 {
		t.Errorf("expected child latitude to increase after parent moved north, was %f now %f", lat1, lat2)
	}
	// Child should be ~100m north of new parent position (52.0)
	if lat2 <= 52.0 {
		t.Errorf("expected child lat > 52.0, got %f", lat2)
	}
}

func TestPoseTransformer_ParentExpiryRemovesChildGeo(t *testing.T) {
	pt := NewPoseTransformer()
	head := map[string]*pb.Entity{
		"parent": {
			Id: "parent",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
		},
		"child": {
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Cartesian{
					Cartesian: &pb.CartesianOffset{NorthM: 100},
				},
			},
		},
	}

	pt.Resolve(head, "child")
	if head["child"].Geo == nil {
		t.Fatal("expected child geo after resolve")
	}

	// Parent expires
	delete(head, "parent")
	pt.Resolve(head, "parent")

	if head["child"].Geo != nil {
		t.Error("expected child Geo to be cleared after parent expired")
	}
}

func TestPoseTransformer_OrientationComposition(t *testing.T) {
	pt := NewPoseTransformer()

	// Parent facing east (90° CW = -90° math = yaw around Z)
	yaw := -90.0 * math.Pi / 180.0 / 2.0
	head := map[string]*pb.Entity{
		"parent": {
			Id: "parent",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
			Orientation: &pb.OrientationComponent{
				Orientation: &pb.Quaternion{
					X: 0, Y: 0,
					Z: math.Sin(yaw),
					W: math.Cos(yaw),
				},
			},
		},
		"child": {
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Cartesian{
					Cartesian: &pb.CartesianOffset{
						NorthM: 100, // 100m in parent's "forward" direction
					},
				},
			},
		},
	}

	pt.Resolve(head, "child")

	child := head["child"]
	if child.Geo == nil {
		t.Fatal("expected Geo to be set")
	}
	// Parent faces east, so child's "north" offset should become eastward
	// Longitude should increase significantly, latitude should be ~same
	if child.Geo.Longitude <= 7.0 {
		t.Errorf("expected longitude > 7.0, got %f", child.Geo.Longitude)
	}
	// Child should inherit parent orientation
	if child.Orientation == nil {
		t.Fatal("expected Orientation to be set on child")
	}
}

func TestPoseTransformer_ChildExpiryCleanup(t *testing.T) {
	pt := NewPoseTransformer()
	head := map[string]*pb.Entity{
		"parent": {
			Id: "parent",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
		},
		"child": {
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Cartesian{
					Cartesian: &pb.CartesianOffset{NorthM: 100},
				},
			},
		},
	}

	pt.Resolve(head, "child")

	// Expire child
	delete(head, "child")
	pt.Resolve(head, "child")

	// Parent change should not panic (no children to resolve)
	head["parent"].Geo.Latitude = 52.0
	pt.Resolve(head, "parent")
}

func TestPoseTransformer_CartesianWithAltitude(t *testing.T) {
	pt := NewPoseTransformer()
	parentAlt := 100.0
	childUp := 50.0
	head := map[string]*pb.Entity{
		"parent": {
			Id: "parent",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
				Altitude:  &parentAlt,
			},
		},
		"child": {
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				Offset: &pb.PoseComponent_Cartesian{
					Cartesian: &pb.CartesianOffset{
						UpM: &childUp,
					},
				},
			},
		},
	}

	pt.Resolve(head, "child")

	child := head["child"]
	if child.Geo == nil {
		t.Fatal("expected Geo")
	}
	if child.Geo.Altitude == nil {
		t.Fatal("expected altitude")
	}
	if math.Abs(*child.Geo.Altitude-150.0) > 0.1 {
		t.Errorf("expected altitude ~150, got %f", *child.Geo.Altitude)
	}
}

func TestPoseTransformer_PolarAzimuthSetsOrientation(t *testing.T) {
	pt := NewPoseTransformer()
	rng := 0.0
	head := map[string]*pb.Entity{
		"base": {
			Id: "base",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
		},
		"head": {
			Id: "head",
			Pose: &pb.PoseComponent{
				Parent: "base",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth: 90, // pointing east
						Range:   &rng,
					},
				},
			},
		},
	}

	pt.Resolve(head, "head")

	child := head["head"]
	// Geo should be resolved (range=0 → same position as parent)
	if child.Geo == nil {
		t.Fatal("expected Geo to be set")
	}

	// OrientationComponent MUST be set from the polar azimuth.
	// This is critical: the ShapeTransformer reads OrientationComponent
	// to orient coverage wedges. Without it the wedge always points north.
	if child.Orientation == nil || child.Orientation.Orientation == nil {
		t.Fatal("expected OrientationComponent to be set from polar azimuth")
	}

	// Extract yaw from the resulting quaternion and verify it matches ~90° bearing.
	yaw := quaternionToYaw(child.Orientation.Orientation)
	if math.Abs(yaw-90) > 0.5 {
		t.Errorf("expected orientation yaw ~90° (east), got %.1f°", yaw)
	}

	// Bearing should also be set
	if child.Bearing == nil || child.Bearing.Azimuth == nil {
		t.Fatal("expected BearingComponent to be set")
	}
	if math.Abs(*child.Bearing.Azimuth-90) > 0.001 {
		t.Errorf("expected bearing azimuth ~90, got %f", *child.Bearing.Azimuth)
	}
}

func TestPoseTransformer_PolarAzimuthComposesWithParentOrientation(t *testing.T) {
	pt := NewPoseTransformer()
	rng := 0.0

	// Parent facing east (90° bearing)
	parentQ := yawToQuaternion(90)

	head := map[string]*pb.Entity{
		"base": {
			Id: "base",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
			Orientation: &pb.OrientationComponent{
				Orientation: parentQ,
			},
		},
		"head": {
			Id: "head",
			Pose: &pb.PoseComponent{
				Parent: "base",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth: 45, // 45° relative to parent
						Range:   &rng,
					},
				},
			},
		},
	}

	pt.Resolve(head, "head")

	child := head["head"]
	if child.Orientation == nil || child.Orientation.Orientation == nil {
		t.Fatal("expected OrientationComponent")
	}

	// Parent faces 90° + child azimuth 45° → absolute 135° (SE)
	yaw := quaternionToYaw(child.Orientation.Orientation)
	if math.Abs(yaw-135) > 1.0 {
		t.Errorf("expected orientation yaw ~135° (parent 90° + child 45°), got %.1f°", yaw)
	}
}

func TestPoseTransformer_PolarBearingOnlySetsOrientation(t *testing.T) {
	pt := NewPoseTransformer()
	head := map[string]*pb.Entity{
		"base": {
			Id: "base",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
		},
		"head": {
			Id: "head",
			Pose: &pb.PoseComponent{
				Parent: "base",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth: 180, // pointing south
						// no range → bearing only
					},
				},
			},
		},
	}

	pt.Resolve(head, "head")

	child := head["head"]
	// No geo without range
	if child.Geo != nil {
		t.Errorf("expected no Geo for bearing-only, got %+v", child.Geo)
	}

	// But OrientationComponent should still be set
	if child.Orientation == nil || child.Orientation.Orientation == nil {
		t.Fatal("expected OrientationComponent even for bearing-only polar offset")
	}

	yaw := quaternionToYaw(child.Orientation.Orientation)
	if math.Abs(yaw-180) > 0.5 {
		t.Errorf("expected orientation yaw ~180° (south), got %.1f°", yaw)
	}
}

func TestPoseTransformer_PolarElevationSetsOrientation(t *testing.T) {
	pt := NewPoseTransformer()
	rng := 0.0
	elev := 30.0
	head := map[string]*pb.Entity{
		"base": {
			Id: "base",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.0,
				Longitude: 7.0,
			},
		},
		"head": {
			Id: "head",
			Pose: &pb.PoseComponent{
				Parent: "base",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth:   0,
						Elevation: &elev,
						Range:     &rng,
					},
				},
			},
		},
	}

	pt.Resolve(head, "head")

	child := head["head"]
	if child.Orientation == nil || child.Orientation.Orientation == nil {
		t.Fatal("expected OrientationComponent to include elevation")
	}

	// The orientation should have a pitch component (X axis rotation).
	// With azimuth=0 and elevation=30, the quaternion should have non-zero X.
	q := child.Orientation.Orientation
	if math.Abs(q.X) < 0.01 {
		t.Errorf("expected non-zero X (pitch) in orientation for elevation=30°, got q={%.3f, %.3f, %.3f, %.3f}",
			q.X, q.Y, q.Z, q.W)
	}
	// Z should be ~0 since azimuth is 0
	if math.Abs(q.Z) > 0.01 {
		t.Errorf("expected ~zero Z (yaw) for azimuth=0°, got q.Z=%.3f", q.Z)
	}
}

func TestPoseTransformer_NoOffset_InheritsParentPosition(t *testing.T) {
	pt := NewPoseTransformer()
	head := map[string]*pb.Entity{
		"parent": {
			Id: "parent",
			Geo: &pb.GeoSpatialComponent{
				Latitude:  52.0,
				Longitude: 10.0,
			},
		},
		"child": {
			Id: "child",
			Pose: &pb.PoseComponent{
				Parent: "parent",
				// no offset set
			},
		},
	}

	pt.Resolve(head, "child")

	child := head["child"]
	if child.Geo == nil {
		t.Fatal("expected Geo to be set on child with no offset")
	}
	if child.Geo.Latitude != 52.0 || child.Geo.Longitude != 10.0 {
		t.Errorf("expected child to inherit parent position (52, 10), got (%f, %f)",
			child.Geo.Latitude, child.Geo.Longitude)
	}
}
