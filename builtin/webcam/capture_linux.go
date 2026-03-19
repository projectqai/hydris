//go:build linux

package webcam

import (
	"context"
	"log/slog"
)

// validateCapture checks if ffmpeg is available.
func validateCapture(_ *slog.Logger, _ webcamInfo) error {
	_, err := findFFmpeg()
	return err
}

// captureFrames uses ffmpeg with V4L2 input to capture MJPEG frames.
func captureFrames(ctx context.Context, logger *slog.Logger, info webcamInfo, onFrame func([]byte)) error {
	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-f", "v4l2",
	}

	// Prefer MJPEG input if supported (avoids decoding/re-encoding).
	for _, f := range info.Formats {
		if f.FourCC == "MJPG" {
			args = append(args, "-input_format", "mjpeg")
			break
		}
	}

	args = append(args,
		"-video_size", "640x480",
		"-framerate", "15",
		"-i", info.DevicePath,
		"-c:v", "mjpeg", "-q:v", "5",
		"-f", "mjpeg", "pipe:1",
	)

	return ffmpegCapture(ctx, logger, args, onFrame)
}

// captureOneFrame captures a single JPEG frame using ffmpeg.
func captureOneFrame(info webcamInfo) ([]byte, error) {
	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-f", "v4l2",
	}

	for _, f := range info.Formats {
		if f.FourCC == "MJPG" {
			args = append(args, "-input_format", "mjpeg")
			break
		}
	}

	args = append(args,
		"-i", info.DevicePath,
		"-frames:v", "1",
		"-c:v", "mjpeg",
		"-f", "mjpeg", "pipe:1",
	)

	return ffmpegOneFrame(args)
}
