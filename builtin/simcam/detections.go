package simcam

import (
	"fmt"
	"math"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func detectionID(camID, entityID string) string {
	return fmt.Sprintf("%s~det~%s", camID, entityID)
}

func computeDetections(camID string, rc renderContext) []*pb.Entity {
	fov := effectiveFov(rc.poseSnapshot)
	halfFov := fov / 2
	cosLat := math.Cos(rc.camLat * math.Pi / 180)
	fovRad := fov * math.Pi / 180
	focalPx := float64(streamWidth) / 2 / math.Tan(fovRad/2)
	pxPerDeg := float64(streamWidth) / fov
	vFov := fov * float64(streamHeight) / float64(streamWidth)
	vPxPerDeg := float64(streamHeight) / vFov

	var changes []*pb.Entity

	for entityID, ent := range rc.entities {
		east := (ent.lon - rc.camLon) * 111320 * cosLat
		north := (ent.lat - rc.camLat) * 111320
		rangM := math.Sqrt(east*east + north*north)
		if rangM < 1 {
			continue
		}

		bearing := math.Atan2(east, north) * 180 / math.Pi
		relBearing := wrapSigned(bearing - rc.Pan)
		if math.Abs(relBearing) > halfFov {
			continue
		}

		relElev := math.Atan2(ent.alt-rc.camAlt, rangM)*180/math.Pi - rc.Tilt

		sx := float64(streamWidth)/2 + relBearing*pxPerDeg
		sy := float64(streamHeight)/2 - relElev*vPxPerDeg

		sizeM := float64(ent.widthM)
		if sizeM <= 0 {
			sizeM = float64(ent.heightM)
		}
		if sizeM <= 0 {
			sizeM = 2.0
		}
		bboxW := sizeM * focalPx / rangM
		bboxH := bboxW
		if ent.widthM > 0 && ent.heightM > 0 {
			bboxW = float64(ent.widthM) * focalPx / rangM
			bboxH = float64(ent.heightM) * focalPx / rangM
		}
		if bboxW < 12 {
			bboxW = 12
		}
		if bboxH < 12 {
			bboxH = 12
		}

		x0 := int(math.Round(sx - bboxW/2))
		y0 := int(math.Round(sy - bboxH/2))
		bw := int(math.Round(bboxW))
		bh := int(math.Round(bboxH))

		if x0+bw < 0 || x0 >= streamWidth || y0+bh < 0 || y0 >= streamHeight {
			continue
		}
		if x0 < 0 {
			bw += x0
			x0 = 0
		}
		if y0 < 0 {
			bh += y0
			y0 = 0
		}
		if x0+bw > streamWidth {
			bw = streamWidth - x0
		}
		if y0+bh > streamHeight {
			bh = streamHeight - y0
		}

		confidence := float32(1.0 - rangM/rc.RangeMax*0.5)
		if confidence < 0.3 {
			confidence = 0.3
		}

		var label *string
		if ent.label != "" {
			label = proto.String(ent.label)
		}

		priority := pb.Priority_PriorityImmediate
		changes = append(changes, &pb.Entity{
			Id:       detectionID(camID, entityID),
			Label:    label,
			Priority: &priority,
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				Evidence:         []string{entityID},
				ImageBbox: &pb.ImageBoundingBox{
					X:           uint32(x0),
					Y:           uint32(y0),
					Width:       uint32(bw),
					Height:      uint32(bh),
					FrameWidth:  streamWidth,
					FrameHeight: streamHeight,
				},
				Confidence: proto.Float32(confidence),
			},
		})
	}

	return changes
}
