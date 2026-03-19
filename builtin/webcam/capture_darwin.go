//go:build darwin

package webcam

import (
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// validateCapture checks if the camera is accessible via AVFoundation.
// On macOS, cameras discovered via system_profiler may not be available
// to AVFoundation if the app hasn't been granted camera permission.
func validateCapture(logger *slog.Logger, info webcamInfo) error {
	if isScreenCapture(info) {
		return nil
	}
	_, err := resolveDeviceIndex(logger, info.Name)
	return err
}

func isScreenCapture(info webcamInfo) bool {
	return strings.Contains(strings.ToLower(info.Name), "capture screen")
}

// captureFrames uses ffmpeg with AVFoundation input to capture MJPEG frames.
func captureFrames(ctx context.Context, logger *slog.Logger, info webcamInfo, onFrame func([]byte)) error {
	args, err := buildCaptureArgs(logger, info)
	if err != nil {
		return err
	}
	args = append(args,
		"-c:v", "mjpeg", "-q:v", "5",
		"-f", "mjpeg", "pipe:1",
	)
	return ffmpegCapture(ctx, logger, args, onFrame)
}

// captureOneFrame captures a single JPEG frame.
func captureOneFrame(info webcamInfo) ([]byte, error) {
	args, err := buildCaptureArgs(slog.Default(), info)
	if err != nil {
		return nil, err
	}
	args = append(args,
		"-frames:v", "1",
		"-c:v", "mjpeg",
		"-f", "mjpeg", "pipe:1",
	)
	return ffmpegOneFrame(args)
}

// buildCaptureArgs resolves the AVFoundation device and builds ffmpeg input args.
func buildCaptureArgs(logger *slog.Logger, info webcamInfo) ([]string, error) {
	var deviceInput string

	if isScreenCapture(info) {
		// Screen captures already have the ffmpeg index as DevicePath.
		deviceInput = info.DevicePath + ":none"
	} else {
		// Cameras need index resolution from their name.
		idx, err := resolveDeviceIndex(logger, info.Name)
		if err != nil {
			return nil, err
		}
		deviceInput = idx + ":none"
	}

	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-f", "avfoundation",
	}

	if isScreenCapture(info) {
		// Screen capture: use a reasonable framerate, no pixel format constraint.
		args = append(args, "-framerate", "10", "-i", deviceInput)
	} else {
		// Camera: probe for supported modes.
		framerate, resolution := probeAVFoundation(logger, deviceInput)
		logger.Info("avfoundation probe result", "device", info.Name, "framerate", framerate, "resolution", resolution)
		args = append(args,
			"-framerate", framerate,
			"-video_size", resolution,
			"-pixel_format", "yuyv422",
			"-i", deviceInput,
		)
	}

	return args, nil
}

// resolveDeviceIndex maps a camera name to its ffmpeg AVFoundation device index
// by running ffmpeg -list_devices at capture time.
func resolveDeviceIndex(logger *slog.Logger, cameraName string) (string, error) {
	ffmpegPath, err := findFFmpeg()
	if err != nil {
		return "", err
	}

	out, _ := exec.Command(ffmpegPath,
		"-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", "",
	).CombinedOutput()

	var available []string
	inVideo := true
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "audio devices") {
			inVideo = false
		}
		if !inVideo {
			break
		}
		m := deviceRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		idx := m[1]
		name := strings.TrimSpace(m[2])
		available = append(available, fmt.Sprintf("[%s] %s", idx, name))
		if strings.Contains(name, cameraName) || strings.Contains(cameraName, name) {
			return idx, nil
		}
	}

	logger.Error("camera not found in ffmpeg device list", "wanted", cameraName, "available", available)
	return "", fmt.Errorf("camera %q not available to AVFoundation (check System Settings > Privacy & Security > Camera)", cameraName)
}

// modeRe matches AVFoundation mode lines from -list_options output, e.g.:
//
//	640x480@[30.000000 30.000000]fps
//	1280x720@[1.000000 30.000000]fps
var modeRe = regexp.MustCompile(`(\d+)x(\d+)@\[([0-9.]+)\s+([0-9.]+)\]fps`)

// probeAVFoundation queries the device for supported modes and returns
// a valid framerate and resolution. Prefers 640x480, falls back to first mode.
func probeAVFoundation(logger *slog.Logger, deviceInput string) (framerate, resolution string) {
	ffmpegPath, err := findFFmpeg()
	if err != nil {
		return "30", "640x480"
	}

	out, _ := exec.Command(ffmpegPath,
		"-hide_banner", "-f", "avfoundation",
		"-list_options", "true", "-i", deviceInput,
	).CombinedOutput()

	var bestW, bestH int
	var bestFPS string

	for _, line := range strings.Split(string(out), "\n") {
		m := modeRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		w, _ := strconv.Atoi(m[1])
		h, _ := strconv.Atoi(m[2])
		maxFPS := m[4]

		if w == 640 && h == 480 {
			return maxFPS, "640x480"
		}

		if bestFPS == "" {
			bestW, bestH, bestFPS = w, h, maxFPS
		}
	}

	if bestFPS != "" {
		return bestFPS, fmt.Sprintf("%dx%d", bestW, bestH)
	}

	return "30", "640x480"
}
