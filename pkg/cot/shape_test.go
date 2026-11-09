package cot

import (
	"strings"
	"testing"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func planarLine(style *pb.LineStyle, pts ...*pb.PlanarPoint) *pb.PlanarGeometry {
	return &pb.PlanarGeometry{
		Plane:     &pb.PlanarGeometry_Line{Line: &pb.PlanarRing{Points: pts}},
		LineStyle: style,
	}
}

func planarPoint(lat, lon float64) *pb.PlanarPoint {
	return &pb.PlanarPoint{Latitude: lat, Longitude: lon}
}

// bearingFan mirrors an acoustic detection: a symbol, plus a shape collection
// holding a solid bearing line and two dotted uncertainty lines.
func bearingFan() *pb.Entity {
	dotted := pb.LineStyle_LineStyleDotted

	return &pb.Entity{
		Id:     "node.alpha.det.acoustic.drone",
		Label:  proto.String("Drone"),
		Geo:    &pb.GeoSpatialComponent{Latitude: 48.10763099687215, Longitude: 11.511426512244181},
		Symbol: &pb.SymbolComponent{MilStd2525C: "SUAPMFQ---*****"},
		Detection: &pb.DetectionComponent{
			DetectorEntityId: proto.String("node.alpha"),
		},
		Shape: &pb.GeoShapeComponent{
			Geometry: &pb.Geometry{
				Planar: &pb.PlanarGeometry{
					Plane: &pb.PlanarGeometry_Collection{
						Collection: &pb.PlanarGeometryCollection{
							Geometries: []*pb.PlanarGeometry{
								planarLine(nil, planarPoint(48.1, 11.5), planarPoint(48.110174662496206, 11.515235349658909)),
								planarLine(&dotted, planarPoint(48.1, 11.5), planarPoint(48.11118246646545, 11.513559361132184)),
								planarLine(&dotted, planarPoint(48.1, 11.5), planarPoint(48.10905538279546, 11.516744416506567)),
							},
						},
					},
				},
			},
		},
	}
}

// An entity with both a symbol and a shape must emit the symbol marker as well
// as one event per collection member, on distinct UIDs.
func TestEntityWithShapeStillEmitsSymbol(t *testing.T) {
	entity := bearingFan()

	marker, err := EntityToCoT(entity)
	if err != nil {
		t.Fatalf("EntityToCoT: %v", err)
	}
	shape, err := EntityToShapeCoT(entity)
	if err != nil {
		t.Fatalf("EntityToShapeCoT: %v", err)
	}
	out := string(marker) + string(shape)

	want := []string{
		`type="a-u-A"`,
		`<__milsym id="SUAPMFQ---*****">`,
		`uid="node.alpha.det.acoustic.drone"`,
		`uid="node.alpha.det.acoustic.drone.shape.0"`,
		`uid="node.alpha.det.acoustic.drone.shape.1"`,
		`uid="node.alpha.det.acoustic.drone.shape.2"`,
	}
	for _, w := range want {
		if !strings.Contains(out, w) {
			t.Errorf("output missing %s:\n%s", w, out)
		}
	}

	if n := strings.Count(out, "<event "); n != 4 {
		t.Errorf("got %d events, want 4 (1 marker + 3 lines)", n)
	}
	// ATAK's StrokeFillDetailHandler reads the "value" attribute only.
	if n := strings.Count(out, `<strokeStyle value="dotted">`); n != 2 {
		t.Errorf("got %d dotted lines, want 2", n)
	}
	if n := strings.Count(out, `<strokeStyle value="solid">`); n != 1 {
		t.Errorf("got %d solid lines, want 1", n)
	}
	if n := strings.Count(out, `<strokeWeight value="1">`); n != 3 {
		t.Errorf("got %d weighted lines, want 3", n)
	}
	// The detector association must be on every shape event, exactly once each.
	if n := strings.Count(out, `<link uid="node.alpha" relation="p-p">`); n != 3 {
		t.Errorf("got %d association links, want 3", n)
	}
}

func TestEntityShapeDeleteCoTCoversEveryShapeUID(t *testing.T) {
	del, err := EntityShapeDeleteCoT(bearingFan())
	if err != nil {
		t.Fatalf("EntityShapeDeleteCoT: %v", err)
	}

	out := string(del)
	if n := strings.Count(out, "<event "); n != 3 {
		t.Errorf("got %d delete events, want 3", n)
	}
	for _, w := range []string{
		`uid="node.alpha.det.acoustic.drone.shape.0"`,
		`uid="node.alpha.det.acoustic.drone.shape.1"`,
		`uid="node.alpha.det.acoustic.drone.shape.2"`,
	} {
		if !strings.Contains(out, w) {
			t.Errorf("delete output missing %s:\n%s", w, out)
		}
	}
}

func TestEntityShapeDeleteCoTWithoutShape(t *testing.T) {
	del, err := EntityShapeDeleteCoT(&pb.Entity{Id: "plain"})
	if err != nil {
		t.Fatalf("EntityShapeDeleteCoT: %v", err)
	}
	if del != nil {
		t.Errorf("want nil for shapeless entity, got %s", del)
	}
}
