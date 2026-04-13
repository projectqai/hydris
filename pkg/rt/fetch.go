package rt

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
)

// setupFetch registers global fetch(url, opts?), Headers, and Request classes,
// backed by Go's net/http.
func setupFetch(loop *eventloop.EventLoop, vm *goja.Runtime) {
	setupHeaders(vm)
	setupURL(vm)
	setupRequest(vm)

	vm.Set("fetch", func(call goja.FunctionCall) goja.Value {
		// Support both fetch(url, opts) and fetch(Request).
		arg0 := call.Argument(0)
		urlStr := ""
		if obj := arg0.ToObject(vm); obj != nil && obj.Get("_isRequest") != nil && obj.Get("_isRequest").ToBoolean() {
			urlStr = obj.Get("url").String()
			// Merge Request fields into a synthetic opts argument.
			if len(call.Arguments) < 2 || goja.IsUndefined(call.Argument(1)) {
				call.Arguments = append(call.Arguments[:0], arg0, arg0)
			}
		} else {
			urlStr = arg0.String()
		}

		method := "GET"
		var reqBody []byte
		goHeaders := http.Header{}
		reqCtx := context.Background()

		if len(call.Arguments) > 1 && !goja.IsUndefined(call.Argument(1)) {
			opts := call.Argument(1).ToObject(vm)
			if v := opts.Get("method"); v != nil && !goja.IsUndefined(v) {
				method = v.String()
			}
			if v := opts.Get("body"); v != nil && !goja.IsUndefined(v) && !goja.IsNull(v) {
				if obj := v.ToObject(vm); obj != nil {
					if flag := obj.Get("_isFormData"); flag != nil && flag.ToBoolean() {
						fd := obj.Get("_data").Export().(*formDataInternal)
						body, ct := fd.encode()
						reqBody = body
						goHeaders.Set("Content-Type", ct)
					} else if flag := obj.Get("_isURLSearchParams"); flag != nil && flag.ToBoolean() {
						usp := obj.Get("_data").Export().(*urlSearchParamsData)
						reqBody = []byte(usp.encode())
						if goHeaders.Get("Content-Type") == "" {
							goHeaders.Set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
						}
					} else {
						reqBody = exportBytes(vm, v)
					}
				} else {
					reqBody = exportBytes(vm, v)
				}
			}
			if v := opts.Get("headers"); v != nil && !goja.IsUndefined(v) {
				obj := v.ToObject(vm)
				// Support both plain objects and Headers instances.
				if forEach, ok := goja.AssertFunction(obj.Get("forEach")); ok {
					_, _ = forEach(v, vm.ToValue(func(val, key goja.Value) {
						goHeaders.Set(key.String(), val.String())
					}))
				} else {
					for _, k := range obj.Keys() {
						goHeaders.Set(k, obj.Get(k).String())
					}
				}
			}
			if v := opts.Get("signal"); v != nil && !goja.IsUndefined(v) {
				sigObj := v.ToObject(vm)
				if ctxVal := sigObj.Get("_ctx"); ctxVal != nil {
					if ctx, ok := ctxVal.Export().(context.Context); ok {
						reqCtx = ctx
					}
				}
			}
		}

		promise, resolve, reject := vm.NewPromise()

		go func() {
			var bodyReader io.Reader
			if len(reqBody) > 0 {
				bodyReader = strings.NewReader(string(reqBody))
			}
			req, err := http.NewRequestWithContext(reqCtx, method, urlStr, bodyReader)
			if err != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) { _ = reject(vm.NewGoError(err)) })
				return
			}
			req.Header = goHeaders

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) { _ = reject(vm.NewGoError(err)) })
				return
			}

			// Resolve immediately with a streaming response.
			loop.RunOnLoop(func(vm *goja.Runtime) {
				_ = resolve(makeStreamingResponse(loop, vm, resp))
			})
		}()

		return vm.ToValue(promise)
	})
}

