package rt

import (
	"compress/gzip"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	goHMAC "crypto/hmac"
	"crypto/rand"
	goSHA1 "crypto/sha1"
	goSHA256 "crypto/sha256"
	goSHA512 "crypto/sha512"
	"encoding/base64"
	"fmt"
	goHash "hash"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
)

var epoch = time.Now()

// setupGlobals registers process, performance, AbortController and AbortSignal
// on the goja VM. console and setTimeout/setInterval are provided by the
// goja_nodejs eventloop.
func setupGlobals(loop *eventloop.EventLoop, vm *goja.Runtime) {
	setupProcess(vm)
	setupPerformance(vm)
	setupAbort(vm)
	setupBase64(vm)
	setupEncoding(vm)
	setupSymbols(vm)
	setupURLSearchParams(vm)
	setupFormData(vm)
	setupWebSocket(loop, vm)
	setupDecompressionStream(loop, vm)
	setupCrypto(vm)
	setupHTMLRewriter(vm)
	setupNet(loop, vm)
	setupDevice(loop, vm)
}

func setupSymbols(vm *goja.Runtime) {
	// Polyfill Symbol.asyncIterator if not present.
	vm.RunScript("polyfill", `
		if (typeof Symbol.asyncIterator === 'undefined') {
			Symbol.asyncIterator = Symbol('Symbol.asyncIterator');
		}
	`)
}

// forgivingBase64 decodes like the HTML forgiving-base64 algorithm: ASCII
// whitespace is ignored and padding is optional.
func forgivingBase64(s string) ([]byte, error) {
	s = strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\n', '\f', '\r':
			return -1
		}
		return r
	}, s)
	s = strings.TrimRight(s, "=")
	if len(s)%4 == 1 {
		return nil, fmt.Errorf("length %d is not valid base64", len(s))
	}
	return base64.RawStdEncoding.DecodeString(s)
}

func setupBase64(vm *goja.Runtime) {
	// Binary strings hold byte values as Unicode code points, not UTF-8 bytes.
	vm.Set("btoa", func(s string) string {
		b := make([]byte, 0, len(s))
		for _, r := range s {
			if r > 0xFF {
				panic(vm.NewTypeError("btoa: character U+%04X is outside the Latin1 range", r))
			}
			b = append(b, byte(r))
		}
		return base64.StdEncoding.EncodeToString(b)
	})
	vm.Set("atob", func(s string) string {
		b, err := forgivingBase64(s)
		if err != nil {
			panic(vm.NewTypeError("atob: invalid base64: %v", err))
		}
		r := make([]rune, len(b))
		for i, c := range b {
			r[i] = rune(c)
		}
		return string(r)
	})
}

func setupEncoding(vm *goja.Runtime) {
	// TextEncoder
	vm.Set("TextEncoder", func(call goja.ConstructorCall) *goja.Object {
		call.This.Set("encode", func(s string) goja.Value {
			b := []byte(s)
			ab := vm.NewArrayBuffer(b)
			uint8, _ := vm.New(vm.Get("Uint8Array"), vm.ToValue(ab))
			return uint8
		})
		call.This.Set("encoding", "utf-8")
		return nil
	})

	// TextDecoder
	vm.Set("TextDecoder", func(call goja.ConstructorCall) *goja.Object {
		call.This.Set("decode", func(call goja.FunctionCall) goja.Value {
			b := exportBytes(vm, call.Argument(0))
			return vm.ToValue(string(b))
		})
		call.This.Set("encoding", "utf-8")
		return nil
	})
}

func setupProcess(vm *goja.Runtime) {
	envObj := vm.NewObject()
	for _, e := range os.Environ() {
		if k, v, ok := strings.Cut(e, "="); ok {
			envObj.Set(k, v)
		}
	}
	proc := vm.NewObject()
	proc.Set("env", envObj)
	vm.Set("process", proc)
}

func setupPerformance(vm *goja.Runtime) {
	perf := vm.NewObject()
	perf.Set("now", func() float64 {
		return float64(time.Since(epoch).Microseconds()) / 1000.0
	})
	vm.Set("performance", perf)
}

