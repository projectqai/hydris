package transform

import (
	"math"

	pb "github.com/projectqai/proto/go"
)

// ellipseSegments is the number of arc segments used to approximate the
// AOU ellipse polygon.
const ellipseSegments = 32

// lobLength is the default line-of-bearing length in meters when no range
// estimate is available (bearing-only detections).
const lobLength = 50_000.0

// AOUTransformer computes an Area of Uncertainty (AOU) shape for entities that
// have a DetectionComponent and sufficient sensor accuracy data
// (MIL-STD-2525C §5.3.4.11.1).
//
// Two cases:
//   - Ellipse AOU: entity has detection + geo + geo.covariance → rotated ellipse
//     polygon written to entity.Shape (GeoShapeComponent).
//   - Line-of-bearing AOU: entity has detection + bearing + no geo + pose.parent →
//     wedge/line LocalShapeComponent relative to the sensor parent. ShapeTransformer
//     converts it to WGS84.
type AOUTransformer struct {
	// managed tracks entity IDs whose Shape or LocalShape is engine-managed by this transformer
	managed map[string]struct{}
}

func NewAOUTransformer() *AOUTransformer {
	return &AOUTransformer{
		managed: make(map[string]struct{}),
	}
}

func (t *AOUTransformer) Validate(_ map[string]*pb.Entity, _ *pb.Entity) error {
	return nil
}

func (t *AOUTransformer) Resolve(head map[string]*pb.Entity, changedID string) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]

	// Entity expired — clean up
	if entity == nil {
		delete(t.managed, changedID)
		return nil, nil
	}

	// Only process entities with a detection component
	if entity.Detection == nil {
		if _, ok := t.managed[changedID]; ok {
			entity.Shape = nil
			entity.LocalShape = nil
			delete(t.managed, changedID)
		}
		return nil, nil
	}

	// Case 1: LOB — detection with bearing and a pose parent
	if entity.Bearing != nil && entity.Bearing.Azimuth != nil &&
		entity.Pose != nil && entity.Pose.Parent != "" {
		entity.Shape = nil // clear stale ellipse shape
		t.computeLOBAOU(entity)
		t.managed[changedID] = struct{}{}
		return nil, nil
	}

	// Case 2: Ellipse AOU from geo + covariance
	if entity.Geo != nil && entity.Geo.Covariance != nil && hasCovarianceData(entity.Geo.Covariance) {
		entity.LocalShape = nil // clear stale LOB local shape
		t.computeEllipseAOU(entity)
		t.managed[changedID] = struct{}{}
		return nil, nil
	}

	// No AOU can be computed — clean up if previously managed
	if _, ok := t.managed[changedID]; ok {
		entity.Shape = nil
		entity.LocalShape = nil
		delete(t.managed, changedID)
	}
	return nil, nil
}

// computeEllipseAOU sets entity.Shape to a polygon approximating the AOU
// ellipse derived from the 2×2 position covariance matrix.
func (t *AOUTransformer) computeEllipseAOU(entity *pb.Entity) {
	cov := entity.Geo.Covariance
	mxx := cov.GetMxx()
	myy := cov.GetMyy()
	mxy := cov.GetMxy()

	// Eigenvalues of 2×2 symmetric matrix [[mxx, mxy], [mxy, myy]]
	avg := (mxx + myy) / 2.0
	diff := (mxx - myy) / 2.0
	disc := math.Sqrt(diff*diff + mxy*mxy)

	lambda1 := avg + disc // larger eigenvalue
	lambda2 := avg - disc // smaller eigenvalue

	if lambda1 <= 0 {
		return
	}
	if lambda2 < 0 {
		lambda2 = 0
	}

	// Semi-axes in meters (1-sigma)
	semiMajor := math.Sqrt(lambda1)
	semiMinor := math.Sqrt(lambda2)

	lat := entity.Geo.Latitude
	lon := entity.Geo.Longitude

	// Use a circle when the ellipse is nearly isotropic (axes within 5%)
	if semiMajor > 0 && (semiMajor-semiMinor)/semiMajor < 0.05 {
		radius := (semiMajor + semiMinor) / 2.0
		entity.Shape = &pb.GeoShapeComponent{
			Geometry: &pb.Geometry{
				Planar: &pb.PlanarGeometry{
					Plane: &pb.PlanarGeometry_Circle{
						Circle: &pb.PlanarCircle{
							Center:  &pb.PlanarPoint{Latitude: lat, Longitude: lon},
							RadiusM: radius,
						},
					},
				},
			},
		}
		return
	}

	// Rotation angle of the major axis.
	// Covariance is in ENU frame: x=East, y=North.
	// Eigenvector for lambda1 is (mxy, lambda1-mxx).
	// atan2(east, north) gives bearing from north, clockwise.
	var theta float64
	if mxy != 0 {
		theta = math.Atan2(mxy, lambda1-mxx)
	} else if mxx >= myy {
		theta = math.Pi / 2 // major axis along East
	}

	points := make([]*pb.PlanarPoint, ellipseSegments+1)
	for i := range ellipseSegments {
		angle := 2.0 * math.Pi * float64(i) / float64(ellipseSegments)
		// Parametric ellipse rotated by theta in ENU frame
		eastM := semiMajor*math.Cos(angle)*math.Sin(theta) + semiMinor*math.Sin(angle)*math.Cos(theta)
		northM := semiMajor*math.Cos(angle)*math.Cos(theta) - semiMinor*math.Sin(angle)*math.Sin(theta)
		points[i] = enuToWGS84(eastM, northM, 0, false, lat, lon)
	}
	points[ellipseSegments] = points[0] // close the ring

	entity.Shape = &pb.GeoShapeComponent{
		Geometry: &pb.Geometry{
			Planar: &pb.PlanarGeometry{
				Plane: &pb.PlanarGeometry_Polygon{
					Polygon: &pb.PlanarPolygon{
						Outer: &pb.PlanarRing{Points: points},
					},
				},
			},
		},
	}
}

