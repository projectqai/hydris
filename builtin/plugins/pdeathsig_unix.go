//go:build unix && !linux && !android

package plugins

import "syscall"

// setPdeathsig: there is no parent-death signal here; the plugin exits on
// stdin EOF instead (proto/go/sdk).
func setPdeathsig(*syscall.SysProcAttr) {}
