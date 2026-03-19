//go:build darwin

package media

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// findFFmpeg locates the ffmpeg binary. On macOS it checks the .app bundle
// at Contents/MacOS/ffmpeg first, then falls back to PATH.
func findFFmpeg() (string, error) {
	if exe, err := os.Executable(); err == nil {
		bundled := filepath.Join(filepath.Dir(exe), "ffmpeg")
		if _, err := os.Stat(bundled); err == nil {
			return bundled, nil
		}
	}

	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("ffmpeg not found (not bundled in .app and not in PATH)")
	}
	return path, nil
}
