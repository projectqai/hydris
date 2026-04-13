//go:build linux

package webcam

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"
)

func TestScanWebcams(t *testing.T) {
	// Skip if no video devices available.
	if _, err := os.ReadDir("/sys/class/video4linux"); err != nil {
		t.Skip("no /sys/class/video4linux")
	}

	logger := slog.Default()
	cams := scanWebcams(logger)

	t.Logf("found %d webcams:", len(cams))
	for id, info := range cams {
		t.Logf("  id=%s name=%q device=%s formats=%v", id, info.Name, info.DevicePath, info.Formats)
		if info.USB != nil {
			t.Logf("    USB: vid=%04x pid=%04x mfg=%q prod=%q serial=%q",
				info.USB.GetVendorId(), info.USB.GetProductId(), info.USB.GetManufacturerName(), info.USB.GetProductName(), info.USB.GetSerialNumber())
		}
	}

	if len(cams) == 0 {
		t.Skip("no webcams found")
	}
}

func TestCaptureOneFrame(t *testing.T) {
	if _, err := os.ReadDir("/sys/class/video4linux"); err != nil {
		t.Skip("no /sys/class/video4linux")
	}

	logger := slog.Default()
	cams := scanWebcams(logger)
	if len(cams) == 0 {
		t.Skip("no webcams found")
	}

	// Pick the first camera.
	var info webcamInfo
	for _, v := range cams {
		info = v
		break
	}

	t.Logf("capturing from %s (%s)", info.Name, info.DevicePath)

	frame, err := captureOneFrame(info)
	if err != nil {
		t.Fatalf("captureOneFrame: %v", err)
	}
	t.Logf("captured frame: %d bytes", len(frame))

	// Verify it's valid JPEG.
	if len(frame) < 2 || frame[0] != 0xFF || frame[1] != 0xD8 {
		t.Error("frame does not look like JPEG")
	}
}

func TestCaptureFrames(t *testing.T) {
	if _, err := os.ReadDir("/sys/class/video4linux"); err != nil {
		t.Skip("no /sys/class/video4linux")
	}

	logger := slog.Default()
	cams := scanWebcams(logger)
	if len(cams) == 0 {
		t.Skip("no webcams found")
	}

	var info webcamInfo
	for _, v := range cams {
		info = v
		break
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var frameCount int
	err := captureFrames(ctx, logger, info, func(frame []byte) {
		frameCount++
		if frameCount >= 10 {
			cancel()
		}
	})
	if err != nil && ctx.Err() == nil {
		t.Fatalf("captureFrames: %v", err)
	}
	t.Logf("captured %d frames", frameCount)
	if frameCount == 0 {
		t.Error("no frames captured")
	}
}
