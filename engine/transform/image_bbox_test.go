package transform

import (
	"math"
	"testing"

	pb "github.com/projectqai/proto/go"
)

//nolint:unused
func fovPtr(v float64) *float64 { return &v }

func TestImageBbox_CenterDetection(t *testing.T) {
	tr := NewImageBboxTransformer()
	fov := 60.0
	camID := "cam-1"
	head := map[string]*pb.Entity{
		"cam-1": {
			Id:     "cam-1",
			Camera: &pb.CameraComponent{Fov: &fov},
		},
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 910, Y: 490, Width: 100, Height: 100,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-1", nil)

	ev := head["ev-1"]
	if ev.Pose == nil {
		t.Fatal("expected PoseComponent to be set")
	}
	polar, ok := ev.Pose.Offset.(*pb.PoseComponent_Polar)
	if !ok || polar.Polar == nil {
		t.Fatal("expected polar offset")
	}
	if ev.Pose.Parent != "cam-1" {
		t.Errorf("expected parent=cam-1, got %s", ev.Pose.Parent)
	}

	// Center of frame → azimuth and elevation near 0
	if math.Abs(polar.Polar.Azimuth) > 1.0 && math.Abs(polar.Polar.Azimuth-360) > 1.0 {
		t.Errorf("expected azimuth near 0°, got %.2f°", polar.Polar.Azimuth)
	}
	if polar.Polar.Elevation == nil || math.Abs(*polar.Polar.Elevation) > 1.0 {
		t.Errorf("expected elevation near 0°, got %v", polar.Polar.Elevation)
	}
}

func TestImageBbox_OffCenterDetection(t *testing.T) {
	tr := NewImageBboxTransformer()
	fov := 60.0
	camID := "cam-1"
	head := map[string]*pb.Entity{
		"cam-1": {
			Id:     "cam-1",
			Camera: &pb.CameraComponent{Fov: &fov},
		},
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 0, Y: 0, Width: 100, Height: 200,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-1", nil)

	ev := head["ev-1"]
	polar := ev.Pose.Offset.(*pb.PoseComponent_Polar).Polar

	// Top-left of frame: azimuth should be negative (wrapped to ~330+), elevation positive
	az := polar.Azimuth
	if az < 180 {
		t.Errorf("expected azimuth in upper half (left of center), got %.2f°", az)
	}
	if polar.Elevation == nil || *polar.Elevation <= 0 {
		t.Errorf("expected positive elevation (above center), got %v", polar.Elevation)
	}
}

func TestImageBbox_AngularExtents(t *testing.T) {
	tr := NewImageBboxTransformer()
	fov := 60.0
	camID := "cam-1"
	head := map[string]*pb.Entity{
		"cam-1": {
			Id:     "cam-1",
			Camera: &pb.CameraComponent{Fov: &fov},
		},
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 420, Y: 180, Width: 80, Height: 200,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-1", nil)

	ev := head["ev-1"]
	if ev.Bearing == nil {
		t.Fatal("expected BearingComponent with extent fields")
	}
	if ev.Bearing.AzimuthExtentDeg == nil || ev.Bearing.ElevationExtentDeg == nil {
		t.Fatal("expected both extent fields to be set")
	}

	// 80px / 1920px * 60° ≈ 2.5° (linear approx, pinhole is close for small angles)
	azExt := *ev.Bearing.AzimuthExtentDeg
	if azExt < 2.0 || azExt > 3.0 {
		t.Errorf("expected azimuth extent ~2.5°, got %.3f°", azExt)
	}

	// 200px / 1080px * vfov. vfov ≈ 2*atan(tan(30°)*(1080/1920)) ≈ 35.3°
	// so ~200/1080*35.3 ≈ 6.5° (linear approx)
	elExt := *ev.Bearing.ElevationExtentDeg
	if elExt < 5.0 || elExt > 8.0 {
		t.Errorf("expected elevation extent ~6.5°, got %.3f°", elExt)
	}
}

func TestImageBbox_FullFrameMatchesFOV(t *testing.T) {
	tr := NewImageBboxTransformer()
	fov := 60.0
	camID := "cam-1"
	head := map[string]*pb.Entity{
		"cam-1": {
			Id:     "cam-1",
			Camera: &pb.CameraComponent{Fov: &fov},
		},
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 0, Y: 0, Width: 1920, Height: 1080,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-1", nil)

	ev := head["ev-1"]
	azExt := *ev.Bearing.AzimuthExtentDeg

	// Full-width bbox should equal camera FOV
	if math.Abs(azExt-fov) > 0.01 {
		t.Errorf("full-width bbox extent should equal FOV (%.1f°), got %.3f°", fov, azExt)
	}
}

func TestImageBbox_NoCameraSkips(t *testing.T) {
	tr := NewImageBboxTransformer()
	camID := "missing-cam"
	head := map[string]*pb.Entity{
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 100, Y: 100, Width: 50, Height: 50,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-1", nil)

	if head["ev-1"].Pose != nil {
		t.Error("expected no PoseComponent when camera is missing")
	}
}

func TestImageBbox_NoFovSkips(t *testing.T) {
	tr := NewImageBboxTransformer()
	camID := "cam-1"
	head := map[string]*pb.Entity{
		"cam-1": {
			Id:     "cam-1",
			Camera: &pb.CameraComponent{},
		},
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 100, Y: 100, Width: 50, Height: 50,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-1", nil)

	if head["ev-1"].Pose != nil {
		t.Error("expected no PoseComponent when camera has no FOV")
	}
}

func TestImageBbox_PoseTransformerPreservesExtents(t *testing.T) {
	imgTr := NewImageBboxTransformer()
	poseTr := NewPoseTransformer()

	fov := 60.0
	camID := "cam-1"
	alt := 30.0
	head := map[string]*pb.Entity{
		"cam-1": {
			Id: "cam-1",
			Geo: &pb.GeoSpatialComponent{
				Latitude: 48.1, Longitude: 11.5, Altitude: &alt,
			},
			Camera: &pb.CameraComponent{Fov: &fov},
		},
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 420, Y: 180, Width: 80, Height: 200,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	// Step 1: ImageBboxTransformer sets PoseComponent + bearing extents
	imgTr.Resolve(head, "ev-1", nil)

	ev := head["ev-1"]
	if ev.Bearing == nil || ev.Bearing.AzimuthExtentDeg == nil {
		t.Fatal("ImageBboxTransformer should have set bearing extents")
	}
	azExt := *ev.Bearing.AzimuthExtentDeg
	elExt := *ev.Bearing.ElevationExtentDeg

	// Step 2: PoseTransformer resolves absolute bearing
	poseTr.Resolve(head, "ev-1", nil)

	// Bearing center should be set
	if ev.Bearing == nil || ev.Bearing.Azimuth == nil {
		t.Fatal("PoseTransformer should have set bearing azimuth")
	}

	// Extents must be preserved
	if ev.Bearing.AzimuthExtentDeg == nil {
		t.Fatal("PoseTransformer lost azimuth extent")
	}
	if ev.Bearing.ElevationExtentDeg == nil {
		t.Fatal("PoseTransformer lost elevation extent")
	}
	if *ev.Bearing.AzimuthExtentDeg != azExt {
		t.Errorf("azimuth extent changed: was %.3f, now %.3f", azExt, *ev.Bearing.AzimuthExtentDeg)
	}
	if *ev.Bearing.ElevationExtentDeg != elExt {
		t.Errorf("elevation extent changed: was %.3f, now %.3f", elExt, *ev.Bearing.ElevationExtentDeg)
	}
}

func TestImageBbox_SymmetricDetection(t *testing.T) {
	tr := NewImageBboxTransformer()
	fov := 90.0
	camID := "cam-1"

	// Two symmetric detections on either side of center
	head := map[string]*pb.Entity{
		"cam-1": {
			Id:     "cam-1",
			Camera: &pb.CameraComponent{Fov: &fov},
		},
		"ev-left": {
			Id: "ev-left",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 200, Y: 490, Width: 100, Height: 100,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
		"ev-right": {
			Id: "ev-right",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 1620, Y: 490, Width: 100, Height: 100,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-left", nil)
	tr.Resolve(head, "ev-right", nil)

	left := head["ev-left"].Pose.Offset.(*pb.PoseComponent_Polar).Polar
	right := head["ev-right"].Pose.Offset.(*pb.PoseComponent_Polar).Polar

	// Left detection wraps to ~340-350, right is ~10-20.
	// Their offsets from 0/360 should be equal in magnitude
	leftOff := 360 - left.Azimuth
	rightOff := right.Azimuth

	if math.Abs(leftOff-rightOff) > 0.5 {
		t.Errorf("symmetric detections should have equal angular offsets: left=%.2f° right=%.2f°", leftOff, rightOff)
	}

	// Angular extents should be identical (same box size, same FOV)
	leftExt := *head["ev-left"].Bearing.AzimuthExtentDeg
	rightExt := *head["ev-right"].Bearing.AzimuthExtentDeg
	if math.Abs(leftExt-rightExt) > 0.01 {
		t.Errorf("symmetric detections should have equal extents: left=%.3f° right=%.3f°", leftExt, rightExt)
	}
}

func TestImageBbox_NarrowFOV(t *testing.T) {
	tr := NewImageBboxTransformer()
	fov := 5.0 // telephoto lens
	camID := "cam-1"
	head := map[string]*pb.Entity{
		"cam-1": {
			Id:     "cam-1",
			Camera: &pb.CameraComponent{Fov: &fov},
		},
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 900, Y: 500, Width: 120, Height: 80,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-1", nil)

	// With 5° FOV, 120px/1920px → ~0.31° extent
	azExt := *head["ev-1"].Bearing.AzimuthExtentDeg
	if azExt < 0.2 || azExt > 0.5 {
		t.Errorf("expected small azimuth extent for narrow FOV, got %.3f°", azExt)
	}
}

func TestImageBbox_FocalPointPan(t *testing.T) {
	tr := NewImageBboxTransformer()
	fov := 60.0
	camID := "cam-1"
	fpID := "cam-1~fp"
	panDeg := 90.0
	tiltDeg := -10.0
	head := map[string]*pb.Entity{
		"cam-1": {
			Id: "cam-1",
			Camera: &pb.CameraComponent{
				Fov:        &fov,
				FocalPoint: &fpID,
			},
		},
		fpID: {
			Id: fpID,
			Pose: &pb.PoseComponent{
				Parent: "cam-1",
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth:   panDeg,
						Elevation: &tiltDeg,
					},
				},
			},
		},
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 910, Y: 490, Width: 100, Height: 100,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-1", nil)

	ev := head["ev-1"]
	if ev.Pose == nil {
		t.Fatal("expected PoseComponent")
	}
	polar := ev.Pose.Offset.(*pb.PoseComponent_Polar).Polar

	// Center-of-frame detection on a camera panned to 90° → azimuth ≈ 90°
	if math.Abs(polar.Azimuth-90) > 1.0 {
		t.Errorf("expected azimuth near 90°, got %.2f°", polar.Azimuth)
	}
	// Camera tilted -10°, bbox at center → elevation ≈ -10°
	if polar.Elevation == nil || math.Abs(*polar.Elevation-(-10)) > 1.0 {
		t.Errorf("expected elevation near -10°, got %v", polar.Elevation)
	}
}

func TestImageBbox_WideFOV(t *testing.T) {
	tr := NewImageBboxTransformer()
	fov := 120.0 // fisheye-ish
	camID := "cam-1"
	head := map[string]*pb.Entity{
		"cam-1": {
			Id:     "cam-1",
			Camera: &pb.CameraComponent{Fov: &fov},
		},
		"ev-1": {
			Id: "ev-1",
			Detection: &pb.DetectionComponent{
				DetectorEntityId: &camID,
				ImageBbox: &pb.ImageBoundingBox{
					X: 0, Y: 0, Width: 1920, Height: 1080,
					FrameWidth: 1920, FrameHeight: 1080,
				},
			},
		},
	}

	tr.Resolve(head, "ev-1", nil)

	azExt := *head["ev-1"].Bearing.AzimuthExtentDeg
	if math.Abs(azExt-120.0) > 0.01 {
		t.Errorf("full-frame extent should match FOV (120°), got %.3f°", azExt)
	}
}
