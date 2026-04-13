package rt

import (
	"bytes"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/projectqai/hydris/hal"
)

// --- mock BLEConnection ---

type mockBLEConn struct {
	mu           sync.Mutex
	readData     []byte
	readErr      error
	writeCapture []byte
	writeUUID    string
	writeErr     error
	subCh        chan []byte
	unsubCalled  bool
	closed       bool
	disconnected chan struct{}
}

func newMockBLEConn() *mockBLEConn {
	return &mockBLEConn{
		subCh:        make(chan []byte, 16),
		disconnected: make(chan struct{}),
	}
}

func (m *mockBLEConn) ReadCharacteristic(uuid string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.readData, m.readErr
}

func (m *mockBLEConn) WriteCharacteristic(uuid string, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.writeUUID = uuid
	m.writeCapture = append([]byte(nil), data...)
	return m.writeErr
}

func (m *mockBLEConn) Subscribe(string) (<-chan []byte, error) {
	return m.subCh, nil
}

func (m *mockBLEConn) Unsubscribe(string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.unsubCalled = true
	return nil
}

func (m *mockBLEConn) Disconnected() <-chan struct{} {
	return m.disconnected
}

func (m *mockBLEConn) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.closed {
		m.closed = true
		select {
		case <-m.disconnected:
		default:
			close(m.disconnected)
		}
	}
	return nil
}

// --- test helper ---

// runAsync sets up a goja event loop with Hydris globals, runs JS (wrapped in
// async IIFE), and waits for the done channel. The JS code should call
// __done(value) to signal completion, where value is retrievable from the
// returned channel.
func runAsync(t *testing.T, mock *mockBLEConn, js string) (result chan goja.Value, loop *eventloop.EventLoop) {
	t.Helper()
	loop = eventloop.NewEventLoop()
	loop.Start()

	saved := ConnectBLEFunc
	ConnectBLEFunc = func(string) (hal.BLEConnection, error) {
		if mock == nil {
			return nil, fmt.Errorf("mock: no connection")
		}
		return mock, nil
	}
	t.Cleanup(func() {
		ConnectBLEFunc = saved
		loop.Terminate()
	})

	result = make(chan goja.Value, 1)

	loop.RunOnLoop(func(vm *goja.Runtime) {
		setupGlobals(loop, vm)
		vm.Set("__done", func(call goja.FunctionCall) goja.Value {
			if len(call.Arguments) > 0 {
				result <- call.Argument(0)
			} else {
				result <- goja.Undefined()
			}
			return goja.Undefined()
		})
		vm.Set("__fail", func(call goja.FunctionCall) goja.Value {
			msg := "JS error"
			if len(call.Arguments) > 0 {
				msg = call.Argument(0).String()
			}
			result <- vm.NewGoError(fmt.Errorf("%s", msg))
			return goja.Undefined()
		})

		wrapped := "(async()=>{" + js + "\n})()"
		if _, err := vm.RunScript("test.js", wrapped); err != nil {
			t.Errorf("script error: %v", err)
			result <- vm.NewGoError(err)
		}
	})

	return result, loop
}

func awaitResult(t *testing.T, ch chan goja.Value) goja.Value {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for JS result")
		return nil
	}
}

// --- Bluetooth Device tests ---

func TestRequestDevice(t *testing.T) {
	mock := newMockBLEConn()
	ch, _ := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("AA:BB");
		__done(JSON.stringify({id: d.id, name: d.name, hasGatt: d.gatt !== undefined}));
	`)
	v := awaitResult(t, ch)
	s := v.String()
	if s != `{"id":"AA:BB","name":"AA:BB","hasGatt":true}` {
		t.Errorf("got %s", s)
	}
}

func TestGATTConnect(t *testing.T) {
	mock := newMockBLEConn()
	ch, _ := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("addr");
		const server = await d.gatt.connect();
		__done(JSON.stringify({connected: d.gatt.connected, hasServer: server !== undefined}));
	`)
	v := awaitResult(t, ch)
	s := v.String()
	if s != `{"connected":true,"hasServer":true}` {
		t.Errorf("got %s", s)
	}
}

