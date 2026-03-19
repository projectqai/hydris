package transform

import (
	"fmt"
	"math"

	"connectrpc.com/connect"
	pb "github.com/projectqai/proto/go"
)

const earthRadiusM = 6_371_000.0

// ShapeTransformer resolves LocalShapeComponent (ENU local shapes) with a
// non-empty RelativeTo into GeoShapeComponent (WGS84 geo shapes) on the same
// entity. It looks up the parent entity's GeoSpatialComponent and
// OrientationComponent to perform the transform.
type ShapeTransformer struct {
	// byParent maps parent entity ID → shape entity IDs referencing it
	byParent map[string][]string
	// managed tracks entity IDs whose GeoShapeComponent is engine-managed
	managed map[string]struct{}
}

func NewShapeTransformer() *ShapeTransformer {
	return &ShapeTransformer{
		byParent: make(map[string][]string),
		managed:  make(map[string]struct{}),
	}
}

func (st *ShapeTransformer) Validate(head map[string]*pb.Entity, incoming *pb.Entity) error {
	hasLocal := incoming.LocalShape != nil && incoming.LocalShape.Geometry != nil
	hasGeo := incoming.Shape != nil

	if hasLocal && incoming.LocalShape.RelativeTo == "" {
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("entity %s has LocalShapeComponent without relative_to (ambiguous frame)", incoming.Id))
	}

	if hasLocal && incoming.LocalShape.RelativeTo != "" && hasGeo {
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("entity %s has both LocalShapeComponent (relative_to set) and GeoShapeComponent; GeoShapeComponent is engine-managed", incoming.Id))
	}

	return nil
}

func (st *ShapeTransformer) Resolve(head map[string]*pb.Entity, changedID string) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]

	// Entity expired — clean up
	if entity == nil {
		// If it was a managed shape entity, remove from indexes
		if _, ok := st.managed[changedID]; ok {
			delete(st.managed, changedID)
			st.removeChild(changedID)
		}
		// If it was a parent, expire all dependent shape entities whose
		// only purpose is their LocalShapeComponent (they can no longer be resolved).
		if children, ok := st.byParent[changedID]; ok {
			delete(st.byParent, changedID)
			for _, childID := range children {
				delete(st.managed, childID)
				if head[childID] != nil {
					remove = append(remove, childID)
				}
			}
		}
		return nil, remove
	}

	// If entity has LocalShapeComponent with RelativeTo, resolve it
	if entity.LocalShape != nil && entity.LocalShape.RelativeTo != "" {
		st.resolveShape(head, changedID, entity)
	}

	// If entity is a parent, re-resolve all dependent shapes
	if children, ok := st.byParent[changedID]; ok {
		for _, childID := range children {
			if child := head[childID]; child != nil && child.LocalShape != nil && child.LocalShape.RelativeTo != "" {
				st.resolveShape(head, childID, child)
			}
		}
	}

	return nil, nil
}

func (st *ShapeTransformer) resolveShape(head map[string]*pb.Entity, shapeID string, shape *pb.Entity) {
	parentID := shape.LocalShape.RelativeTo
	parent := head[parentID]
	if parent == nil || parent.Geo == nil {
		return
	}

	// Update index: remove old parent ref, add new
	st.removeChild(shapeID)
	st.byParent[parentID] = appendUnique(st.byParent[parentID], shapeID)

	lat := parent.Geo.Latitude
	lon := parent.Geo.Longitude

	var q *pb.Quaternion
	if parent.Orientation != nil {
		q = parent.Orientation.Orientation
	}

	planar := transformLocalToWGS84(shape.LocalShape.Geometry, lat, lon, q)
	if planar == nil {
		return
	}

	shape.Shape = &pb.GeoShapeComponent{
		Geometry: &pb.Geometry{
			Planar: planar,
		},
	}
	st.managed[shapeID] = struct{}{}
}

// removeChild removes shapeID from whichever parent's list it appears in.
func (st *ShapeTransformer) removeChild(shapeID string) {
	for parentID, children := range st.byParent {
		filtered := children[:0]
		for _, c := range children {
			if c != shapeID {
				filtered = append(filtered, c)
			}
		}
		if len(filtered) == 0 {
			delete(st.byParent, parentID)
		} else {
			st.byParent[parentID] = filtered
		}
	}
}

// --- ENU → WGS84 transform ---

