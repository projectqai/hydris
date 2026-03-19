//go:build !windows

// Package executil provides cross-platform helpers for os/exec.
package executil

import "os/exec"

// HideWindow is a no-op on non-Windows platforms.
func HideWindow(_ *exec.Cmd) {}