// setupAbort provides AbortController and AbortSignal.timeout(ms).
// Each signal carries an internal Go context used by fetch.
func setupAbort(vm *goja.Runtime) {
	// AbortSignal helper: creates a signal object backed by a Go context.
	makeSignal := func(ctx context.Context, cancel context.CancelFunc) *goja.Object {
		sig := vm.NewObject()
		sig.Set("aborted", false)
		sig.Set("reason", goja.Undefined())
		// internal context for fetch
		sig.Set("_ctx", ctx)
		sig.Set("_cancel", cancel)

		type listener struct {
			cb   goja.Callable
			once bool
		}
		var listeners []listener

		sig.Set("addEventListener", func(call goja.FunctionCall) goja.Value {
			event := call.Argument(0).String()
			cb, ok := goja.AssertFunction(call.Argument(1))
			if event != "abort" || !ok {
				return goja.Undefined()
			}
			once := false
			if len(call.Arguments) > 2 && !goja.IsUndefined(call.Argument(2)) {
				opts := call.Argument(2).ToObject(vm)
				if v := opts.Get("once"); v != nil {
					once = v.ToBoolean()
				}
			}
			listeners = append(listeners, listener{cb, once})
			return goja.Undefined()
		})

		// fire fires abort listeners. Called from within the event loop.
		fire := func() {
			sig.Set("aborted", true)
			remaining := listeners[:0]
			for _, l := range listeners {
				_, _ = l.cb(nil, sig)
				if !l.once {
					remaining = append(remaining, l)
				}
			}
			listeners = remaining
		}

		sig.Set("_fire", fire)
		return sig
	}

	// AbortController constructor
	vm.Set("AbortController", func(call goja.ConstructorCall) *goja.Object {
		ctx, cancel := context.WithCancel(context.Background())
		sig := makeSignal(ctx, cancel)

		call.This.Set("signal", sig)
		call.This.Set("abort", func(reason goja.Value) {
			cancel()
			if reason != nil && !goja.IsUndefined(reason) {
				sig.Set("reason", reason)
			}
			fire, _ := goja.AssertFunction(sig.Get("_fire"))
			if fire != nil {
				_, _ = fire(nil)
			}
		})
		return nil
	})

	// AbortSignal.timeout(ms)
	abortSignal := vm.NewObject()
	abortSignal.Set("timeout", func(ms int64) *goja.Object {
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(ms)*time.Millisecond)
		sig := makeSignal(ctx, cancel)
		return sig
	})
	vm.Set("AbortSignal", abortSignal)
}

// setupFileAccess provides Bun.file(path) for reading files relative to the
// plugin's package.json directory. Paths that escape the sandbox are rejected.
func setupFileAccess(loop *eventloop.EventLoop, vm *goja.Runtime, dataDir string) {
	absRoot, _ := filepath.Abs(dataDir)

	bun := vm.NewObject()
	bun.Set("file", func(call goja.FunctionCall) goja.Value {
		rel := call.Argument(0).String()
		abs := filepath.Join(absRoot, rel)
		abs, _ = filepath.Abs(abs)

		// Ensure the resolved path is within the sandbox.
		if !strings.HasPrefix(abs, absRoot+string(filepath.Separator)) && abs != absRoot {
			panic(vm.NewGoError(fmt.Errorf("file access denied: %s escapes plugin directory", rel)))
		}

		obj := vm.NewObject()
		obj.Set("stream", func() *goja.Object {
			f, err := os.Open(abs)
			if err != nil {
				panic(vm.NewGoError(err))
			}

			readable := vm.NewObject()
			readable.Set("getReader", func() *goja.Object {
				reader := vm.NewObject()
				reader.Set("read", func() goja.Value {
					p, res, rej := vm.NewPromise()
					go func() {
						buf := make([]byte, 32*1024)
						n, readErr := f.Read(buf)
						loop.RunOnLoop(func(vm *goja.Runtime) {
							if n > 0 {
								result := vm.NewObject()
								result.Set("done", false)
								ab := vm.NewArrayBuffer(buf[:n])
								uint8, _ := vm.New(vm.Get("Uint8Array"), vm.ToValue(ab))
								result.Set("value", uint8)
								_ = res(result)
							} else if readErr != nil {
								if readErr == io.EOF {
									f.Close()
									done := vm.NewObject()
									done.Set("done", true)
									done.Set("value", goja.Undefined())
									_ = res(done)
								} else {
									f.Close()
									_ = rej(vm.NewGoError(readErr))
								}
							}
						})
					}()
					return vm.ToValue(p)
				})
				reader.Set("releaseLock", func() {})
				reader.Set("cancel", func() { f.Close() })
				return reader
			})

			// pipeThrough support for DecompressionStream etc.
			readable.Set("pipeThrough", func(call goja.FunctionCall) goja.Value {
				transform := call.Argument(0).ToObject(vm)
				pipeTo, _ := goja.AssertFunction(transform.Get("_pipeTo"))
				if pipeTo != nil {
					_, _ = pipeTo(nil, vm.ToValue(f))
				}
				return transform.Get("readable")
			})

			return readable
		})

		return obj
	})
	vm.Set("Bun", bun)
}

