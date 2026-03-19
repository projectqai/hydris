// Package rt provides a JavaScript runtime for hydris plugins using goja.
package rt

import (
	"context"
	"fmt"
	"os"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/dop251/goja_nodejs/require"
)

// Runtime wraps a goja event loop with the globals needed by hydris plugins.
type Runtime struct {
	loop    *eventloop.EventLoop
	dataDir string // sandbox root for file access (directory containing package.json)
}

// New creates a Runtime. dataDir is the plugin's source directory (containing
// package.json) used to sandbox file access. The event loop provides
// setTimeout/setInterval, console, and CommonJS require out of the box via
// goja_nodejs. Node.js-compatible http2, events, stream modules are registered
// so that connect-rpc bundles work without modification.
func New(dataDir string) *Runtime {
	registry := require.NewRegistry()

	loop := eventloop.NewEventLoop(
		eventloop.EnableConsole(true),
		eventloop.WithRegistry(registry),
	)

	return &Runtime{loop: loop, dataDir: dataDir}
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
	var scriptErr error

	// Start() keeps the loop alive indefinitely (background mode adds +1
	// to jobCount). RunOnLoop schedules the script on the running loop.
	r.loop.Start()

	errCh := make(chan error, 1)
	r.loop.RunOnLoop(func(vm *goja.Runtime) {
		setupGlobals(r.loop, vm)
		setupFetch(r.loop, vm)
		if r.dataDir != "" {
			setupFileAccess(r.loop, vm, r.dataDir)
		}

		// Catch unhandled promise rejections.
		vm.SetPromiseRejectionTracker(func(p *goja.Promise, op goja.PromiseRejectionOperation) {
			if op == goja.PromiseRejectionReject {
				if err := p.Result(); err != nil {
					fmt.Fprintf(os.Stderr, "unhandled promise rejection: %v\n", err)
				}
			}
		})

		// Wrap in async IIFE to support top-level await.
		wrapped := "(async()=>{" + src + "\n})().catch(function(e){console.error(e)})"
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
		if scriptErr != nil {
			return scriptErr
		}
		return ctx.Err()
	}
}

// Stop terminates the event loop.
func (r *Runtime) Stop() {
	r.loop.Terminate()
}
