package rt

import (
	"io"
	"net"
	"sync"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
)

// setupNet registers a Node.js-compatible "net" global on the VM.
//
// Supported surface:
//
//	net.createConnection(port, host?, connectListener?) → Socket
//	net.createConnection({port, host}, connectListener?) → Socket
//	net.connect(…)                                      // alias
//	new net.Socket()                                     // unconnected socket
//
// Socket (mirrors Node.js net.Socket):
//
//	Events:  connect, data, end, close, error, timeout
//	Methods: connect, write, end, destroy, setTimeout, setNoDelay, setKeepAlive,
//	         ref, unref, on, once, removeListener, removeAllListeners
//	Props:   remoteAddress, remotePort, localAddress, localPort,
//	         connecting, destroyed, readyState
func setupNet(loop *eventloop.EventLoop, vm *goja.Runtime) {
	netObj := vm.NewObject()

	// net.createConnection / net.connect
	createConn := func(call goja.FunctionCall) goja.Value {
		host, port, connectCb := parseConnectArgs(vm, call)
		sock := newNetSocket(loop, vm)
		if connectCb != nil {
			sock.once("connect", connectCb)
		}
		sock.doConnect(host, port)
		return sock.obj
	}
	netObj.Set("createConnection", createConn)
	netObj.Set("connect", createConn)

	// net.Socket constructor
	netObj.Set("Socket", func(call goja.ConstructorCall) *goja.Object {
		sock := newNetSocket(loop, vm)
		// Copy methods/props onto the constructor's `this` so `new net.Socket()` works.
		for _, key := range sock.obj.Keys() {
			call.This.Set(key, sock.obj.Get(key))
		}
		return nil
	})

	vm.Set("net", netObj)
}

// parseConnectArgs handles the Node.js argument overloads:
//
//	(port, host?, cb?)
//	({port, host, …}, cb?)
func parseConnectArgs(vm *goja.Runtime, call goja.FunctionCall) (host string, port int, cb goja.Callable) {
	host = "localhost"
	arg0 := call.Argument(0)

	// Options object form: createConnection({ port, host })
	if arg0 != nil && !goja.IsUndefined(arg0) && !goja.IsNull(arg0) {
		if obj := arg0.ToObject(vm); obj != nil && obj.Get("port") != nil && !goja.IsUndefined(obj.Get("port")) {
			port = int(obj.Get("port").ToInteger())
			if h := obj.Get("host"); h != nil && !goja.IsUndefined(h) {
				host = h.String()
			}
			if len(call.Arguments) > 1 {
				cb, _ = goja.AssertFunction(call.Argument(1))
			}
			return
		}
	}

	// Positional form: createConnection(port, host?, cb?)
	port = int(arg0.ToInteger())
	idx := 1
	if idx < len(call.Arguments) {
		a := call.Argument(idx)
		if fn, ok := goja.AssertFunction(a); ok {
			cb = fn
			return
		}
		host = a.String()
		idx++
	}
	if idx < len(call.Arguments) {
		cb, _ = goja.AssertFunction(call.Argument(idx))
	}
	return
}

// netSocket is the Go-side state behind a JS net.Socket object.
type netSocket struct {
	loop *eventloop.EventLoop
	vm   *goja.Runtime
	obj  *goja.Object

	mu        sync.Mutex
	conn      net.Conn
	destroyed bool

	listeners map[string][]socketListener
}

type socketListener struct {
	cb   goja.Callable
	once bool
}