func TestGATTConnectError(t *testing.T) {
	ch, _ := runAsync(t, nil, `
		const d = Hydris.bluetooth.requestDevice("addr");
		try {
			await d.gatt.connect();
			__fail("expected error");
		} catch(e) {
			__done(e.message || String(e));
		}
	`)
	v := awaitResult(t, ch)
	s := v.String()
	if s != "mock: no connection" {
		t.Errorf("error = %q, want %q", s, "mock: no connection")
	}
}

func TestGATTDisconnect(t *testing.T) {
	mock := newMockBLEConn()
	ch, _ := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("addr");
		await d.gatt.connect();
		d.gatt.disconnect();
		// Wait for the disconnect goroutine to fire.
		await new Promise(r => setTimeout(r, 100));
		__done(String(d.gatt.connected));
	`)
	v := awaitResult(t, ch)
	if v.String() != "false" {
		t.Errorf("connected = %s, want false", v.String())
	}
	mock.mu.Lock()
	closed := mock.closed
	mock.mu.Unlock()
	if !closed {
		t.Error("mock.Close() not called")
	}
}

func TestDeviceDisconnectEvent(t *testing.T) {
	mock := newMockBLEConn()
	ch, loop := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("addr");
		await d.gatt.connect();
		d.addEventListener("gattserverdisconnected", (evt) => {
			__done(evt.type);
		});
	`)

	// Give JS time to register the listener before triggering disconnect.
	time.Sleep(100 * time.Millisecond)

	// Simulate remote disconnect from Go side.
	loop.RunOnLoop(func(vm *goja.Runtime) {
		// Close the channel outside RunOnLoop to simulate platform callback.
	})
	close(mock.disconnected)

	v := awaitResult(t, ch)
	if v.String() != "gattserverdisconnected" {
		t.Errorf("event type = %q, want %q", v.String(), "gattserverdisconnected")
	}
}

func TestDeviceDisconnectEventOnce(t *testing.T) {
	mock := newMockBLEConn()
	ch, _ := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("addr");
		await d.gatt.connect();
		let count = 0;
		d.addEventListener("gattserverdisconnected", () => {
			count++;
		}, {once: true});
		// Wait for remote disconnect to fire.
		await new Promise(r => {
			d.addEventListener("gattserverdisconnected", () => {
				// Second listener (non-once) to know when event fires.
				setTimeout(() => __done(String(count)), 50);
			});
		});
	`)

	time.Sleep(100 * time.Millisecond)
	close(mock.disconnected)

	v := awaitResult(t, ch)
	if v.String() != "1" {
		t.Errorf("once listener fired %s times, want 1", v.String())
	}
}

func TestGetPrimaryServiceAndCharacteristic(t *testing.T) {
	mock := newMockBLEConn()
	ch, _ := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("addr");
		const server = await d.gatt.connect();
		const svc = await server.getPrimaryService("svc-uuid");
		const char = await svc.getCharacteristic("char-uuid");
		__done(JSON.stringify({svcUUID: svc.uuid, charUUID: char.uuid}));
	`)
	v := awaitResult(t, ch)
	s := v.String()
	if s != `{"svcUUID":"svc-uuid","charUUID":"char-uuid"}` {
		t.Errorf("got %s", s)
	}
}

