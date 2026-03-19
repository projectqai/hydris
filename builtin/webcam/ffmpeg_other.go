//go:build !darwin

package webcam

import (
	"fmt"
	"os/exec"
)

// findFFmpeg locates the ffmpeg binary in PATH.
func findFFmpeg() (string, error) {
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("ffmpeg not found in PATH: %w", err)
	}
	return path, nil
}