func newNetSocket(loop *eventloop.EventLoop, vm *goja.Runtime) *netSocket {
	s := &netSocket{
		loop:      loop,
		vm:        vm,
		obj:       vm.NewObject(),
		listeners: make(map[string][]socketListener),
	}

	// --- Properties ---
	s.obj.Set("remoteAddress", goja.Undefined())
	s.obj.Set("remotePort", goja.Undefined())
	s.obj.Set("localAddress", goja.Undefined())
	s.obj.Set("localPort", goja.Undefined())
	s.obj.Set("connecting", false)
	s.obj.Set("destroyed", false)
	s.obj.Set("readyState", "closed")

	// --- EventEmitter methods ---
	s.obj.Set("on", func(call goja.FunctionCall) goja.Value {
		event := call.Argument(0).String()
		cb, ok := goja.AssertFunction(call.Argument(1))
		if ok {
			s.addListener(event, cb, false)
		}
		return s.obj
	})
	s.obj.Set("addListener", s.obj.Get("on")) // alias

	s.obj.Set("once", func(call goja.FunctionCall) goja.Value {
		event := call.Argument(0).String()
		cb, ok := goja.AssertFunction(call.Argument(1))
		if ok {
			s.addListener(event, cb, true)
		}
		return s.obj
	})

	s.obj.Set("removeListener", func(call goja.FunctionCall) goja.Value {
		// Individual listener removal is not supported (goja.Callable is
		// not comparable). Use removeAllListeners(event) instead.
		return s.obj
	})
	s.obj.Set("off", s.obj.Get("removeListener")) // alias

	s.obj.Set("removeAllListeners", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) > 0 && !goja.IsUndefined(call.Argument(0)) {
			delete(s.listeners, call.Argument(0).String())
		} else {
			s.listeners = make(map[string][]socketListener)
		}
		return s.obj
	})

	// --- Socket methods ---
	s.obj.Set("connect", func(call goja.FunctionCall) goja.Value {
		host, port, cb := parseConnectArgs(vm, call)
		if cb != nil {
			s.once("connect", cb)
		}
		s.doConnect(host, port)
		return s.obj
	})

	s.obj.Set("write", func(call goja.FunctionCall) goja.Value {
		if s.destroyed {
			return vm.ToValue(false)
		}
		data, cb := parseWriteArgs(vm, call)
		s.mu.Lock()
		conn := s.conn
		s.mu.Unlock()
		if conn == nil {
			if cb != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					_, _ = cb(nil, vm.NewGoError(net.ErrClosed))
				})
			}
			return vm.ToValue(false)
		}
		go func() {
			_, err := conn.Write(data)
			if cb != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					if err != nil {
						_, _ = cb(nil, vm.NewGoError(err))
					} else {
						_, _ = cb(nil)
					}
				})
			}
			if err == nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					s.fire("drain")
				})
			}
		}()
		return vm.ToValue(true)
	})

	s.obj.Set("end", func(call goja.FunctionCall) goja.Value {
		// Optionally write final data before closing.
		if len(call.Arguments) > 0 && !goja.IsUndefined(call.Argument(0)) && !goja.IsNull(call.Argument(0)) {
			data, _ := parseWriteArgs(vm, call)
			s.mu.Lock()
			conn := s.conn
			s.mu.Unlock()
			if conn != nil && len(data) > 0 {
				go func() {
					_, _ = conn.Write(data)
					s.halfClose()
				}()
				return s.obj
			}
		}
		s.halfClose()
		return s.obj
	})

	s.obj.Set("destroy", func(call goja.FunctionCall) goja.Value {
		s.doDestroy(nil)
		return s.obj
	})

	s.obj.Set("setTimeout", func(call goja.FunctionCall) goja.Value {
		ms := call.Argument(0).ToInteger()
		if fn, ok := goja.AssertFunction(call.Argument(1)); ok {
			if ms > 0 {
				s.once("timeout", fn)
			}
		}
		s.mu.Lock()
		conn := s.conn
		s.mu.Unlock()
		if conn != nil {
			if ms > 0 {
				_ = conn.SetDeadline(time.Now().Add(time.Duration(ms) * time.Millisecond))
			} else {
				_ = conn.SetDeadline(time.Time{})
			}
		}
		return s.obj
	})

	s.obj.Set("setNoDelay", func(call goja.FunctionCall) goja.Value {
		noDelay := true
		if len(call.Arguments) > 0 {
			noDelay = call.Argument(0).ToBoolean()
		}
		s.mu.Lock()
		conn := s.conn
		s.mu.Unlock()
		if tc, ok := conn.(*net.TCPConn); ok {
			_ = tc.SetNoDelay(noDelay)
		}
		return s.obj
	})

	s.obj.Set("setKeepAlive", func(call goja.FunctionCall) goja.Value {
		enable := true
		if len(call.Arguments) > 0 {
			enable = call.Argument(0).ToBoolean()
		}
		s.mu.Lock()
		conn := s.conn
		s.mu.Unlock()
		if tc, ok := conn.(*net.TCPConn); ok {
			_ = tc.SetKeepAlive(enable)
		}
		return s.obj
	})

	// ref/unref — no-ops (no concept of event loop ref counting in goja).
	s.obj.Set("ref", func(call goja.FunctionCall) goja.Value { return s.obj })
	s.obj.Set("unref", func(call goja.FunctionCall) goja.Value { return s.obj })

	return s
}

