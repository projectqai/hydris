//go:build windows

package webcam

import (
	"context"
	"fmt"
	"log/slog"
)

// validateCapture checks if ffmpeg is available.
func validateCapture(_ *slog.Logger, _ webcamInfo) error {
	_, err := findFFmpeg()
	return err
}

// captureFrames uses ffmpeg with DirectShow input to capture MJPEG frames.
// The device is identified by its friendly name from Media Foundation discovery.
func captureFrames(ctx context.Context, logger *slog.Logger, info webcamInfo, onFrame func([]byte)) error {
	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-f", "dshow",
		"-video_size", "640x480",
		"-framerate", "15",
		"-i", fmt.Sprintf("video=%s", info.Name),
		"-c:v", "mjpeg", "-q:v", "5",
		"-f", "mjpeg", "pipe:1",
	}

	return ffmpegCapture(ctx, logger, args, onFrame)
}

// captureOneFrame captures a single JPEG frame using ffmpeg.
func captureOneFrame(info webcamInfo) ([]byte, error) {
	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-f", "dshow",
		"-i", fmt.Sprintf("video=%s", info.Name),
		"-frames:v", "1",
		"-c:v", "mjpeg",
		"-f", "mjpeg", "pipe:1",
	}

	return ffmpegOneFrame(args)
}
