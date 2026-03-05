package transform

import (
	"fmt"
	"math"

	pb "github.com/projectqai/proto/go"
)

// wedgeSegments is the number of arc segments used to approximate the
// curved edge of the camera FOV wedge polygon.
const wedgeSegments = 16

// CameraTransformer generates a LocalShapeComponent coverage wedge for an
// entity's CameraComponent when fov and range are set.
// Generated shape entities have IDs of the form "{entityID}~coverage~0".
// All generated IDs are written into SensorComponent.coverage on the source entity.
type CameraTransformer struct {
	// managed maps camera entity ID → list of generated coverage entity IDs
	managed map[string][]string
	// focalPointToCamera maps focal point entity ID → camera entity ID
	focalPointToCamera map[string]string
}

func NewCameraTransformer() *CameraTransformer {
	return &CameraTransformer{
		managed:            make(map[string][]string),
		focalPointToCamera: make(map[string]string),
	}
}

func (ct *CameraTransformer) Validate(head map[string]*pb.Entity, incoming *pb.Entity) error {
	return nil
}

func (ct *CameraTransformer) Resolve(head map[string]*pb.Entity, changedID string) (upsert []*pb.Entity, remove []string) {
	// If the changed entity is a focal point, re-resolve the owning camera.
	if camID, ok := ct.focalPointToCamera[changedID]; ok {
		return ct.Resolve(head, camID)
	}

	entity := head[changedID]

	cleanup := func() {
		if prev, ok := ct.managed[changedID]; ok {
			remove = append(remove, prev...)
			delete(ct.managed, changedID)
		}
		for fpID, camID := range ct.focalPointToCamera {
			if camID == changedID {
				delete(ct.focalPointToCamera, fpID)
			}
		}
	}

	// Entity expired — clean up all generated coverage
	if entity == nil {
		cleanup()
		return upsert, remove
	}

	// Only act on entities with CameraComponent that has range set.
	cc := entity.Camera
	if cc == nil || cc.RangeMax == nil || *cc.RangeMax <= 0 {
		cleanup()
		return upsert, remove
	}

	rangeMax := *cc.RangeMax

	// If the camera has a focal point, use its pose for FOV calculation.
	var pose *pb.PoseComponent
	var fpEntity *pb.Entity
	if cc.FocalPoint != nil && *cc.FocalPoint != "" {
		ct.focalPointToCamera[*cc.FocalPoint] = changedID
		fpEntity = head[*cc.FocalPoint]
		if fpEntity != nil {
			pose = fpEntity.Pose
		}
	} else {
		pose = entity.Pose
	}

	fov := effectiveFOV(cc, pose)
	if fov <= 0 || fov > 360 {
		if prev, ok := ct.managed[changedID]; ok {
			remove = append(remove, prev...)
			delete(ct.managed, changedID)
		}
		return upsert, remove
	}

	var rangeMin float64
	if cc.RangeMin != nil {
		rangeMin = *cc.RangeMin
	}

	prevSet := make(map[string]struct{})
	for _, id := range ct.managed[changedID] {
		prevSet[id] = struct{}{}
	}

	// Extract bearing from focal point's azimuth.
	var bearingDeg float64
	if fpEntity != nil && fpEntity.Pose != nil {
		if polar, ok := fpEntity.Pose.Offset.(*pb.PoseComponent_Polar); ok && polar.Polar != nil {
			bearingDeg = polar.Polar.Azimuth
		}
	}

	covID := fmt.Sprintf("%s~coverage~0", changedID)
	newIDs := []string{covID}
	delete(prevSet, covID)

	wedge := buildWedge(fov, rangeMin, rangeMax, bearingDeg)
	upsert = append(upsert, &pb.Entity{
		Id: covID,
		LocalShape: &pb.LocalShapeComponent{
			RelativeTo: changedID,
			Geometry: &pb.LocalGeometry{
				Shape: &pb.LocalGeometry_Polygon{
					Polygon: wedge,
				},
			},
		},
	})

	// If there's a focal point, add a line from the camera to it.
	if fpEntity != nil && fpEntity.Pose != nil {
		lineID := fmt.Sprintf("%s~aimline~0", changedID)
		newIDs = append(newIDs, lineID)
		delete(prevSet, lineID)

		var east, north float64
		if polar, ok := fpEntity.Pose.Offset.(*pb.PoseComponent_Polar); ok && polar.Polar != nil {
			az := polar.Polar.Azimuth * math.Pi / 180.0
			rng := 0.0
			if polar.Polar.Range != nil {
				rng = *polar.Polar.Range
			}
			east = rng * math.Sin(az)
			north = rng * math.Cos(az)
		}

		upsert = append(upsert, &pb.Entity{
			Id: lineID,
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: changedID,
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Line{
						Line: &pb.LocalRing{
							Points: []*pb.LocalPoint{
								{EastM: 0, NorthM: 0},
								{EastM: east, NorthM: north},
							},
						},
					},
				},
			},
		})
	}

	// Remove stale coverage entities
	for staleID := range prevSet {
		remove = append(remove, staleID)
	}

	ct.managed[changedID] = newIDs

	// Update SensorComponent.coverage on the source entity
	if entity.Sensor == nil {
		entity.Sensor = &pb.SensorComponent{}
	}
	entity.Sensor.Coverage = newIDs

	return upsert, remove
}