func TestCharReadValue(t *testing.T) {
	mock := newMockBLEConn()
	mock.readData = []byte{0xDE, 0xAD}
	ch, _ := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("addr");
		const server = await d.gatt.connect();
		const svc = await server.getPrimaryService("svc");
		const char = await svc.getCharacteristic("char");
		const buf = await char.readValue();
		const arr = new Uint8Array(buf);
		__done(JSON.stringify(Array.from(arr)));
	`)
	v := awaitResult(t, ch)
	if v.String() != "[222,173]" {
		t.Errorf("got %s, want [222,173]", v.String())
	}
}

func TestCharWriteValue(t *testing.T) {
	mock := newMockBLEConn()
	ch, _ := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("addr");
		const server = await d.gatt.connect();
		const svc = await server.getPrimaryService("svc");
		const char = await svc.getCharacteristic("char-w");
		await char.writeValue(new Uint8Array([1, 2, 3]));
		__done("ok");
	`)
	v := awaitResult(t, ch)
	if v.String() != "ok" {
		t.Errorf("got %s", v.String())
	}
	mock.mu.Lock()
	defer mock.mu.Unlock()
	if !bytes.Equal(mock.writeCapture, []byte{1, 2, 3}) {
		t.Errorf("writeCapture = %v, want [1 2 3]", mock.writeCapture)
	}
}

