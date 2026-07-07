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

	azimuthDeg := cameraPan + math.Atan2(cx-fw/2.0, focalPx)*180.0/math.Pi
	elevationDeg := cameraTilt + math.Atan2(-(cy-fh/2.0), focalPx)*180.0/math.Pi

	azimuthDeg = math.Mod(azimuthDeg+360, 360)

	leftRad := math.Atan2(float64(bbox.X)-fw/2.0, focalPx)
	rightRad := math.Atan2(float64(bbox.X+bbox.Width)-fw/2.0, focalPx)
	topRad := math.Atan2(-(float64(bbox.Y) - fh/2.0), focalPx)
	bottomRad := math.Atan2(-(float64(bbox.Y+bbox.Height) - fh/2.0), focalPx)

	azExtentDeg := (rightRad - leftRad) * 180.0 / math.Pi
	elExtentDeg := (topRad - bottomRad) * 180.0 / math.Pi

	entity.Pose = &pb.PoseComponent{
		Parent: *det.DetectorEntityId,
		Offset: &pb.PoseComponent_Polar{
			Polar: &pb.PolarOffset{
				Azimuth:   azimuthDeg,
				Elevation: &elevationDeg,
			},
		},
	}

	// Pre-set bearing extent fields. PoseTransformer will compute the absolute
	// center bearing and preserve these values.
	entity.Bearing = &pb.BearingComponent{
		AzimuthExtentDeg:   &azExtentDeg,
		ElevationExtentDeg: &elExtentDeg,
	}

	return nil, nil
}
