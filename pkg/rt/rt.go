// Package rt provides a JavaScript runtime for hydris plugins using goja.
package rt

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/console"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/dop251/goja_nodejs/require"
)

// Runtime wraps a goja event loop with the globals needed by hydris plugins.
type Runtime struct {
	loop      *eventloop.EventLoop
	dataDir   string    // sandbox root for file access (directory containing package.json)
	logWriter io.Writer // if set, console output goes here instead of slog
}

// Option configures a Runtime.
type Option func(*Runtime)

// WithLogWriter directs console.log/warn/error output to w.
func WithLogWriter(w io.Writer) Option {
	return func(r *Runtime) { r.logWriter = w }
}

// New creates a Runtime. dataDir is the plugin's source directory (containing
// package.json) used to sandbox file access. The event loop provides
// setTimeout/setInterval, console, and CommonJS require out of the box via
// goja_nodejs. Node.js-compatible http2, events, stream modules are registered
// so that connect-rpc bundles work without modification.
func New(dataDir string, opts ...Option) *Runtime {
	r := &Runtime{dataDir: dataDir}
	for _, o := range opts {
		o(r)
	}

	var printer console.Printer
	if r.logWriter != nil {
		printer = &writerPrinter{w: r.logWriter}
	} else {
		printer = &slogPrinter{}
	}

	registry := require.NewRegistry()
	registry.RegisterNativeModule(console.ModuleName, console.RequireWithPrinter(printer))

	r.loop = eventloop.NewEventLoop(
		eventloop.EnableConsole(true),
		eventloop.WithRegistry(registry),
	)

	return r
}

// RunFile reads path and executes it. Blocks until ctx is cancelled.
func (r *Runtime) RunFile(ctx context.Context, path string) error {
	src, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	return r.RunScript(ctx, path, string(src))
}

// RunScript executes src inside the event loop. Uses Start() so the loop
// stays alive for async operations (fetch, promises). Blocks until ctx
// is cancelled.
func (r *Runtime) RunScript(ctx context.Context, name, src string) error {
	// Start() keeps the loop alive indefinitely (background mode adds +1
	// to jobCount). RunOnLoop schedules the script on the running loop.
	r.loop.Start()

	errCh := make(chan error, 1)
	r.loop.RunOnLoop(func(vm *goja.Runtime) {
		setupGlobals(r.loop, vm)
		setupFetch(r.loop, vm)
		setupArtifactStore(r.loop, vm, ctx)
		if r.dataDir != "" {
			setupFileAccess(r.loop, vm, r.dataDir)
		}

		// Crash on unhandled promise rejections so RunPlugin can restart us.
		vm.SetPromiseRejectionTracker(func(p *goja.Promise, op goja.PromiseRejectionOperation) {
			if op == goja.PromiseRejectionReject {
				result := p.Result()
				detail := formatRejection(vm, result)
				err := fmt.Errorf("unhandled promise rejection: %s", detail)
				fmt.Fprintln(os.Stderr, err)
				select {
				case errCh <- err:
				default:
				}
				r.loop.StopNoWait()
			}
		})

		// Wrap in async IIFE to support top-level await.
		// Do NOT add .catch() — unhandled rejections must reach the
		// tracker above so the runtime crashes and RunPlugin restarts.
		wrapped := "(async()=>{" + src + "\n})()"
		if _, err := vm.RunScript(name, wrapped); err != nil {
			errCh <- err
			r.loop.StopNoWait()
		}
	})

	select {
	case err := <-errCh:
		r.loop.Terminate()
		return err
	case <-ctx.Done():
		r.loop.Terminate()
		return ctx.Err()
	}
}

// Stop terminates the event loop.
func (r *Runtime) Stop() {
	r.loop.Terminate()
}

// formatRejection extracts a human-readable message from a rejected promise
// value. JS errors have a .message property; plain values are stringified.
// Returns a descriptive fallback when the rejection value is undefined/null.
func formatRejection(vm *goja.Runtime, val goja.Value) string {
	if val == nil || goja.IsUndefined(val) || goja.IsNull(val) {
		return "(no error details)"
	}
	obj := val.ToObject(vm)
	if obj != nil {
		if msg := obj.Get("message"); msg != nil && !goja.IsUndefined(msg) {
			s := msg.String()
			if s != "" {
				return s
			}
		}
	}
	if s := val.String(); s != "" {
		return s
	}
	return "(no error details)"
}

// slogPrinter routes JS console output through slog so it ends up in the
// engine log buffer on all platforms (including Android).
type slogPrinter struct{}

func (p *slogPrinter) Log(msg string)   { slog.Info(msg) }
func (p *slogPrinter) Warn(msg string)  { slog.Warn(msg) }
func (p *slogPrinter) Error(msg string) { slog.Error(msg) }

// writerPrinter sends console output to an io.Writer (for log forwarding).
type writerPrinter struct{ w io.Writer }

func (p *writerPrinter) Log(msg string)   { fmt.Fprintln(p.w, msg) }
func (p *writerPrinter) Warn(msg string)  { fmt.Fprintln(p.w, "WARN: "+msg) }
func (p *writerPrinter) Error(msg string) { fmt.Fprintln(p.w, "ERROR: "+msg) }
