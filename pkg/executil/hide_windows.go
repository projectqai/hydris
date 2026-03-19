//go:build windows

package executil

import (
	"os/exec"
	"syscall"
)

// HideWindow prevents the subprocess from creating a visible console window.
func HideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
