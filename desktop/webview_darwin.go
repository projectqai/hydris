package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

type Webview struct {
	debug bool
	url   string
	cmd   *exec.Cmd
	pipe  *os.File // write end of keepalive pipe; close to signal shim to exit
}

func NewWebview(title string, width, height int, debug bool) *Webview {
	return &Webview{debug: debug}
}

func (w *Webview) Navigate(url string) {
	w.url = url
}

func (w *Webview) Run() {
	shim := findShim()
	if shim == "" {
		fmt.Fprintln(os.Stderr, "hydris-webview helper not found (expected next to binary or in PATH)")
		os.Exit(1)
	}

	args := []string{}
	if w.debug {
		args = append(args, "--debug")
	}
	args = append(args, w.url)

	// Keepalive pipe: the shim monitors fd 3 (the read end). When this
	// process exits for any reason (clean return, signal, crash, SIGKILL),
	// the write end closes and the shim gets EOF → exits.
	pr, pw, err := os.Pipe()
	if err != nil {
		fmt.Fprintln(os.Stderr, "webview: pipe:", err)
		os.Exit(1)
	}
	w.pipe = pw

	w.cmd = exec.Command(shim, args...)
	w.cmd.Stdout = os.Stdout
	w.cmd.Stderr = os.Stderr
	w.cmd.ExtraFiles = []*os.File{pr} // child inherits as fd 3
	if err := w.cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "webview:", err)
		return
	}
	pr.Close() // parent doesn't need the read end

	w.cmd.Wait()
}

// Shutdown causes Run() to return by killing the subprocess.
// Safe to call from any goroutine.
func (w *Webview) Shutdown() {
	if w.cmd != nil && w.cmd.Process != nil {
		w.cmd.Process.Kill()
	}
}

// Destroy cleans up resources. Idempotent.
func (w *Webview) Destroy() {
	if w.pipe != nil {
		w.pipe.Close()
		w.pipe = nil
	}
	w.Shutdown()
}

func findShim() string {
	exe, err := os.Executable()
	if err == nil {
		shim := filepath.Join(filepath.Dir(exe), "hydris-webview")
		if _, err := os.Stat(shim); err == nil {
			return shim
		}
	}
	if p, err := exec.LookPath("hydris-webview"); err == nil {
		return p
	}
	return ""
}