// urlSearchParamsData is the internal Go struct backing a URLSearchParams instance.
type urlSearchParamsData struct {
	params []([2]string)
}

func (u *urlSearchParamsData) append(key, value string) {
	u.params = append(u.params, [2]string{key, value})
}

func (u *urlSearchParamsData) set(key, value string) {
	for i := range u.params {
		if u.params[i][0] == key {
			u.params[i][1] = value
			// Remove subsequent duplicates.
			j := i + 1
			for j < len(u.params) {
				if u.params[j][0] == key {
					u.params = append(u.params[:j], u.params[j+1:]...)
				} else {
					j++
				}
			}
			return
		}
	}
	u.params = append(u.params, [2]string{key, value})
}

func (u *urlSearchParamsData) get(key string) *string {
	for _, p := range u.params {
		if p[0] == key {
			return &p[1]
		}
	}
	return nil
}

func (u *urlSearchParamsData) has(key string) bool {
	return u.get(key) != nil
}

func (u *urlSearchParamsData) del(key string) {
	j := 0
	for _, p := range u.params {
		if p[0] != key {
			u.params[j] = p
			j++
		}
	}
	u.params = u.params[:j]
}

func (u *urlSearchParamsData) encode() string {
	var parts []string
	for _, p := range u.params {
		parts = append(parts, url.QueryEscape(p[0])+"="+url.QueryEscape(p[1]))
	}
	return strings.Join(parts, "&")
}

func setupURLSearchParams(vm *goja.Runtime) {
	vm.Set("URLSearchParams", func(call goja.ConstructorCall) *goja.Object {
		data := &urlSearchParamsData{}

		// Init from argument: string or plain object.
		if len(call.Arguments) > 0 && !goja.IsUndefined(call.Argument(0)) && !goja.IsNull(call.Argument(0)) {
			arg := call.Argument(0)
			if s, ok := arg.Export().(string); ok {
				s = strings.TrimPrefix(s, "?")
				for _, pair := range strings.Split(s, "&") {
					if pair == "" {
						continue
					}
					k, v, _ := strings.Cut(pair, "=")
					dk, _ := url.QueryUnescape(k)
					dv, _ := url.QueryUnescape(v)
					data.append(dk, dv)
				}
			} else {
				obj := arg.ToObject(vm)
				for _, k := range obj.Keys() {
					data.append(k, obj.Get(k).String())
				}
			}
		}

		call.This.Set("_data", data)
		call.This.Set("_isURLSearchParams", true)
		call.This.Set("append", func(key, value string) { data.append(key, value) })
		call.This.Set("set", func(key, value string) { data.set(key, value) })
		call.This.Set("get", func(key string) interface{} {
			v := data.get(key)
			if v == nil {
				return nil
			}
			return *v
		})
		call.This.Set("has", func(key string) bool { return data.has(key) })
		call.This.Set("delete", func(key string) { data.del(key) })
		call.This.Set("toString", func() string { return data.encode() })
		call.This.Set("forEach", func(fcall goja.FunctionCall) goja.Value {
			cb, ok := goja.AssertFunction(fcall.Argument(0))
			if ok {
				for _, p := range data.params {
					_, _ = cb(nil, vm.ToValue(p[1]), vm.ToValue(p[0]))
				}
			}
			return goja.Undefined()
		})
		call.This.Set("entries", func() goja.Value {
			var pairs []interface{}
			for _, p := range data.params {
				pairs = append(pairs, []interface{}{p[0], p[1]})
			}
			return vm.ToValue(pairs)
		})

		return nil
	})
}

