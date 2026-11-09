// Command test runs the ros2 plugin against real hydris instances and a
// ROS 2 Jazzy container, end to end. Each scenario starts its own hydris
// instances on free ports and uses a DDS domain of its own, so it leaves a
// running hydris and the ROS nodes on other domains alone.
//
//	make -C plugins/ros2 test [RUN=regexp]
//
// It needs docker, the plugin binaries (make bin) and a hydris binary; the
// arm64 scenario needs qemu-aarch64 and is skipped without it.
package main

import (
	"flag"
	"fmt"
	"math/rand/v2"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"time"
)

const (
	testImage = "hydris-ros2-test:jazzy"
	testRef   = "ghcr.io/projectqai/hydris/plugins/ros2:test"
)

// Runner holds what all scenarios share.
type Runner struct {
	hydris  string // hydris binary
	plugin  string // plugin directory, with bin/ and test/
	tarball string // plugin image built from it
	root    string // temporary directory of the run
	domain  int    // DDS domain of the scenario running
}

// T is one scenario's state, like testing.T.
type T struct {
	r        *Runner
	name     string
	dir      string
	failed   bool
	skipped  bool
	cleanups []func()
}

type fatal struct{}

func (t *T) Logf(format string, args ...any) {
	fmt.Printf("    %s: %s\n", t.name, fmt.Sprintf(format, args...))
}

func (t *T) Errorf(format string, args ...any) {
	t.failed = true
	fmt.Printf("    %s: FAIL: %s\n", t.name, fmt.Sprintf(format, args...))
}

func (t *T) Fatalf(format string, args ...any) {
	t.Errorf(format, args...)
	panic(fatal{})
}

func (t *T) Skipf(format string, args ...any) {
	t.skipped = true
	t.Logf("skipped: "+format, args...)
	panic(fatal{})
}

func (t *T) Cleanup(f func()) { t.cleanups = append(t.cleanups, f) }

// waitFor polls cond until it holds, or fails the scenario after timeout
// with the last reason cond gave.
func (t *T) waitFor(what string, timeout time.Duration, cond func() (bool, string)) {
	deadline := time.Now().Add(timeout)
	for {
		ok, why := cond()
		if ok {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out after %v waiting for %s: %s", timeout, what, why)
		}
		time.Sleep(500 * time.Millisecond)
	}
}

type scenario struct {
	name string
	run  func(*T)
}

func main() {
	hydris := flag.String("hydris", "", "hydris binary")
	plugin := flag.String("plugin", "", "plugin directory, with the binaries in bin/")
	run := flag.String("run", "", "run only the scenarios matching this regexp")
	keep := flag.Bool("keep", false, "keep the run's directory, with every hydris log")
	flag.Parse()
	if *hydris == "" || *plugin == "" {
		fmt.Fprintln(os.Stderr, "usage: test -hydris BIN -plugin DIR [-run REGEXP] [-keep]")
		os.Exit(2)
	}
	filter := regexp.MustCompile(*run)

	r := &Runner{}
	var err error
	if r.hydris, err = filepath.Abs(*hydris); err != nil {
		panic(err)
	}
	if r.plugin, err = filepath.Abs(*plugin); err != nil {
		panic(err)
	}
	if r.root, err = os.MkdirTemp("", "hydris-ros2-test-"); err != nil {
		panic(err)
	}
	if err := r.setup(); err != nil {
		fmt.Fprintln(os.Stderr, "setup:", err)
		os.Exit(1)
	}

	var failed []string
	for _, s := range scenarios {
		if !filter.MatchString(s.name) {
			continue
		}
		t := &T{r: r, name: s.name, dir: filepath.Join(r.root, s.name)}
		if err := os.MkdirAll(t.dir, 0o755); err != nil {
			panic(err)
		}
		r.domain = 100 + rand.IntN(100)
		fmt.Printf("=== RUN   %s (domain %d)\n", s.name, r.domain)
		start := time.Now()
		func() {
			defer func() {
				if v := recover(); v != nil {
					if _, ok := v.(fatal); !ok {
						t.Errorf("panic: %v\n%s", v, debug.Stack())
					}
				}
				for i := len(t.cleanups) - 1; i >= 0; i-- {
					t.cleanups[i]()
				}
			}()
			s.run(t)
		}()
		status := "PASS"
		switch {
		case t.failed:
			status = "FAIL"
			failed = append(failed, s.name)
		case t.skipped:
			status = "SKIP"
		}
		fmt.Printf("--- %s  %s (%s)\n", status, s.name, time.Since(start).Round(time.Second))
	}

	r.teardown(*keep || len(failed) > 0)
	if len(failed) > 0 {
		fmt.Printf("FAIL: %s\n", strings.Join(failed, ", "))
		os.Exit(1)
	}
	fmt.Println("PASS")
}

// setup builds the ROS image and the plugin image tarball.
func (r *Runner) setup() error {
	here := filepath.Join(r.plugin, "test")
	if out, err := exec.Command("docker", "build", "-q", "-t", testImage, here).CombinedOutput(); err != nil {
		return fmt.Errorf("build %s: %v: %s", testImage, err, out)
	}
	cmd := exec.Command(r.hydris, "plugin", "build", r.plugin, "-t", testRef)
	cmd.Dir = r.root
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("plugin build: %v: %s", err, out)
	}
	tars, _ := filepath.Glob(filepath.Join(r.root, "*.tar"))
	if len(tars) != 1 {
		return fmt.Errorf("plugin build wrote %d tarballs to %s", len(tars), r.root)
	}
	r.tarball = tars[0]
	return nil
}

func (r *Runner) teardown(keep bool) {
	_ = exec.Command("docker", "rmi", testRef).Run()
	if keep {
		fmt.Printf("kept %s\n", r.root)
		return
	}
	_ = os.RemoveAll(r.root)
}