func TestCharNotifications(t *testing.T) {
	mock := newMockBLEConn()
	ch, _ := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("addr");
		const server = await d.gatt.connect();
		const svc = await server.getPrimaryService("svc");
		const char = await svc.getCharacteristic("notify-char");
		await char.startNotifications();
		char.addEventListener("characteristicvaluechanged", (evt) => {
			const arr = new Uint8Array(evt.target.value);
			__done(JSON.stringify(Array.from(arr)));
		});
	`)

	// Wait for JS to set up listener, then push data.
	time.Sleep(100 * time.Millisecond)
	mock.subCh <- []byte{0xCA, 0xFE}

	v := awaitResult(t, ch)
	if v.String() != "[202,254]" {
		t.Errorf("got %s, want [202,254]", v.String())
	}
}

func TestCharStopNotifications(t *testing.T) {
	mock := newMockBLEConn()
	ch, _ := runAsync(t, mock, `
		const d = Hydris.bluetooth.requestDevice("addr");
		const server = await d.gatt.connect();
		const svc = await server.getPrimaryService("svc");
		const char = await svc.getCharacteristic("c");
		await char.startNotifications();
		await char.stopNotifications();
		__done("ok");
	`)
	awaitResult(t, ch)
	mock.mu.Lock()
	defer mock.mu.Unlock()
	if !mock.unsubCalled {
		t.Error("Unsubscribe not called")
	}
}

// --- Serial tests ---

type mockSerialPort struct {
	reader *io.PipeReader
	writer *io.PipeWriter
	mu     sync.Mutex
	closed bool
}

func newMockSerialPort() (*mockSerialPort, *io.PipeWriter, *io.PipeReader) {
	// readPipe: Go writes → JS reads via "data" events
	readR, readW := io.Pipe()
	// writePipe: JS writes → Go reads
	writeR, writeW := io.Pipe()
	return &mockSerialPort{reader: readR, writer: writeW}, readW, writeR
}

func (m *mockSerialPort) Read(p []byte) (int, error)  { return m.reader.Read(p) }
func (m *mockSerialPort) Write(p []byte) (int, error) { return m.writer.Write(p) }
func (m *mockSerialPort) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	_ = m.reader.Close()
	_ = m.writer.Close()
	return nil
}

func TestSerialOpen(t *testing.T) {
	port, goWriter, _ := newMockSerialPort()
	defer func() { _ = goWriter.Close() }()

	saved := OpenSerialFunc
	OpenSerialFunc = func(string, int) (io.ReadWriteCloser, error) {
		return port, nil
	}
	t.Cleanup(func() { OpenSerialFunc = saved })

	loop := eventloop.NewEventLoop()
	loop.Start()
	t.Cleanup(func() { loop.Terminate() })

	result := make(chan string, 1)
	loop.RunOnLoop(func(vm *goja.Runtime) {
		setupGlobals(loop, vm)
		vm.Set("__done", func(call goja.FunctionCall) goja.Value {
			result <- call.Argument(0).String()
			return goja.Undefined()
		})
		_, _ = vm.RunScript("test.js", `(async()=>{
			const port = await Hydris.serial.open("/dev/test", 9600);
			__done(String(port.readyState));
		})()`)
	})

	select {
	case v := <-result:
		if v != "1" {
			t.Errorf("readyState = %s, want 1", v)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out")
	}
}

func TestSerialPortDataEvent(t *testing.T) {
	port, goWriter, _ := newMockSerialPort()

	saved := OpenSerialFunc
	OpenSerialFunc = func(string, int) (io.ReadWriteCloser, error) {
		return port, nil
	}
	t.Cleanup(func() { OpenSerialFunc = saved })

	loop := eventloop.NewEventLoop()
	loop.Start()
	t.Cleanup(func() { loop.Terminate() })

	result := make(chan string, 1)
	loop.RunOnLoop(func(vm *goja.Runtime) {
		setupGlobals(loop, vm)
		vm.Set("__done", func(call goja.FunctionCall) goja.Value {
			result <- call.Argument(0).String()
			return goja.Undefined()
		})
		_, _ = vm.RunScript("test.js", `(async()=>{
			const port = await Hydris.serial.open("/dev/test");
			port.addEventListener("data", (evt) => {
				const arr = new Uint8Array(evt.data);
				__done(JSON.stringify(Array.from(arr)));
			});
		})()`)
	})

	// Wait for listener setup, then write data from Go side.
	time.Sleep(100 * time.Millisecond)
	_, _ = goWriter.Write([]byte{10, 20, 30})

	select {
	case v := <-result:
		if v != "[10,20,30]" {
			t.Errorf("got %s, want [10,20,30]", v)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out")
	}
	_ = goWriter.Close()
}

func TestSerialPortWrite(t *testing.T) {
	port, goWriter, goReader := newMockSerialPort()
	defer func() { _ = goWriter.Close() }()

	saved := OpenSerialFunc
	OpenSerialFunc = func(string, int) (io.ReadWriteCloser, error) {
		return port, nil
	}
	t.Cleanup(func() { OpenSerialFunc = saved })

	loop := eventloop.NewEventLoop()
	loop.Start()
	t.Cleanup(func() { loop.Terminate() })

	jsReady := make(chan struct{}, 1)
	loop.RunOnLoop(func(vm *goja.Runtime) {
		setupGlobals(loop, vm)
		vm.Set("__ready", func(goja.FunctionCall) goja.Value {
			jsReady <- struct{}{}
			return goja.Undefined()
		})
		_, _ = vm.RunScript("test.js", `(async()=>{
			const port = await Hydris.serial.open("/dev/test");
			await port.write(new Uint8Array([7, 8, 9]));
			__ready();
		})()`)
	})

	// Read what JS wrote.
	buf := make([]byte, 10)
	n, err := goReader.Read(buf)
	if err != nil {
		t.Fatalf("read error: %v", err)
	}
	if !bytes.Equal(buf[:n], []byte{7, 8, 9}) {
		t.Errorf("got %v, want [7 8 9]", buf[:n])
	}

	select {
	case <-jsReady:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out")
	}
	_ = goReader.Close()
}

func TestSerialPortClose(t *testing.T) {
	port, goWriter, _ := newMockSerialPort()
	defer func() { _ = goWriter.Close() }()

	saved := OpenSerialFunc
	OpenSerialFunc = func(string, int) (io.ReadWriteCloser, error) {
		return port, nil
	}
	t.Cleanup(func() { OpenSerialFunc = saved })

	loop := eventloop.NewEventLoop()
	loop.Start()
	t.Cleanup(func() { loop.Terminate() })

	result := make(chan string, 1)
	loop.RunOnLoop(func(vm *goja.Runtime) {
		setupGlobals(loop, vm)
		vm.Set("__done", func(call goja.FunctionCall) goja.Value {
			result <- call.Argument(0).String()
			return goja.Undefined()
		})
		_, _ = vm.RunScript("test.js", `(async()=>{
			const port = await Hydris.serial.open("/dev/test");
			port.addEventListener("close", (evt) => {
				__done(evt.type);
			});
			port.close();
		})()`)
	})

	select {
	case v := <-result:
		if v != "close" {
			t.Errorf("event type = %q, want %q", v, "close")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out")
	}
}
