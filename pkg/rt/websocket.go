package rt

import (
	"net/http"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/gorilla/websocket"
)

// setupWebSocket registers a W3C-compatible WebSocket constructor on the VM.
func setupWebSocket(loop *eventloop.EventLoop, vm *goja.Runtime) {
	vm.Set("WebSocket", func(call goja.ConstructorCall) *goja.Object {
		urlStr := call.Argument(0).String()

		obj := call.This
		obj.Set("url", urlStr)
		obj.Set("readyState", 0) // CONNECTING

		type listener struct {
			cb   goja.Callable
			once bool
		}
		listeners := map[string][]listener{}

		addEventListener := func(call goja.FunctionCall) goja.Value {
			event := call.Argument(0).String()
			cb, ok := goja.AssertFunction(call.Argument(1))
			if !ok {
				return goja.Undefined()
			}
			once := false
			if len(call.Arguments) > 2 && !goja.IsUndefined(call.Argument(2)) {
				opts := call.Argument(2).ToObject(vm)
				if v := opts.Get("once"); v != nil {
					once = v.ToBoolean()
				}
			}
			listeners[event] = append(listeners[event], listener{cb, once})
			return goja.Undefined()
		}

		fire := func(event string, args ...goja.Value) {
			remaining := listeners[event][:0]
			for _, l := range listeners[event] {
				_, _ = l.cb(nil, args...)
				if !l.once {
					remaining = append(remaining, l)
				}
			}
			listeners[event] = remaining
		}

		obj.Set("addEventListener", addEventListener)

		var conn *websocket.Conn

		obj.Set("send", func(call goja.FunctionCall) goja.Value {
			if conn == nil {
				return goja.Undefined()
			}
			data := call.Argument(0)
			if b := exportBytes(vm, data); b != nil {
				_ = conn.WriteMessage(websocket.BinaryMessage, b)
			} else {
				_ = conn.WriteMessage(websocket.TextMessage, []byte(data.String()))
			}
			return goja.Undefined()
		})

		obj.Set("close", func(call goja.FunctionCall) goja.Value {
			code := 1000
			reason := ""
			if len(call.Arguments) > 0 {
				code = int(call.Argument(0).ToInteger())
			}
			if len(call.Arguments) > 1 {
				reason = call.Argument(1).String()
			}
			if conn != nil {
				_ = conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(code, reason))
				_ = conn.Close()
			}
			return goja.Undefined()
		})

		// Connect in background goroutine.
		go func() {
			header := http.Header{}
			c, _, err := websocket.DefaultDialer.Dial(urlStr, header)
			if err != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					obj.Set("readyState", 3) // CLOSED
					evt := vm.NewObject()
					evt.Set("type", "error")
					evt.Set("message", err.Error())
					fire("error", evt)
				})
				return
			}
			conn = c

			loop.RunOnLoop(func(vm *goja.Runtime) {
				obj.Set("readyState", 1) // OPEN
				evt := vm.NewObject()
				evt.Set("type", "open")
				fire("open", evt)
			})

			// Read loop.
			for {
				msgType, msg, err := c.ReadMessage()
				if err != nil {
					loop.RunOnLoop(func(vm *goja.Runtime) {
						obj.Set("readyState", 3) // CLOSED
						closeEvt := vm.NewObject()
						closeEvt.Set("type", "close")
						closeEvt.Set("code", 1006)
						closeEvt.Set("reason", err.Error())
						fire("close", closeEvt)
					})
					return
				}
				// Capture msg for closure.
				data := msg
				mt := msgType
				loop.RunOnLoop(func(vm *goja.Runtime) {
					evt := vm.NewObject()
					evt.Set("type", "message")
					if mt == websocket.TextMessage {
						evt.Set("data", string(data))
					} else {
						ab := vm.NewArrayBuffer(data)
						evt.Set("data", ab)
					}
					fire("message", evt)
				})
			}
		}()

		return nil
	})
}