// formDataEntry represents one entry in a FormData.
type formDataEntry struct {
	key   string
	value string
}

// formDataInternal is the Go-side backing store for a FormData instance.
type formDataInternal struct {
	entries []formDataEntry
}

func (fd *formDataInternal) append(key, value string) {
	fd.entries = append(fd.entries, formDataEntry{key, value})
}

func (fd *formDataInternal) set(key, value string) {
	for i := range fd.entries {
		if fd.entries[i].key == key {
			fd.entries[i].value = value
			j := i + 1
			for j < len(fd.entries) {
				if fd.entries[j].key == key {
					fd.entries = append(fd.entries[:j], fd.entries[j+1:]...)
				} else {
					j++
				}
			}
			return
		}
	}
	fd.entries = append(fd.entries, formDataEntry{key, value})
}

func (fd *formDataInternal) get(key string) *string {
	for _, e := range fd.entries {
		if e.key == key {
			return &e.value
		}
	}
	return nil
}

func (fd *formDataInternal) has(key string) bool {
	return fd.get(key) != nil
}

func (fd *formDataInternal) del(key string) {
	j := 0
	for _, e := range fd.entries {
		if e.key != key {
			fd.entries[j] = e
			j++
		}
	}
	fd.entries = fd.entries[:j]
}

// encode serializes the FormData as multipart/form-data and returns the body
// bytes and the Content-Type header (including boundary).
func (fd *formDataInternal) encode() ([]byte, string) {
	boundary := fmt.Sprintf("----HydrisFormBoundary%d", time.Now().UnixNano())
	var buf strings.Builder
	for _, e := range fd.entries {
		buf.WriteString("--")
		buf.WriteString(boundary)
		buf.WriteString("\r\n")
		fmt.Fprintf(&buf, "Content-Disposition: form-data; name=%q\r\n\r\n", e.key)
		buf.WriteString(e.value)
		buf.WriteString("\r\n")
	}
	buf.WriteString("--")
	buf.WriteString(boundary)
	buf.WriteString("--\r\n")
	contentType := "multipart/form-data; boundary=" + boundary
	return []byte(buf.String()), contentType
}

func setupFormData(vm *goja.Runtime) {
	vm.Set("FormData", func(call goja.ConstructorCall) *goja.Object {
		fd := &formDataInternal{}

		call.This.Set("_data", fd)
		call.This.Set("_isFormData", true)
		call.This.Set("append", func(key, value string) { fd.append(key, value) })
		call.This.Set("set", func(key, value string) { fd.set(key, value) })
		call.This.Set("get", func(key string) interface{} {
			v := fd.get(key)
			if v == nil {
				return nil
			}
			return *v
		})
		call.This.Set("has", func(key string) bool { return fd.has(key) })
		call.This.Set("delete", func(key string) { fd.del(key) })
		call.This.Set("forEach", func(fcall goja.FunctionCall) goja.Value {
			cb, ok := goja.AssertFunction(fcall.Argument(0))
			if ok {
				for _, e := range fd.entries {
					_, _ = cb(nil, vm.ToValue(e.value), vm.ToValue(e.key))
				}
			}
			return goja.Undefined()
		})
		call.This.Set("entries", func() goja.Value {
			var pairs []interface{}
			for _, e := range fd.entries {
				pairs = append(pairs, []interface{}{e.key, e.value})
			}
			return vm.ToValue(pairs)
		})

		return nil
	})
}

