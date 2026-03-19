package transform

import (
	"math"
	"testing"

	pb "github.com/projectqai/proto/go"
)

func TestENUtoWGS84_NorthOffset(t *testing.T) {
	p := enuToWGS84(0, 1000, 0, false, 0, 0)
	expectedLat := 1000.0 / earthRadiusM * (180.0 / math.Pi)
	if math.Abs(p.Latitude-expectedLat) > 1e-10 {
		t.Errorf("latitude: got %v, want %v", p.Latitude, expectedLat)
	}
	if math.Abs(p.Longitude) > 1e-10 {
		t.Errorf("longitude should be ~0, got %v", p.Longitude)
	}
	if p.Altitude != nil {
		t.Error("altitude should be nil when hasAlt=false")
	}
}

func TestENUtoWGS84_EastOffset(t *testing.T) {
	lat := 45.0
	p := enuToWGS84(1000, 0, 0, false, lat, 10)
	latRad := lat * math.Pi / 180.0
	expectedDLon := 1000.0 / (earthRadiusM * math.Cos(latRad)) * (180.0 / math.Pi)
	if math.Abs(p.Longitude-(10+expectedDLon)) > 1e-10 {
		t.Errorf("longitude: got %v, want %v", p.Longitude, 10+expectedDLon)
	}
	if math.Abs(p.Latitude-lat) > 1e-10 {
		t.Errorf("latitude should be unchanged, got %v", p.Latitude)
	}
}

func TestENUtoWGS84_WithAltitude(t *testing.T) {
	alt := 500.0
	p := enuToWGS84(0, 0, alt, true, 0, 0)
	if p.Altitude == nil || *p.Altitude != alt {
		t.Errorf("altitude: got %v, want %v", p.Altitude, alt)
	}
}

func TestRotateByQuaternion_Identity(t *testing.T) {
	q := &pb.Quaternion{X: 0, Y: 0, Z: 0, W: 1}
	rx, ry, rz := rotateByQuaternion(100, 200, 300, q)
	if math.Abs(rx-100) > 1e-10 || math.Abs(ry-200) > 1e-10 || math.Abs(rz-300) > 1e-10 {
		t.Errorf("identity rotation should not change point: got (%v, %v, %v)", rx, ry, rz)
	}
}

func TestRotateByQuaternion_90DegYaw(t *testing.T) {
	angle := math.Pi / 2
	q := &pb.Quaternion{X: 0, Y: 0, Z: math.Sin(angle / 2), W: math.Cos(angle / 2)}
	rx, ry, rz := rotateByQuaternion(100, 0, 0, q)
	if math.Abs(rx) > 1e-6 || math.Abs(ry-100) > 1e-6 || math.Abs(rz) > 1e-6 {
		t.Errorf("90° yaw of (100,0,0): got (%v, %v, %v), want (0, 100, 0)", rx, ry, rz)
	}
}

func TestTransformLocalToWGS84_Point(t *testing.T) {
	local := &pb.LocalGeometry{
		Shape: &pb.LocalGeometry_Point{
			Point: &pb.LocalPoint{EastM: 100, NorthM: 200},
		},
	}
	result := transformLocalToWGS84(local, 48.0, 11.0, nil)
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	pp, ok := result.Plane.(*pb.PlanarGeometry_Point)
	if !ok {
		t.Fatal("expected PlanarGeometry_Point")
	}
	if pp.Point.Latitude <= 48.0 {
		t.Error("latitude should increase with north offset")
	}
	if pp.Point.Longitude <= 11.0 {
		t.Error("longitude should increase with east offset")
	}
}

func TestTransformLocalToWGS84_Circle(t *testing.T) {
	local := &pb.LocalGeometry{
		Shape: &pb.LocalGeometry_Circle{
			Circle: &pb.LocalCircle{
				Center:  &pb.LocalPoint{EastM: 0, NorthM: 0},
				RadiusM: 500,
			},
		},
	}
	result := transformLocalToWGS84(local, 48.0, 11.0, nil)
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	pc, ok := result.Plane.(*pb.PlanarGeometry_Circle)
	if !ok {
		t.Fatal("expected PlanarGeometry_Circle")
	}
	if pc.Circle.RadiusM != 500 {
		t.Errorf("radius should be preserved: got %v", pc.Circle.RadiusM)
	}
	if math.Abs(pc.Circle.Center.Latitude-48.0) > 1e-6 {
		t.Error("center latitude should be ~48.0")
	}
}

