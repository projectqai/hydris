//go:build !linux && !darwin && !windows

package webcam

import (
	"context"
	"fmt"
	"log/slog"
)

// validateCapture is a stub for unsupported platforms.
func validateCapture(_ *slog.Logger, _ webcamInfo) error {
	return fmt.Errorf("webcam capture not implemented on this platform")
}

// captureFrames is a stub for non-Linux platforms.
// macOS and Windows capture implementations will be added in dedicated files.
func captureFrames(ctx context.Context, logger *slog.Logger, info webcamInfo, onFrame func([]byte)) error {
	return fmt.Errorf("webcam capture not implemented on this platform")
}

// captureOneFrame is a stub for non-Linux platforms.
func captureOneFrame(info webcamInfo) ([]byte, error) {
	return nil, fmt.Errorf("webcam capture not implemented on this platform")
}
