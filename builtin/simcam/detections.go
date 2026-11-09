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

// computeDetections emits a detection for every entity whose box lands in
// the frame. It uses the renderer's projection, so boxes match the picture,
// and the same wall occlusion rule.
func computeDetections(camID string, v *view, in *frameInput, m *mesh) []*pb.Entity {
	var out []*pb.Entity
	for i := range in.entities {
		e := &in.entities[i]
		pl, ok := v.place(e)
		if !ok || (in.occlude && m.occluded(pl.pos)) {
			continue
		}
		bw, bh := math.Max(pl.pw, minObjectPx), math.Max(pl.ph, minObjectPx)
		x0 := max(int(math.Round(pl.x-bw/2)), 0)
		y0 := max(int(math.Round(pl.y-bh/2)), 0)
		x1 := min(int(math.Round(pl.x+bw/2)), v.w)
		y1 := min(int(math.Round(pl.y+bh/2)), v.h)
		if x1 <= x0 || y1 <= y0 {
			continue
		}

		confidence := float32(1 - pl.rangeM/in.pose.RangeMax*0.5)
		if confidence < 0.3 {
			confidence = 0.3
		}
		var label *string
		if e.label != "" {
			label = proto.String(e.label)
		}
		priority := pb.Priority_PriorityImmediate
		out = append(out, &pb.Entity{
			Id:       detectionID(camID, e.id),
			Label:    label,
			Priority: &priority,
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				Evidence:         []string{e.id},
				ImageBbox: &pb.ImageBoundingBox{
					X:           uint32(x0),
					Y:           uint32(y0),
					Width:       uint32(x1 - x0),
					Height:      uint32(y1 - y0),
					FrameWidth:  uint32(v.w),
					FrameHeight: uint32(v.h),
				},
				Confidence: proto.Float32(confidence),
			},
		})
	}
	return out
}