func TestTransformLocalToWGS84_Polygon(t *testing.T) {
	local := &pb.LocalGeometry{
		Shape: &pb.LocalGeometry_Polygon{
			Polygon: &pb.LocalPolygon{
				Outer: &pb.LocalRing{
					Points: []*pb.LocalPoint{
						{EastM: 0, NorthM: 0},
						{EastM: 100, NorthM: 0},
						{EastM: 100, NorthM: 100},
						{EastM: 0, NorthM: 0},
					},
				},
			},
		},
	}
	result := transformLocalToWGS84(local, 48.0, 11.0, nil)
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	pp, ok := result.Plane.(*pb.PlanarGeometry_Polygon)
	if !ok {
		t.Fatal("expected PlanarGeometry_Polygon")
	}
	if len(pp.Polygon.Outer.Points) != 4 {
		t.Errorf("expected 4 outer points, got %d", len(pp.Polygon.Outer.Points))
	}
}

// --- ShapeTransformer tests ---

func TestResolve_WritesGeoShapeOnEntity(t *testing.T) {
	st := NewShapeTransformer()
	head := map[string]*pb.Entity{
		"parent1": {
			Id:  "parent1",
			Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
		},
		"shape1": {
			Id: "shape1",
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: "parent1",
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Circle{
						Circle: &pb.LocalCircle{
							Center:  &pb.LocalPoint{EastM: 0, NorthM: 0},
							RadiusM: 1000,
						},
					},
				},
			},
		},
	}

	st.Resolve(head, "shape1")

	if head["shape1"].Shape == nil || head["shape1"].Shape.Geometry == nil {
		t.Fatal("expected GeoShapeComponent on shape entity")
	}
	pc, ok := head["shape1"].Shape.Geometry.Planar.Plane.(*pb.PlanarGeometry_Circle)
	if !ok {
		t.Fatal("expected circle geometry")
	}
	if pc.Circle.RadiusM != 1000 {
		t.Errorf("radius should be 1000, got %v", pc.Circle.RadiusM)
	}
}

func TestResolve_ReResolvesWhenParentPositionChanges(t *testing.T) {
	st := NewShapeTransformer()
	head := map[string]*pb.Entity{
		"parent1": {
			Id:  "parent1",
			Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
		},
		"shape1": {
			Id: "shape1",
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: "parent1",
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Point{
						Point: &pb.LocalPoint{EastM: 100, NorthM: 0},
					},
				},
			},
		},
	}

	// Initial resolve
	st.Resolve(head, "shape1")
	origLon := head["shape1"].Shape.Geometry.Planar.GetPlane().(*pb.PlanarGeometry_Point).Point.Longitude

	// Move parent
	head["parent1"].Geo.Longitude = 12.0
	st.Resolve(head, "parent1")

	newLon := head["shape1"].Shape.Geometry.Planar.GetPlane().(*pb.PlanarGeometry_Point).Point.Longitude
	if newLon == origLon {
		t.Error("shape should have changed after parent position update")
	}
}

func TestResolve_ReResolvesWhenParentOrientationChanges(t *testing.T) {
	st := NewShapeTransformer()
	head := map[string]*pb.Entity{
		"parent1": {
			Id:  "parent1",
			Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
		},
		"shape1": {
			Id: "shape1",
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: "parent1",
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Point{
						Point: &pb.LocalPoint{EastM: 100, NorthM: 0},
					},
				},
			},
		},
	}

	st.Resolve(head, "shape1")
	origLat := head["shape1"].Shape.Geometry.Planar.GetPlane().(*pb.PlanarGeometry_Point).Point.Latitude

	// Add orientation (90° yaw)
	angle := math.Pi / 2
	head["parent1"].Orientation = &pb.OrientationComponent{
		Orientation: &pb.Quaternion{X: 0, Y: 0, Z: math.Sin(angle / 2), W: math.Cos(angle / 2)},
	}
	st.Resolve(head, "parent1")

	newLat := head["shape1"].Shape.Geometry.Planar.GetPlane().(*pb.PlanarGeometry_Point).Point.Latitude
	if newLat == origLat {
		t.Error("shape should have changed after parent orientation update")
	}
}