// makeStreamingResponse creates a Response object that streams the body
// lazily. The body is NOT read eagerly — getReader().read() pulls chunks
// from the Go http.Response.Body on demand via goroutines.
func makeStreamingResponse(loop *eventloop.EventLoop, vm *goja.Runtime, resp *http.Response) *goja.Object {
	obj := vm.NewObject()
	obj.Set("ok", resp.StatusCode >= 200 && resp.StatusCode < 300)
	obj.Set("status", resp.StatusCode)
	obj.Set("statusText", resp.Status)
	obj.Set("headers", makeHeadersFromGo(vm, resp.Header))

	// Shared body state: we may need the full body for text()/json(),
	// or stream it via getReader(). Only one path should be used.
	var (
		mu       sync.Mutex
		bodyDone bool
		bodyData []byte
		bodyErr  error
	)

	// readAll collects the full body (used by text/json). Safe to call
	// multiple times — only reads once.
	readAll := func() ([]byte, error) {
		mu.Lock()
		defer mu.Unlock()
		if bodyDone {
			return bodyData, bodyErr
		}
		bodyData, bodyErr = io.ReadAll(resp.Body)
		resp.Body.Close()
		bodyDone = true
		return bodyData, bodyErr
	}

	// body: ReadableStream-like with getReader()
	bodyObj := vm.NewObject()
	bodyObj.Set("getReader", func() *goja.Object {
		reader := vm.NewObject()

		reader.Set("read", func() goja.Value {
			p, res, rej := vm.NewPromise()
			go func() {
				buf := make([]byte, 32*1024)
				n, err := resp.Body.Read(buf)
				loop.RunOnLoop(func(vm *goja.Runtime) {
					if n > 0 {
						result := vm.NewObject()
						result.Set("done", false)
						ab := vm.NewArrayBuffer(buf[:n])
						uint8, _ := vm.New(vm.Get("Uint8Array"), vm.ToValue(ab))
						result.Set("value", uint8)
						_ = res(result)
					} else if err != nil {
						if err == io.EOF {
							done := vm.NewObject()
							done.Set("done", true)
							done.Set("value", goja.Undefined())
							_ = res(done)
						} else {
							_ = rej(vm.NewGoError(err))
						}
					}
				})
			}()
			return vm.ToValue(p)
		})

		reader.Set("releaseLock", func() {})
		reader.Set("cancel", func() {
			resp.Body.Close()
		})
		return reader
	})
	// pipeThrough connects this body to a TransformStream-like (e.g.
	// DecompressionStream). Returns the transform's readable side.
	bodyObj.Set("pipeThrough", func(call goja.FunctionCall) goja.Value {
		transform := call.Argument(0).ToObject(vm)
		pipeTo, _ := goja.AssertFunction(transform.Get("_pipeTo"))
		if pipeTo != nil {
			_, _ = pipeTo(nil, vm.ToValue(resp.Body))
		}
		return transform.Get("readable")
	})

	obj.Set("body", bodyObj)

	obj.Set("text", func() goja.Value {
		p, res, rej := vm.NewPromise()
		go func() {
			data, err := readAll()
			loop.RunOnLoop(func(vm *goja.Runtime) {
				if err != nil {
					_ = rej(vm.NewGoError(err))
				} else {
					_ = res(string(data))
				}
			})
		}()
		return vm.ToValue(p)
	})

	obj.Set("json", func() goja.Value {
		p, res, rej := vm.NewPromise()
		go func() {
			data, err := readAll()
			loop.RunOnLoop(func(vm *goja.Runtime) {
				if err != nil {
					_ = rej(vm.NewGoError(err))
					return
				}
				var v interface{}
				if err := json.Unmarshal(data, &v); err != nil {
					_ = rej(vm.NewGoError(err))
				} else {
					_ = res(vm.ToValue(v))
				}
			})
		}()
		return vm.ToValue(p)
	})

	return obj
}

// exportBytes extracts a byte slice from a JS value (ArrayBuffer, TypedArray, or string).
func exportBytes(vm *goja.Runtime, val goja.Value) []byte {
	if val == nil || goja.IsUndefined(val) || goja.IsNull(val) {
		return nil
	}
	if ab, ok := val.Export().(goja.ArrayBuffer); ok {
		return ab.Bytes()
	}
	obj := val.ToObject(vm)
	if bufVal := obj.Get("buffer"); bufVal != nil && !goja.IsUndefined(bufVal) {
		if ab, ok := bufVal.Export().(goja.ArrayBuffer); ok {
			raw := ab.Bytes()
			off, length := 0, len(raw)
			if o := obj.Get("byteOffset"); o != nil && !goja.IsUndefined(o) {
				off = int(o.ToInteger())
			}
			if l := obj.Get("byteLength"); l != nil && !goja.IsUndefined(l) {
				length = int(l.ToInteger())
			}
			if off+length <= len(raw) {
				return raw[off : off+length]
			}
			return raw
		}
	}
	return []byte(val.String())
}

// --- URL class ---

// setupURL provides a minimal URL constructor for libraries that parse URLs.
// new URL(url) → { href, protocol, hostname, port, pathname, search, hash, toString() }
func setupURL(vm *goja.Runtime) {
	vm.Set("URL", func(call goja.ConstructorCall) *goja.Object {
		rawURL := call.Argument(0).String()
		if len(call.Arguments) > 1 && !goja.IsUndefined(call.Argument(1)) {
			base := call.Argument(1).String()
			if parsed, err := url.Parse(base); err == nil {
				if ref, err := url.Parse(rawURL); err == nil {
					rawURL = parsed.ResolveReference(ref).String()
				}
			}
		}
		parsed, _ := url.Parse(rawURL)
		if parsed == nil {
			parsed = &url.URL{}
		}

		call.This.Set("href", parsed.String())
		call.This.Set("protocol", parsed.Scheme+":")
		call.This.Set("hostname", parsed.Hostname())
		call.This.Set("port", parsed.Port())
		call.This.Set("pathname", parsed.Path)
		call.This.Set("search", "")
		if parsed.RawQuery != "" {
			call.This.Set("search", "?"+parsed.RawQuery)
		}
		call.This.Set("hash", "")
		if parsed.Fragment != "" {
			call.This.Set("hash", "#"+parsed.Fragment)
		}
		call.This.Set("host", parsed.Host)
		call.This.Set("origin", parsed.Scheme+"://"+parsed.Host)

		// Build a URLSearchParams from the query string.
		uspCtor := vm.Get("URLSearchParams")
		if uspCtor != nil {
			qs := parsed.RawQuery
			usp, _ := vm.New(uspCtor, vm.ToValue(qs))
			call.This.Set("searchParams", usp)
		} else {
			call.This.Set("searchParams", vm.NewObject())
		}

		call.This.Set("toString", func() string { return parsed.String() })
		return nil
	})
}

