package rt

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sync"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/projectqai/hydris/builtin/artifacts"
)

// setupArtifactStore registers Hydris.artifacts.registerStore(name, callbacks)
// on the JS runtime. When a plugin calls this, the Go side wraps the JS
// callbacks into an artifacts.Store and registers it in the global registry.
// The store is automatically unregistered when the provided context is cancelled.
func setupArtifactStore(loop *eventloop.EventLoop, vm *goja.Runtime, ctx context.Context) {
	artObj := vm.NewObject()

	artObj.Set("registerStore", func(call goja.FunctionCall) goja.Value {
		name := call.Argument(0).String()
		callbacks := call.Argument(1).ToObject(vm)

		getFn, _ := goja.AssertFunction(callbacks.Get("get"))
		putFn, _ := goja.AssertFunction(callbacks.Get("put"))
		deleteFn, _ := goja.AssertFunction(callbacks.Get("delete"))
		existsFn, _ := goja.AssertFunction(callbacks.Get("exists"))

		if getFn == nil || putFn == nil || deleteFn == nil || existsFn == nil {
			panic(vm.NewTypeError("registerStore requires get, put, delete, exists callbacks"))
		}

		store := &jsStore{
			loop:     loop,
			vm:       vm,
			getFn:    getFn,
			putFn:    putFn,
			deleteFn: deleteFn,
			existsFn: existsFn,
		}

		artifacts.RegisterPluginStore(name, store)

		// Unregister when plugin shuts down.
		go func() {
			<-ctx.Done()
			artifacts.UnregisterPluginStore(name)
		}()

		return goja.Undefined()
	})

	// Get or create Hydris object (same pattern as device.go).
	hydris := vm.Get("Hydris")
	var hydrisObj *goja.Object
	if hydris == nil || goja.IsUndefined(hydris) {
		hydrisObj = vm.NewObject()
		vm.Set("Hydris", hydrisObj)
	} else {
		hydrisObj = hydris.ToObject(vm)
	}
	hydrisObj.Set("artifacts", artObj)
}

// jsStore bridges JS callbacks to the Go artifacts.Store interface.
type jsStore struct {
	loop     *eventloop.EventLoop
	vm       *goja.Runtime
	getFn    goja.Callable
	putFn    goja.Callable
	deleteFn goja.Callable
	existsFn goja.Callable
}

func (s *jsStore) Get(_ context.Context, id string) (io.ReadCloser, error) {
	type result struct {
		data []byte
		err  error
	}
	ch := make(chan result, 1)

	s.loop.RunOnLoop(func(vm *goja.Runtime) {
		val, err := s.getFn(nil, vm.ToValue(id))
		if err != nil {
			ch <- result{err: fmt.Errorf("js get: %w", err)}
			return
		}

		// The JS callback returns a Promise<Response>.
		promise := val.Export()
		if p, ok := promise.(*goja.Promise); ok {
			s.awaitPromise(p, func(resolved goja.Value) {
				// Response object — read via .arrayBuffer() or similar.
				respObj := resolved.ToObject(vm)
				// Try text() first for simplicity.
				textFn, _ := goja.AssertFunction(respObj.Get("text"))
				if textFn == nil {
					ch <- result{err: fmt.Errorf("response has no text() method")}
					return
				}
				textVal, err := textFn(respObj)
				if err != nil {
					ch <- result{err: fmt.Errorf("js get text: %w", err)}
					return
				}
				if tp, ok := textVal.Export().(*goja.Promise); ok {
					s.awaitPromise(tp, func(v goja.Value) {
						ch <- result{data: exportBytes(vm, v)}
					}, func(e goja.Value) {
						ch <- result{err: fmt.Errorf("js get text resolve: %v", e)}
					})
				} else {
					ch <- result{data: exportBytes(vm, textVal)}
				}
			}, func(e goja.Value) {
				ch <- result{err: fmt.Errorf("js get rejected: %v", e)}
			})
		} else {
			ch <- result{err: fmt.Errorf("js get: expected promise, got %T", promise)}
		}
	})

	r := <-ch
	if r.err != nil {
		return nil, r.err
	}
	return io.NopCloser(bytes.NewReader(r.data)), nil
}

func (s *jsStore) Put(_ context.Context, id string, r io.Reader) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}

	ch := make(chan error, 1)

	s.loop.RunOnLoop(func(vm *goja.Runtime) {
		ab := vm.NewArrayBuffer(data)
		uint8, _ := vm.New(vm.Get("Uint8Array"), vm.ToValue(ab))

		val, err := s.putFn(nil, vm.ToValue(id), uint8)
		if err != nil {
			ch <- fmt.Errorf("js put: %w", err)
			return
		}

		if p, ok := val.Export().(*goja.Promise); ok {
			s.awaitPromise(p, func(_ goja.Value) {
				ch <- nil
			}, func(e goja.Value) {
				ch <- fmt.Errorf("js put rejected: %v", e)
			})
		} else {
			ch <- nil
		}
	})

	return <-ch
}

func (s *jsStore) Delete(_ context.Context, id string) error {
	ch := make(chan error, 1)

	s.loop.RunOnLoop(func(vm *goja.Runtime) {
		val, err := s.deleteFn(nil, vm.ToValue(id))
		if err != nil {
			ch <- fmt.Errorf("js delete: %w", err)
			return
		}

		if p, ok := val.Export().(*goja.Promise); ok {
			s.awaitPromise(p, func(_ goja.Value) {
				ch <- nil
			}, func(e goja.Value) {
				ch <- fmt.Errorf("js delete rejected: %v", e)
			})
		} else {
			ch <- nil
		}
	})

	return <-ch
}

func (s *jsStore) Exists(_ context.Context, id string) (bool, error) {
	type result struct {
		exists bool
		err    error
	}
	ch := make(chan result, 1)

	s.loop.RunOnLoop(func(vm *goja.Runtime) {
		val, err := s.existsFn(nil, vm.ToValue(id))
		if err != nil {
			ch <- result{err: fmt.Errorf("js exists: %w", err)}
			return
		}

		if p, ok := val.Export().(*goja.Promise); ok {
			s.awaitPromise(p, func(v goja.Value) {
				ch <- result{exists: v.ToBoolean()}
			}, func(e goja.Value) {
				ch <- result{err: fmt.Errorf("js exists rejected: %v", e)}
			})
		} else {
			ch <- result{exists: val.ToBoolean()}
		}
	})

	r := <-ch
	return r.exists, r.err
}

// awaitPromise polls a goja Promise until it resolves or rejects.
// Must be called from within RunOnLoop.
func (s *jsStore) awaitPromise(p *goja.Promise, onResolve func(goja.Value), onReject func(goja.Value)) {
	var poll func()
	var mu sync.Mutex
	done := false

	poll = func() {
		mu.Lock()
		if done {
			mu.Unlock()
			return
		}
		mu.Unlock()

		switch p.State() {
		case goja.PromiseStateFulfilled:
			mu.Lock()
			done = true
			mu.Unlock()
			onResolve(p.Result())
		case goja.PromiseStateRejected:
			mu.Lock()
			done = true
			mu.Unlock()
			onReject(p.Result())
		default:
			// Still pending — schedule another check.
			s.loop.RunOnLoop(func(vm *goja.Runtime) {
				poll()
			})
		}
	}
	poll()
}
