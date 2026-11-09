//go:build linux && !android

package plugins

import "syscall"

// setPdeathsig kills the plugin when hydris dies.
func setPdeathsig(attr *syscall.SysProcAttr) { attr.Pdeathsig = syscall.SIGKILL }