// setupCrypto provides the Web Crypto API subset used by plugins:
// crypto.randomUUID(), crypto.getRandomValues(typedArray), and
// crypto.subtle.{digest, importKey, sign, encrypt, decrypt, deriveBits}
// (HMAC, AES-GCM, HKDF).
func setupCrypto(vm *goja.Runtime) {
	cryptoObj := vm.NewObject()
	cryptoObj.Set("randomUUID", func() string {
		var uuid [16]byte
		_, _ = rand.Read(uuid[:])
		uuid[6] = (uuid[6] & 0x0f) | 0x40 // version 4
		uuid[8] = (uuid[8] & 0x3f) | 0x80 // variant 1
		return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
			uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:16])
	})
	cryptoObj.Set("getRandomValues", func(call goja.FunctionCall) goja.Value {
		b := exportBytes(vm, call.Argument(0))
		_, _ = rand.Read(b)
		return call.Argument(0)
	})

	subtle := vm.NewObject()

	// Web Crypto reports every failure as a rejected promise, never a throw.
	// goja reports an unhandled rejection as soon as it occurs, so the
	// rejection is deferred one microtask to let await/catch attach a handler.
	asyncVal, err := vm.RunString(`(fn) => function (...args) {
		try { return fn.apply(this, args); }
		catch (e) { return new Promise((_, reject) => { Promise.resolve().then(() => reject(e)); }); }
	}`)
	if err != nil {
		panic(err)
	}
	asyncFn, _ := goja.AssertFunction(asyncVal)
	async := func(fn func(goja.FunctionCall) goja.Value) goja.Value {
		v, err := asyncFn(goja.Undefined(), vm.ToValue(fn))
		if err != nil {
			panic(err)
		}
		return v
	}
	operationError := func(format string, args ...any) *goja.Object {
		return domError(vm, "OperationError", format, args...)
	}
	notSupported := func(format string, args ...any) *goja.Object {
		return domError(vm, "NotSupportedError", format, args...)
	}

	// crypto.subtle.digest(algorithm, data) → Promise<ArrayBuffer>
	subtle.Set("digest", async(func(call goja.FunctionCall) goja.Value {
		algo := call.Argument(0).String()
		data := exportBytes(vm, call.Argument(1))

		var h goHash.Hash
		switch strings.ReplaceAll(strings.ToUpper(algo), "-", "") {
		case "SHA256":
			h = goSHA256.New()
		case "SHA1":
			h = goSHA1.New()
		case "SHA384":
			h = goSHA512.New384()
		case "SHA512":
			h = goSHA512.New()
		default:
			panic(notSupported("unsupported digest algorithm: %s", algo))
		}
		h.Write(data)
		result := h.Sum(nil)
		p, resolve, _ := vm.NewPromise()
		_ = resolve(vm.NewArrayBuffer(result))
		return vm.ToValue(p)
	}))

	// Keep a copy of the key bytes because callers may modify their input buffer.
	subtle.Set("importKey", async(func(call goja.FunctionCall) goja.Value {
		format := call.Argument(0).String()
		if format != "raw" {
			panic(notSupported("importKey: only 'raw' format is supported"))
		}
		keyData := append([]byte(nil), exportBytes(vm, call.Argument(1))...)
		algoName, hashName := algorithmNames(vm, call.Argument(2))
		switch algoName {
		case "HMAC", "AES-GCM", "HKDF":
		default:
			panic(notSupported("importKey: unsupported algorithm %s", algoName))
		}

		key := vm.NewObject()
		key.Set("_raw", vm.NewArrayBuffer(keyData))
		key.Set("_alg", algoName)
		key.Set("_hash", hashName)
		key.Set("type", "secret")

		p, resolve, _ := vm.NewPromise()
		_ = resolve(key)
		return vm.ToValue(p)
	}))

	// crypto.subtle.sign("HMAC", key, data) → Promise<ArrayBuffer>
	subtle.Set("sign", async(func(call goja.FunctionCall) goja.Value {
		keyObj := call.Argument(1).ToObject(vm)
		rawKey := exportBytes(vm, keyObj.Get("_raw"))
		hashName := keyObj.Get("_hash").String()
		data := exportBytes(vm, call.Argument(2))

		hfn := hashFunc(vm, hashName, "HMAC hash")
		mac := goHMAC.New(hfn, rawKey)
		mac.Write(data)
		result := mac.Sum(nil)

		p, resolve, _ := vm.NewPromise()
		_ = resolve(vm.NewArrayBuffer(result))
		return vm.ToValue(p)
	}))

	// Go's GCM implementation accepts 12-byte nonces and 96..128-bit tags.
	aesGCM := func(call goja.FunctionCall, seal bool) goja.Value {
		algoName, _ := algorithmNames(vm, call.Argument(0))
		if algoName != "AES-GCM" {
			panic(notSupported("only AES-GCM is supported, got %s", algoName))
		}
		params := call.Argument(0).ToObject(vm)
		keyObj := call.Argument(1).ToObject(vm)
		if keyObj.Get("_alg").String() != "AES-GCM" {
			panic(domError(vm, "InvalidAccessError", "key is not an AES-GCM key"))
		}
		rawKey := exportBytes(vm, keyObj.Get("_raw"))
		iv := exportBytes(vm, params.Get("iv"))
		var aad []byte
		if ad := params.Get("additionalData"); ad != nil && !goja.IsUndefined(ad) {
			aad = exportBytes(vm, ad)
		}
		tagBits := 128
		if tl := params.Get("tagLength"); tl != nil && !goja.IsUndefined(tl) {
			tagBits = int(tl.ToInteger())
		}
		data := exportBytes(vm, call.Argument(2))

		if tagBits%8 != 0 || tagBits < 96 || tagBits > 128 {
			panic(operationError("AES-GCM tagLength %d unsupported (96..128 bits)", tagBits))
		}
		block, err := aes.NewCipher(rawKey)
		if err != nil {
			panic(operationError("%v", err))
		}
		gcm, err := cipher.NewGCMWithTagSize(block, tagBits/8)
		if err != nil {
			panic(operationError("%v", err))
		}
		if len(iv) != gcm.NonceSize() {
			panic(operationError("AES-GCM iv must be %d bytes, got %d", gcm.NonceSize(), len(iv)))
		}
		var out []byte
		if seal {
			out = gcm.Seal(nil, iv, data, aad)
		} else if out, err = gcm.Open(nil, iv, data, aad); err != nil {
			panic(operationError("%v", err))
		}
		p, resolve, _ := vm.NewPromise()
		_ = resolve(vm.NewArrayBuffer(out))
		return vm.ToValue(p)
	}
	subtle.Set("encrypt", async(func(call goja.FunctionCall) goja.Value { return aesGCM(call, true) }))
	subtle.Set("decrypt", async(func(call goja.FunctionCall) goja.Value { return aesGCM(call, false) }))

	subtle.Set("deriveBits", async(func(call goja.FunctionCall) goja.Value {
		algoName, hashName := algorithmNames(vm, call.Argument(0))
		if algoName != "HKDF" {
			panic(notSupported("only HKDF is supported, got %s", algoName))
		}
		params := call.Argument(0).ToObject(vm)
		keyObj := call.Argument(1).ToObject(vm)
		if keyObj.Get("_alg").String() != "HKDF" {
			panic(domError(vm, "InvalidAccessError", "key is not an HKDF key"))
		}
		ikm := exportBytes(vm, keyObj.Get("_raw"))
		salt := exportBytes(vm, params.Get("salt"))
		info := exportBytes(vm, params.Get("info"))
		lengthBits := int(call.Argument(2).ToInteger())

		if lengthBits <= 0 || lengthBits%8 != 0 {
			panic(operationError("HKDF length must be a positive multiple of 8, got %d", lengthBits))
		}
		hfn := hashFunc(vm, hashName, "HKDF hash")
		out, err := hkdf.Key(hfn, ikm, salt, string(info), lengthBits/8)
		if err != nil {
			panic(operationError("%v", err))
		}
		p, resolve, _ := vm.NewPromise()
		_ = resolve(vm.NewArrayBuffer(out))
		return vm.ToValue(p)
	}))

	cryptoObj.Set("subtle", subtle)
	vm.Set("crypto", cryptoObj)
}

