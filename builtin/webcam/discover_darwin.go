//go:build darwin

package webcam

import (
	"context"
	"encoding/json"
	"log/slog"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// discoverAndWatch returns a channel that receives snapshots of currently
// present webcams and screen capture devices. Camera discovery uses
// system_profiler (no permissions needed), screen capture discovery uses
// ffmpeg's AVFoundation device list.
func discoverAndWatch(ctx context.Context, logger *slog.Logger) <-chan map[string]webcamInfo {
	ch := make(chan map[string]webcamInfo, 1)

	go func() {
		defer close(ch)

		ch <- scanWebcams(logger)

		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				ch <- scanWebcams(logger)
			}
		}
	}()

	return ch
}

// systemProfilerCamera represents a single camera entry from system_profiler.
type systemProfilerCamera struct {
	Name     string `json:"_name"`
	UniqueID string `json:"spcamera_unique-id"`
	ModelID  string `json:"spcamera_model-id"`
}

// systemProfilerOutput is the top-level JSON output from system_profiler SPCameraDataType.
type systemProfilerOutput struct {
	SPCameraDataType []systemProfilerCamera `json:"SPCameraDataType"`
}

// scanWebcams enumerates cameras via system_profiler (hardware-level, no
// permissions required) and screen capture devices via ffmpeg.
func scanWebcams(logger *slog.Logger) map[string]webcamInfo {
	cams := make(map[string]webcamInfo)

	// Hardware cameras via system_profiler.
	out, err := exec.Command("system_profiler", "SPCameraDataType", "-json").Output()
	if err != nil {
		logger.Error("system_profiler failed", "error", err)
	} else {
		var result systemProfilerOutput
		if err := json.Unmarshal(out, &result); err != nil {
			logger.Error("failed to parse system_profiler output", "error", err)
		} else {
			for _, cam := range result.SPCameraDataType {
				id := cam.UniqueID
				if id == "" {
					id = cam.Name
				}
				cams[id] = webcamInfo{
					Name:       cam.Name,
					DevicePath: cam.Name, // Resolved to ffmpeg index at capture time.
				}
			}
		}
	}

	// Screen capture devices via ffmpeg.
	addScreenCaptures(logger, cams)

	return cams
}

// deviceRe matches ffmpeg AVFoundation device listing lines like:
//
//	[AVFoundation indev @ 0x...] [0] FaceTime HD Camera
//	[AVFoundation indev @ 0x...] [2] Capture screen 0
var deviceRe = regexp.MustCompile(`\[AVFoundation[^\]]*\]\s*\[(\d+)\]\s*(.+)`)

// addScreenCaptures lists ffmpeg AVFoundation devices and adds any screen
// capture devices to the map.
func addScreenCaptures(logger *slog.Logger, cams map[string]webcamInfo) {
	ffmpegPath, err := findFFmpeg()
	if err != nil {
		return
	}

	out, _ := exec.Command(ffmpegPath,
		"-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", "",
	).CombinedOutput()

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

		if !strings.Contains(strings.ToLower(name), "capture screen") {
			continue
		}

		cams["screen-"+idx] = webcamInfo{
			Name:       name,
			DevicePath: idx, // Already the ffmpeg index.
		}
	}
}
