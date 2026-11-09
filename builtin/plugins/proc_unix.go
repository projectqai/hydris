//go:build unix && !android

package plugins

import (
	"os/exec"
	"syscall"
)

// procGroup runs a native plugin in a process group of its own, so stopping
// it also stops whatever it spawned.
type procGroup struct{ pid int }

func newProcGroup(cmd *exec.Cmd) *procGroup {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	setPdeathsig(cmd.SysProcAttr)
	return &procGroup{}
}

func (g *procGroup) started(cmd *exec.Cmd) error {
	g.pid = cmd.Process.Pid
	return nil
}

func (g *procGroup) terminate() { _ = syscall.Kill(-g.pid, syscall.SIGTERM) }
func (g *procGroup) kill()      { _ = syscall.Kill(-g.pid, syscall.SIGKILL) }

// close kills what is left of the group once the plugin itself has exited.
func (g *procGroup) close() {
	if g.pid > 0 {
		g.kill()
	}
}