// algorithmNames reads a Web Crypto algorithm argument, which is either a
// name string or {name, hash} with hash itself a string or {name}.
func algorithmNames(vm *goja.Runtime, v goja.Value) (algo, hash string) {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return "", ""
	}
	if _, isString := v.Export().(string); isString {
		return strings.ToUpper(v.String()), ""
	}
	obj := v.ToObject(vm)
	if n := obj.Get("name"); n != nil && !goja.IsUndefined(n) {
		algo = strings.ToUpper(n.String())
	}
	if h := obj.Get("hash"); h != nil && !goja.IsUndefined(h) {
		if _, isString := h.Export().(string); isString {
			hash = h.String()
		} else if hObj := h.ToObject(vm); hObj != nil {
			if n := hObj.Get("name"); n != nil && !goja.IsUndefined(n) {
				hash = n.String()
			}
		}
	}
	return algo, hash
}

// domError builds an Error whose name matches the DOMException Web Crypto
// would reject with, so plugins can branch on e.name.
func domError(vm *goja.Runtime, name, format string, args ...any) *goja.Object {
	e, err := vm.New(vm.Get("Error"), vm.ToValue(fmt.Sprintf(format, args...)))
	if err != nil {
		panic(err)
	}
	e.Set("name", name)
	return e
}