// --- Request class ---

// setupRequest provides a minimal Request constructor for libraries like aws4fetch.
// new Request(url, init?) → { url, method, headers, body, _isRequest: true }
func setupRequest(vm *goja.Runtime) {
	vm.Set("Request", func(call goja.ConstructorCall) *goja.Object {
		url := call.Argument(0).String()
		call.This.Set("_isRequest", true)
		call.This.Set("url", url)
		call.This.Set("method", "GET")
		call.This.Set("body", goja.Null())
		call.This.Set("duplex", "half")

		// Create empty Headers by default.
		headersCtor := vm.Get("Headers")
		if headersCtor != nil {
			hdrs, _ := vm.New(headersCtor)
			call.This.Set("headers", hdrs)
		}

		if len(call.Arguments) > 1 && !goja.IsUndefined(call.Argument(1)) {
			opts := call.Argument(1).ToObject(vm)
			if v := opts.Get("method"); v != nil && !goja.IsUndefined(v) {
				call.This.Set("method", v.String())
			}
			if v := opts.Get("body"); v != nil && !goja.IsUndefined(v) {
				call.This.Set("body", v)
			}
			if v := opts.Get("headers"); v != nil && !goja.IsUndefined(v) {
				call.This.Set("headers", v)
			}
			if v := opts.Get("duplex"); v != nil && !goja.IsUndefined(v) {
				call.This.Set("duplex", v.String())
			}
		}
		return nil
	})
}

// --- Headers class ---

func setupHeaders(vm *goja.Runtime) {
	vm.Set("Headers", func(call goja.ConstructorCall) *goja.Object {
		store := make(map[string]string)
		obj := call.This

		obj.Set("get", func(name string) interface{} {
			v, ok := store[strings.ToLower(name)]
			if !ok {
				return nil
			}
			return v
		})
		obj.Set("set", func(name, value string) {
			store[strings.ToLower(name)] = value
		})
		obj.Set("has", func(name string) bool {
			_, ok := store[strings.ToLower(name)]
			return ok
		})
		obj.Set("delete", func(name string) {
			delete(store, strings.ToLower(name))
		})
		obj.Set("forEach", func(call goja.FunctionCall) goja.Value {
			cb, ok := goja.AssertFunction(call.Argument(0))
			if ok {
				for k, v := range store {
					_, _ = cb(nil, vm.ToValue(v), vm.ToValue(k))
				}
			}
			return goja.Undefined()
		})
		obj.Set("keys", func() goja.Value {
			keys := make([]interface{}, 0, len(store))
			for k := range store {
				keys = append(keys, k)
			}
			return vm.ToValue(keys)
		})
		obj.Set("values", func() goja.Value {
			vals := make([]interface{}, 0, len(store))
			for _, v := range store {
				vals = append(vals, v)
			}
			return vm.ToValue(vals)
		})
		obj.Set("entries", func() goja.Value {
			pairs := make([]interface{}, 0, len(store))
			for k, v := range store {
				pairs = append(pairs, []interface{}{k, v})
			}
			return vm.ToValue(pairs)
		})

		// Init from argument (object or existing Headers).
		if len(call.Arguments) > 0 && !goja.IsUndefined(call.Argument(0)) {
			init := call.Argument(0).ToObject(vm)
			if forEach, ok := goja.AssertFunction(init.Get("forEach")); ok {
				_, _ = forEach(call.Argument(0), vm.ToValue(func(val, key goja.Value) {
					store[strings.ToLower(key.String())] = val.String()
				}))
			} else {
				for _, k := range init.Keys() {
					store[strings.ToLower(k)] = init.Get(k).String()
				}
			}
		}

		return nil
	})
}

func makeHeadersFromGo(vm *goja.Runtime, hdr http.Header) goja.Value {
	ctor := vm.Get("Headers")
	fn, _ := goja.AssertFunction(ctor)
	init := vm.NewObject()
	for k, v := range hdr {
		if len(v) > 0 {
			init.Set(strings.ToLower(k), v[0])
		}
	}
	result, _ := vm.New(ctor, init)
	_ = fn
	return result
}