// parseWriteArgs handles Node.js write argument overloads:
//
//	write(data)
//	write(data, encoding)
//	write(data, callback)
//	write(data, encoding, callback)
//
// Returns the raw bytes and optional callback.
func parseWriteArgs(vm *goja.Runtime, call goja.FunctionCall) ([]byte, goja.Callable) {
	arg0 := call.Argument(0)
	var data []byte

	// String data.
	if s, ok := arg0.Export().(string); ok {
		data = []byte(s)
	} else {
		data = exportBytes(vm, arg0)
	}

	// Parse optional trailing args: (encoding?, callback?)
	var cb goja.Callable
	for i := 1; i < len(call.Arguments); i++ {
		a := call.Argument(i)
		if goja.IsUndefined(a) || goja.IsNull(a) {
			continue
		}
		if fn, ok := goja.AssertFunction(a); ok {
			cb = fn
			break
		}
		// else: encoding string — ignored (we always use UTF-8 / raw bytes)
	}
	return data, cb
}

func (s *netSocket) addListener(event string, cb goja.Callable, once bool) {
	s.listeners[event] = append(s.listeners[event], socketListener{cb, once})
}

func (s *netSocket) once(event string, cb goja.Callable) {
	s.addListener(event, cb, true)
}

func (s *netSocket) fire(event string, args ...goja.Value) {
	ls := s.listeners[event]
	if len(ls) == 0 {
		return
	}
	remaining := make([]socketListener, 0, len(ls))
	for _, l := range ls {
		_, _ = l.cb(nil, args...)
		if !l.once {
			remaining = append(remaining, l)
		}
	}
	s.listeners[event] = remaining
}

func (s *netSocket) doConnect(host string, port int) {
	s.obj.Set("connecting", true)
	s.obj.Set("readyState", "opening")

	go func() {
		addr := net.JoinHostPort(host, itoa(port))
		conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
		if err != nil {
			s.loop.RunOnLoop(func(vm *goja.Runtime) {
				s.obj.Set("connecting", false)
				s.obj.Set("readyState", "closed")
				s.fire("error", vm.NewGoError(err))
				s.fire("close", vm.ToValue(true))
			})
			return
		}

		s.mu.Lock()
		s.conn = conn
		s.mu.Unlock()

		s.loop.RunOnLoop(func(vm *goja.Runtime) {
			s.obj.Set("connecting", false)
			s.obj.Set("readyState", "open")

			if addr, ok := conn.RemoteAddr().(*net.TCPAddr); ok {
				s.obj.Set("remoteAddress", addr.IP.String())
				s.obj.Set("remotePort", addr.Port)
			}
			if addr, ok := conn.LocalAddr().(*net.TCPAddr); ok {
				s.obj.Set("localAddress", addr.IP.String())
				s.obj.Set("localPort", addr.Port)
			}

			// Disable Nagle by default (matches Node.js behaviour for createConnection).
			if tc, ok := conn.(*net.TCPConn); ok {
				_ = tc.SetNoDelay(true)
			}

			s.fire("connect")
			s.fire("ready")
		})

		// Background read loop.
		s.readLoop(conn)
	}()
}

func (s *netSocket) readLoop(conn net.Conn) {
	buf := make([]byte, 16*1024)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			s.loop.RunOnLoop(func(vm *goja.Runtime) {
				if !s.destroyed {
					ab := vm.NewArrayBuffer(chunk)
					uint8, _ := vm.New(vm.Get("Uint8Array"), vm.ToValue(ab))
					s.fire("data", uint8)
				}
			})
		}
		if err != nil {
			isTimeout := false
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				isTimeout = true
			}
			s.loop.RunOnLoop(func(vm *goja.Runtime) {
				if isTimeout {
					s.fire("timeout")
				} else if err == io.EOF {
					s.obj.Set("readyState", "writeOnly")
					s.fire("end")
					s.fire("close", vm.ToValue(false))
				} else {
					if !s.destroyed {
						s.fire("error", vm.NewGoError(err))
					}
					s.fire("close", vm.ToValue(true))
				}
			})
			return
		}
	}
}

func (s *netSocket) halfClose() {
	s.mu.Lock()
	conn := s.conn
	s.mu.Unlock()
	if conn == nil {
		return
	}
	go func() {
		// Try graceful half-close (FIN).
		if tc, ok := conn.(*net.TCPConn); ok {
			_ = tc.CloseWrite()
		} else {
			_ = conn.Close()
		}
	}()
}

func (s *netSocket) doDestroy(errVal goja.Value) {
	s.mu.Lock()
	if s.destroyed {
		s.mu.Unlock()
		return
	}
	s.destroyed = true
	conn := s.conn
	s.conn = nil
	s.mu.Unlock()

	s.obj.Set("destroyed", true)
	s.obj.Set("readyState", "closed")

	if conn != nil {
		go func() { _ = conn.Close() }()
	}
}

func itoa(n int) string {
	// Avoid importing strconv for one call.
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	i := len(buf) - 1
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		buf[i] = byte('0' + n%10)
		n /= 10
		i--
	}
	if neg {
		buf[i] = '-'
		i--
	}
	return string(buf[i+1:])
}