// effectiveFOV computes the current field of view for a camera.
// If fov_wide, fov_tele, and range_max are set, uses PolarOffset.range
// (focal distance) to interpolate: zoom = range/range_max, then
// fov = fov_wide + zoom*(fov_tele - fov_wide).
// Falls back to the static fov field.
func effectiveFOV(cc *pb.CameraComponent, pose *pb.PoseComponent) float64 {
	if cc.FovWide != nil && cc.FovTele != nil && cc.RangeMax != nil && *cc.RangeMax > 0 {
		wide := *cc.FovWide
		tele := *cc.FovTele
		if wide > 0 && tele > 0 && tele < wide {
			// Extract focal distance from PolarOffset.range
			var focalRange float64
			if pose != nil {
				if polar, ok := pose.Offset.(*pb.PoseComponent_Polar); ok && polar.Polar.Range != nil {
					focalRange = *polar.Polar.Range
				}
			}
			zoom := focalRange / *cc.RangeMax
			if zoom < 0 {
				zoom = 0
			}
			if zoom > 1 {
				zoom = 1
			}
			return wide + zoom*(tele-wide)
		}
	}
	if cc.Fov != nil {
		return *cc.Fov
	}
	return 0
}

// buildWedge creates a polygon in ENU space representing a camera FOV sector.
// When rangeMin > 0, produces an annular sector (donut slice) with a hole
// for the blind zone. Otherwise produces a simple wedge from the origin.
// bearingDeg rotates the entire wedge (0° = north).
func buildWedge(fovDeg, rangeMin, rangeMax, bearingDeg float64) *pb.LocalPolygon {
	halfFOV := fovDeg / 2.0 * math.Pi / 180.0
	bearing := bearingDeg * math.Pi / 180.0

	if rangeMin <= 0 {
		// Simple wedge from origin
		points := make([]*pb.LocalPoint, 0, wedgeSegments+3)
		points = append(points, &pb.LocalPoint{EastM: 0, NorthM: 0})
		for i := range wedgeSegments + 1 {
			angle := bearing - halfFOV + (2*halfFOV)*float64(i)/float64(wedgeSegments)
			points = append(points, &pb.LocalPoint{
				EastM:  rangeMax * math.Sin(angle),
				NorthM: rangeMax * math.Cos(angle),
			})
		}
		points = append(points, &pb.LocalPoint{EastM: 0, NorthM: 0})
		return &pb.LocalPolygon{
			Outer: &pb.LocalRing{Points: points},
		}
	}

	// Annular sector: outer arc forward, inner arc backward, closed
	points := make([]*pb.LocalPoint, 0, 2*(wedgeSegments+1)+1)

	// Outer arc: -halfFOV to +halfFOV
	for i := range wedgeSegments + 1 {
		angle := bearing - halfFOV + (2*halfFOV)*float64(i)/float64(wedgeSegments)
		points = append(points, &pb.LocalPoint{
			EastM:  rangeMax * math.Sin(angle),
			NorthM: rangeMax * math.Cos(angle),
		})
	}

	// Inner arc: +halfFOV back to -halfFOV
	for i := wedgeSegments; i >= 0; i-- {
		angle := bearing - halfFOV + (2*halfFOV)*float64(i)/float64(wedgeSegments)
		points = append(points, &pb.LocalPoint{
			EastM:  rangeMin * math.Sin(angle),
			NorthM: rangeMin * math.Cos(angle),
		})
	}

	// Close
	points = append(points, points[0])

	return &pb.LocalPolygon{
		Outer: &pb.LocalRing{Points: points},
	}
}