func TestResolve_CleansUpWhenShapeEntityExpires(t *testing.T) {
	st := NewShapeTransformer()
	head := map[string]*pb.Entity{
		"parent1": {
			Id:  "parent1",
			Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
		},
		"shape1": {
			Id: "shape1",
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: "parent1",
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Point{Point: &pb.LocalPoint{EastM: 50, NorthM: 50}},
				},
			},
		},
	}

	st.Resolve(head, "shape1")
	if len(st.managed) != 1 {
		t.Fatal("expected 1 managed entity")
	}
	if len(st.byParent["parent1"]) != 1 {
		t.Fatal("expected 1 child for parent1")
	}

	// Expire shape entity
	delete(head, "shape1")
	st.Resolve(head, "shape1")

	if len(st.managed) != 0 {
		t.Error("managed should be empty after shape expiration")
	}
	if len(st.byParent) != 0 {
		t.Error("byParent should be empty after shape expiration")
	}
}

func TestResolve_CleansUpWhenParentEntityExpires(t *testing.T) {
	st := NewShapeTransformer()
	head := map[string]*pb.Entity{
		"parent1": {
			Id:  "parent1",
			Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
		},
		"shape1": {
			Id: "shape1",
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: "parent1",
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Point{Point: &pb.LocalPoint{EastM: 50, NorthM: 50}},
				},
			},
		},
	}

	st.Resolve(head, "shape1")

	// Expire parent
	delete(head, "parent1")
	_, remove := st.Resolve(head, "parent1")

	if len(remove) != 1 || remove[0] != "shape1" {
		t.Errorf("expected shape1 in remove list, got %v", remove)
	}
	if len(st.managed) != 0 {
		t.Error("managed should be empty after parent expiration")
	}
	if len(st.byParent) != 0 {
		t.Error("byParent should be empty after parent expiration")
	}
}

func TestValidate_RejectsLocalShapeWithoutRelativeTo(t *testing.T) {
	st := NewShapeTransformer()
	incoming := &pb.Entity{
		Id: "shape1",
		LocalShape: &pb.LocalShapeComponent{
			Geometry: &pb.LocalGeometry{
				Shape: &pb.LocalGeometry_Point{Point: &pb.LocalPoint{EastM: 0, NorthM: 0}},
			},
		},
	}

	err := st.Validate(nil, incoming)
	if err == nil {
		t.Fatal("expected validation error for LocalShapeComponent without relative_to")
	}
}

func TestValidate_RejectsBothLocalShapeAndGeoShape(t *testing.T) {
	st := NewShapeTransformer()
	incoming := &pb.Entity{
		Id: "shape1",
		LocalShape: &pb.LocalShapeComponent{
			RelativeTo: "parent1",
			Geometry: &pb.LocalGeometry{
				Shape: &pb.LocalGeometry_Point{Point: &pb.LocalPoint{EastM: 0, NorthM: 0}},
			},
		},
		Shape: &pb.GeoShapeComponent{
			Geometry: &pb.Geometry{},
		},
	}

	err := st.Validate(nil, incoming)
	if err == nil {
		t.Fatal("expected validation error for both LocalShapeComponent and GeoShapeComponent")
	}
}

func TestValidate_AllowsGeoShapeAlone(t *testing.T) {
	st := NewShapeTransformer()
	incoming := &pb.Entity{
		Id: "shape1",
		Shape: &pb.GeoShapeComponent{
			Geometry: &pb.Geometry{},
		},
	}

	err := st.Validate(nil, incoming)
	if err != nil {
		t.Fatalf("expected no error for GeoShapeComponent alone, got: %v", err)
	}
}
