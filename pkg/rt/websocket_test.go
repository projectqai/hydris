package rt

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/gorilla/websocket"
)

// wsHandshakeProto starts a WebSocket server that records the
// Sec-WebSocket-Protocol header of the first handshake, runs the given JS
// (which must construct `ws` and call __opened on open), and returns the
// header the server received.
func wsHandshakeProto(t *testing.T, js string) string {
	t.Helper()
	gotProto := make(chan string, 1)
	upgrader := websocket.Upgrader{
		CheckOrigin:  func(*http.Request) bool { return true },
		Subprotocols: []string{"mqtt"},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case gotProto <- r.Header.Get("Sec-WebSocket-Protocol"):
		default:
		}
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.Close() }()
		// Keep the connection open briefly so the client sees "open".
		_, _, _ = c.ReadMessage()
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	loop := eventloop.NewEventLoop()
	loop.Start()
	t.Cleanup(func() { loop.Terminate() })

	opened := make(chan struct{}, 1)
	loop.RunOnLoop(func(vm *goja.Runtime) {
		setupGlobals(loop, vm)
		vm.Set("__url", wsURL)
		vm.Set("__opened", func(goja.FunctionCall) goja.Value {
			select {
			case opened <- struct{}{}:
			default:
			}
			return goja.Undefined()
		})
		_, _ = vm.RunScript("test.js", js+`
			ws.addEventListener("open", () => __opened());
		`)
	})

	select {
	case <-opened:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for WebSocket open")
	}

	select {
	case proto := <-gotProto:
		return proto
	case <-time.After(5 * time.Second):
		t.Fatal("server never received handshake")
		return ""
	}
}

// TestWebSocketForwardsSubprotocol asserts that the W3C protocols argument
// (new WebSocket(url, ["mqtt"])) is forwarded into the handshake as the
// Sec-WebSocket-Protocol header. Regression test for SP-145, where the
// constructor read only Argument(0) and dialed with an empty header, so
// MQTT-over-WS brokers (which require the "mqtt" subprotocol) closed the
// connection.
func TestWebSocketForwardsSubprotocol(t *testing.T) {
	if proto := wsHandshakeProto(t, `const ws = new WebSocket(__url, ["mqtt"]);`); proto != "mqtt" {
		t.Errorf("Sec-WebSocket-Protocol = %q, want %q", proto, "mqtt")
	}
}

// TestWebSocketNoSubprotocol asserts the default behavior when the protocols
// argument is omitted: no Sec-WebSocket-Protocol header is sent.
func TestWebSocketNoSubprotocol(t *testing.T) {
	if proto := wsHandshakeProto(t, `const ws = new WebSocket(__url);`); proto != "" {
		t.Errorf("Sec-WebSocket-Protocol = %q, want empty", proto)
	}
}