func hashFunc(vm *goja.Runtime, name, what string) func() goHash.Hash {
	switch strings.ReplaceAll(strings.ToUpper(name), "-", "") {
	case "SHA256":
		return goSHA256.New
	case "SHA1":
		return goSHA1.New
	case "SHA384":
		return goSHA512.New384
	case "SHA512":
		return goSHA512.New
	}
	panic(domError(vm, "NotSupportedError", "unsupported %s: %s", what, name))
}

// setupDecompressionStream provides a DecompressionStream that works with
// the ReadableStream-like body objects returned by fetch. Usage:
//
//	const ds = new DecompressionStream("gzip");
//	const decompressed = resp.body.pipeThrough(ds);
//	const reader = decompressed.getReader();
func setupDecompressionStream(loop *eventloop.EventLoop, vm *goja.Runtime) {
	vm.Set("DecompressionStream", func(call goja.ConstructorCall) *goja.Object {
		format := call.Argument(0).String()
		if format != "gzip" {
			panic(vm.NewTypeError("DecompressionStream: unsupported format %q, only \"gzip\" is supported", format))
		}

		// readable: the output side, exposed as a ReadableStream-like with getReader().
		// The actual io.Reader is set when pipeThrough connects input→output.
		var decompReader io.Reader

		readable := vm.NewObject()
		readable.Set("getReader", func() *goja.Object {
			reader := vm.NewObject()
			reader.Set("read", func() goja.Value {
				p, res, rej := vm.NewPromise()
				go func() {
					buf := make([]byte, 32*1024)
					n, err := decompReader.Read(buf)
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
			reader.Set("cancel", func() {})
			return reader
		})

		call.This.Set("readable", readable)

		// _pipeTo is called internally by body.pipeThrough(). It receives
		// the raw io.Reader from the upstream body and wires up gzip.
		call.This.Set("_pipeTo", func(rawReader goja.Value) {
			r := rawReader.Export().(io.Reader)
			gz, err := gzip.NewReader(r)
			if err != nil {
				panic(vm.NewGoError(err))
			}
			decompReader = gz
		})

		return nil
	})
}