func transformLocalToWGS84(local *pb.LocalGeometry, lat, lon float64, q *pb.Quaternion) *pb.PlanarGeometry {
	switch v := local.Shape.(type) {
	case *pb.LocalGeometry_Point:
		return &pb.PlanarGeometry{
			Plane: &pb.PlanarGeometry_Point{
				Point: transformPoint(v.Point, lat, lon, q),
			},
			LineStyle: local.LineStyle,
		}
	case *pb.LocalGeometry_Line:
		return &pb.PlanarGeometry{
			Plane: &pb.PlanarGeometry_Line{
				Line: transformRing(v.Line, lat, lon, q),
			},
			LineStyle: local.LineStyle,
		}
	case *pb.LocalGeometry_Polygon:
		return &pb.PlanarGeometry{
			Plane: &pb.PlanarGeometry_Polygon{
				Polygon: transformPolygon(v.Polygon, lat, lon, q),
			},
			LineStyle: local.LineStyle,
		}
	case *pb.LocalGeometry_Circle:
		return &pb.PlanarGeometry{
			Plane: &pb.PlanarGeometry_Circle{
				Circle: transformCircle(v.Circle, lat, lon, q),
			},
			LineStyle: local.LineStyle,
		}
	case *pb.LocalGeometry_Collection:
		return transformCollection(v.Collection, lat, lon, q, local.LineStyle)
	}
	return nil
}

func transformCollection(c *pb.LocalGeometryCollection, lat, lon float64, q *pb.Quaternion, lineStyle *pb.LineStyle) *pb.PlanarGeometry {
	planarGeometries := make([]*pb.PlanarGeometry, 0, len(c.Geometries))
	for _, g := range c.Geometries {
		p := transformLocalToWGS84(g, lat, lon, q)
		if p != nil {
			planarGeometries = append(planarGeometries, p)
		}
	}
	return &pb.PlanarGeometry{
		Plane: &pb.PlanarGeometry_Collection{
			Collection: &pb.PlanarGeometryCollection{
				Geometries: planarGeometries,
			},
		},
		LineStyle: lineStyle,
	}
}

func transformPoint(p *pb.LocalPoint, lat, lon float64, q *pb.Quaternion) *pb.PlanarPoint {
	east, north, up := p.EastM, p.NorthM, p.GetUpM()
	if q != nil {
		east, north, up = rotateByQuaternion(east, north, up, q)
	}
	return enuToWGS84(east, north, up, p.UpM != nil, lat, lon)
}

func transformRing(r *pb.LocalRing, lat, lon float64, q *pb.Quaternion) *pb.PlanarRing {
	points := make([]*pb.PlanarPoint, len(r.Points))
	for i, p := range r.Points {
		points[i] = transformPoint(p, lat, lon, q)
	}
	return &pb.PlanarRing{Points: points}
}

func transformPolygon(p *pb.LocalPolygon, lat, lon float64, q *pb.Quaternion) *pb.PlanarPolygon {
	result := &pb.PlanarPolygon{
		Outer: transformRing(p.Outer, lat, lon, q),
	}
	for _, hole := range p.Holes {
		result.Holes = append(result.Holes, transformRing(hole, lat, lon, q))
	}
	return result
}

func transformCircle(c *pb.LocalCircle, lat, lon float64, q *pb.Quaternion) *pb.PlanarCircle {
	result := &pb.PlanarCircle{
		Center:  transformPoint(c.Center, lat, lon, q),
		RadiusM: c.RadiusM,
	}
	if c.InnerRadiusM != nil {
		result.InnerRadiusM = c.InnerRadiusM
	}
	return result
}

func enuToWGS84(eastM, northM, upM float64, hasAlt bool, lat, lon float64) *pb.PlanarPoint {
	latRad := lat * math.Pi / 180.0
	dLat := northM / earthRadiusM * (180.0 / math.Pi)
	dLon := eastM / (earthRadiusM * math.Cos(latRad)) * (180.0 / math.Pi)

	p := &pb.PlanarPoint{
		Latitude:  lat + dLat,
		Longitude: lon + dLon,
	}
	if hasAlt {
		p.Altitude = &upM
	}
	return p
}

func rotateByQuaternion(east, north, up float64, q *pb.Quaternion) (float64, float64, float64) {
	qx, qy, qz, qw := q.X, q.Y, q.Z, q.W
	vx, vy, vz := east, north, up

	tx := 2 * (qy*vz - qz*vy)
	ty := 2 * (qz*vx - qx*vz)
	tz := 2 * (qx*vy - qy*vx)

	rx := vx + qw*tx + (qy*tz - qz*ty)
	ry := vy + qw*ty + (qz*tx - qx*tz)
	rz := vz + qw*tz + (qx*ty - qy*tx)

	return rx, ry, rz
}

// multiplyQuaternions returns q1 * q2 (apply q1 first, then q2).
func multiplyQuaternions(q1, q2 *pb.Quaternion) *pb.Quaternion {
	return &pb.Quaternion{
		W: q1.W*q2.W - q1.X*q2.X - q1.Y*q2.Y - q1.Z*q2.Z,
		X: q1.W*q2.X + q1.X*q2.W + q1.Y*q2.Z - q1.Z*q2.Y,
		Y: q1.W*q2.Y - q1.X*q2.Z + q1.Y*q2.W + q1.Z*q2.X,
		Z: q1.W*q2.Z + q1.X*q2.Y - q1.Y*q2.X + q1.Z*q2.W,
	}
}

// --- helpers ---

func appendUnique(s []string, v string) []string {
	for _, existing := range s {
		if existing == v {
			return s
		}
	}
	return append(s, v)
}