// computeLOBAOU sets entity.LocalShape to a line or wedge relative to the
// pose parent (sensor), representing a line-of-bearing AOU.
func (t *AOUTransformer) computeLOBAOU(entity *pb.Entity) {
	polar, ok := entity.Pose.Offset.(*pb.PoseComponent_Polar)
	if !ok || polar.Polar == nil {
		return
	}

	azRad := polar.Polar.Azimuth * math.Pi / 180.0
	length := lobLength
	// Use actual range + 2σ range uncertainty as LOB length
	if polar.Polar.Range != nil {
		length = *polar.Polar.Range
		if polar.Polar.Covariance != nil && polar.Polar.Covariance.GetMzz() > 0 {
			length += 2 * math.Sqrt(polar.Polar.Covariance.GetMzz())
		}
	}

	// Check for bearing error (azimuth variance in covariance.mxx)
	var bearingErrorRad float64
	if polar.Polar.Covariance != nil && polar.Polar.Covariance.GetMxx() > 0 {
		bearingErrorRad = math.Sqrt(polar.Polar.Covariance.GetMxx()) * math.Pi / 180.0
	}

	// MIL-STD-2525C §5.3.4.11.1.3: LOB is a center bearing line with optional
	// bearing error "V" lines. When error lines are present, the shape is a
	// collection: solid center line + dotted left/right error lines.
	var shape *pb.LocalGeometry
	if bearingErrorRad > 0 {
		leftAz := azRad - bearingErrorRad
		rightAz := azRad + bearingErrorRad
		origin := &pb.LocalPoint{EastM: 0, NorthM: 0}
		dotted := pb.LineStyle_LineStyleDotted.Enum()
		shape = &pb.LocalGeometry{
			Shape: &pb.LocalGeometry_Collection{
				Collection: &pb.LocalGeometryCollection{
					Geometries: []*pb.LocalGeometry{
						// center bearing line (solid)
						{Shape: &pb.LocalGeometry_Line{Line: &pb.LocalRing{Points: []*pb.LocalPoint{
							origin,
							{EastM: length * math.Sin(azRad), NorthM: length * math.Cos(azRad)},
						}}}},
						// left error line (dotted)
						{Shape: &pb.LocalGeometry_Line{Line: &pb.LocalRing{Points: []*pb.LocalPoint{
							origin,
							{EastM: length * math.Sin(leftAz), NorthM: length * math.Cos(leftAz)},
						}}}, LineStyle: dotted},
						// right error line (dotted)
						{Shape: &pb.LocalGeometry_Line{Line: &pb.LocalRing{Points: []*pb.LocalPoint{
							origin,
							{EastM: length * math.Sin(rightAz), NorthM: length * math.Cos(rightAz)},
						}}}, LineStyle: dotted},
					},
				},
			},
		}
	} else {
		shape = &pb.LocalGeometry{
			Shape: &pb.LocalGeometry_Line{
				Line: &pb.LocalRing{Points: []*pb.LocalPoint{
					{EastM: 0, NorthM: 0},
					{EastM: length * math.Sin(azRad), NorthM: length * math.Cos(azRad)},
				}},
			},
		}
	}

	entity.LocalShape = &pb.LocalShapeComponent{
		RelativeTo: entity.Pose.Parent,
		Geometry:   shape,
	}
}

// hasCovarianceData returns true if the covariance has at least one non-zero
// position variance component.
func hasCovarianceData(cov *pb.CovarianceMatrix) bool {
	return cov.GetMxx() > 0 || cov.GetMyy() > 0
}
