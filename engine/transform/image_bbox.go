package transform

import (
	"math"

	"github.com/projectqai/hydris/engine/meta"
	pb "github.com/projectqai/proto/go"
)

// ImageBboxTransformer computes PoseComponent and bearing angular extents for
// evidence entities that carry an ImageBoundingBox. Uses pinhole projection:
// camera horizontal FOV + frame dimensions → focal length in pixels, then
// pixel coordinates → angular offsets from the optical axis.
//
// Must run before PoseTransformer so the generated PoseComponent is resolved
// into absolute bearing and geo.
type ImageBboxTransformer struct{}

func NewImageBboxTransformer() *ImageBboxTransformer {
	return &ImageBboxTransformer{}
}

func (t *ImageBboxTransformer) Validate(_ map[string]*pb.Entity, _ *pb.Entity) error {
	return nil
}

func (t *ImageBboxTransformer) Reindex(_ map[string]*pb.Entity, _ string) {}

func (t *ImageBboxTransformer) Name() string { return "image_bbox" }

func (t *ImageBboxTransformer) Resolve(head map[string]*pb.Entity, changedID string, _ map[int32]meta.Component) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]
	if entity == nil {
		return nil, nil
	}

	det := entity.Detection
	if det == nil || det.ImageBbox == nil || det.DetectorEntityId == nil {
		return nil, nil
	}

	bbox := det.ImageBbox
	if bbox.FrameWidth == 0 || bbox.FrameHeight == 0 {
		return nil, nil
	}

	camera := head[*det.DetectorEntityId]
	if camera == nil || camera.Camera == nil || camera.Camera.Fov == nil {
		return nil, nil
	}

	fovDeg := *camera.Camera.Fov
	if fovDeg <= 0 {
		return nil, nil
	}

	fw := float64(bbox.FrameWidth)
	fh := float64(bbox.FrameHeight)
	fovRad := fovDeg * math.Pi / 180.0

	focalPx := fw / (2.0 * math.Tan(fovRad/2.0))

	cx := float64(bbox.X) + float64(bbox.Width)/2.0
	cy := float64(bbox.Y) + float64(bbox.Height)/2.0

	var cameraPan, cameraTilt float64
	if camera.Camera.FocalPoint != nil {
		if fp := head[*camera.Camera.FocalPoint]; fp != nil && fp.Pose != nil {
			if polar, ok := fp.Pose.Offset.(*pb.PoseComponent_Polar); ok {
				cameraPan = polar.Polar.Azimuth
				if polar.Polar.Elevation != nil {
					cameraTilt = *polar.Polar.Elevation
				}
			}
		}
	}

	// Cast the ray through a pixel and rotate it by the camera tilt. Adding
	// pixel angles to pan/tilt directly is only right for a level camera:
	// tilted, a horizontal pixel offset spans more azimuth (≈1/cos tilt) and
	// shifts elevation.
	sinT, cosT := math.Sincos(cameraTilt * math.Pi / 180.0)
	ray := func(px, py float64) (azDeg, elDeg float64) {
		right := px - fw/2.0
		up := fh/2.0 - py
		north := focalPx*cosT - up*sinT // along the pan direction
		vert := focalPx*sinT + up*cosT
		azDeg = cameraPan + math.Atan2(right, north)*180.0/math.Pi
		elDeg = math.Atan2(vert, math.Hypot(right, north)) * 180.0 / math.Pi
		return azDeg, elDeg
	}

	azimuthDeg, elevationDeg := ray(cx, cy)
	azimuthDeg = math.Mod(azimuthDeg+360, 360)

	leftAz, _ := ray(float64(bbox.X), cy)
	rightAz, _ := ray(float64(bbox.X+bbox.Width), cy)
	_, topEl := ray(cx, float64(bbox.Y))
	_, bottomEl := ray(cx, float64(bbox.Y+bbox.Height))

	azExtentDeg := math.Mod(rightAz-leftAz+720, 360)
	elExtentDeg := topEl - bottomEl

	entity.Pose = &pb.PoseComponent{
		Parent: *det.DetectorEntityId,
		Offset: &pb.PoseComponent_Polar{
			Polar: &pb.PolarOffset{
				Azimuth:   azimuthDeg,
				Elevation: &elevationDeg,
			},
		},
	}

	// A downward-looking camera at a known height bounds the range: for a
	// ground target the line of sight ends where it meets the ground, and
	// the bbox's top and bottom edges give the near and far limits. Without
	// this the detection is a bare line of bearing, tens of kilometres long.
	if rng, rngErr, ok := groundRange(head, camera, det, azimuthDeg, elevationDeg, topEl, bottomEl); ok {
		polar := entity.Pose.Offset.(*pb.PoseComponent_Polar).Polar
		polar.Range = &rng
		polar.RangeErrorM = &rngErr
	}

	// Pre-set bearing extent fields. PoseTransformer will compute the absolute
	// center bearing and preserve these values.
	entity.Bearing = &pb.BearingComponent{
		AzimuthExtentDeg:   &azExtentDeg,
		ElevationExtentDeg: &elExtentDeg,
	}

	return nil, nil
}

// groundRange intersects the detection's line of sight with flat ground at
// altitude 0, seen from the camera. It reports the slant range to the bbox
// centre and half the spread between the bbox's bottom and top edges.
//
// It only applies to ground targets: it is skipped when the camera has no
// altitude, when the sight line does not reach the ground (at or above the
// horizon, including the bbox's top edge), or when the evidence is known to
// be airborne.
func groundRange(head map[string]*pb.Entity, camera *pb.Entity, det *pb.DetectionComponent,
	azDeg, elDeg, topEl, bottomEl float64) (rng, rngErr float64, ok bool) {
	if camera.Geo == nil || camera.Geo.Altitude == nil || *camera.Geo.Altitude <= 0 {
		return 0, 0, false
	}
	for _, id := range det.Evidence {
		if ev := head[id]; ev != nil {
			switch ev.GetClassification().GetDimension() {
			case pb.ClassificationBattleDimension_ClassificationBattleDimensionAir,
				pb.ClassificationBattleDimension_ClassificationBattleDimensionSpace:
				return 0, 0, false
			}
		}
	}
	alt := *camera.Geo.Altitude
	var q *pb.Quaternion
	if camera.Orientation != nil {
		q = camera.Orientation.Orientation
	}
	// Slant range along (az, el) given in the camera's frame to the ground.
	slant := func(el float64) (float64, bool) {
		az, e := azDeg*math.Pi/180.0, el*math.Pi/180.0
		east := math.Cos(e) * math.Sin(az)
		north := math.Cos(e) * math.Cos(az)
		up := math.Sin(e)
		if q != nil {
			_, _, up = rotateByQuaternion(east, north, up, q)
		}
		if up >= -1e-3 {
			return 0, false
		}
		return alt / -up, true
	}
	centre, ok1 := slant(elDeg)
	near, ok2 := slant(bottomEl)
	far, ok3 := slant(topEl)
	if !ok1 || !ok2 || !ok3 {
		return 0, 0, false
	}
	return centre, math.Abs(far-near) / 2, true
}
