package hal

import (
	"bytes"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"
)

func saveP(t *testing.T) {
	t.Helper()
	saved := P
	t.Cleanup(func() { P = saved })
}

// --- ConnectBLE ---

func TestConnectBLE(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		saveP(t)
		var gotAddr string
		P = Platform{
			BLEConnect: func(address string) (int64, error) {
				gotAddr = address
				return 42, nil
			},
			BLEDisconnect: func(int64) error { return nil },
		}
		conn, err := ConnectBLE("aa:bb:cc")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if conn == nil {
			t.Fatal("expected non-nil connection")
		}
		if gotAddr != "aa:bb:cc" {
			t.Errorf("address = %q, want %q", gotAddr, "aa:bb:cc")
		}
	})

	t.Run("error", func(t *testing.T) {
		saveP(t)
		P = Platform{
			BLEConnect: func(string) (int64, error) {
				return 0, fmt.Errorf("radio off")
			},
		}
		conn, err := ConnectBLE("addr")
		if err == nil {
			t.Fatal("expected error")
		}
		if conn != nil {
			t.Error("expected nil connection on error")
		}
	})

	t.Run("nil_platform", func(t *testing.T) {
		saveP(t)
		P = Platform{}
		_, err := ConnectBLE("addr")
		if err == nil {
			t.Fatal("expected error for nil BLEConnect")
		}
	})
}

// --- Read/Write delegation ---

func TestBLEReadCharacteristic(t *testing.T) {
	saveP(t)
	var gotHandle int64
	var gotUUID string
	P = Platform{
		BLEConnect: func(string) (int64, error) { return 7, nil },
		BLERead: func(h int64, uuid string) ([]byte, error) {
			gotHandle = h
			gotUUID = uuid
			return []byte{0xDE, 0xAD}, nil
		},
		BLEDisconnect: func(int64) error { return nil },
	}
	conn, _ := ConnectBLE("addr")
	data, err := conn.ReadCharacteristic("char-a")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotHandle != 7 {
		t.Errorf("handle = %d, want 7", gotHandle)
	}
	if gotUUID != "char-a" {
		t.Errorf("uuid = %q, want %q", gotUUID, "char-a")
	}
	if !bytes.Equal(data, []byte{0xDE, 0xAD}) {
		t.Errorf("data = %v, want [0xDE 0xAD]", data)
	}
}

func TestBLEWriteCharacteristic(t *testing.T) {
	saveP(t)
	var gotHandle int64
	var gotUUID string
	var gotData []byte
	P = Platform{
		BLEConnect: func(string) (int64, error) { return 9, nil },
		BLEWrite: func(h int64, uuid string, data []byte) error {
			gotHandle = h
			gotUUID = uuid
			gotData = data
			return nil
		},
		BLEDisconnect: func(int64) error { return nil },
	}
	conn, _ := ConnectBLE("addr")
	err := conn.WriteCharacteristic("char-w", []byte{1, 2, 3})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotHandle != 9 {
		t.Errorf("handle = %d, want 9", gotHandle)
	}
	if gotUUID != "char-w" {
		t.Errorf("uuid = %q, want %q", gotUUID, "char-w")
	}
	if !bytes.Equal(gotData, []byte{1, 2, 3}) {
		t.Errorf("data = %v, want [1 2 3]", gotData)
	}
}

// --- Subscribe ---

func TestBLESubscribe(t *testing.T) {
	saveP(t)
	var platformCb func([]byte)
	P = Platform{
		BLEConnect: func(string) (int64, error) { return 1, nil },
		BLESubscribe: func(h int64, uuid string, cb func([]byte)) error {
			platformCb = cb
			return nil
		},
		BLEUnsubscribe: func(int64, string) error { return nil },
		BLEDisconnect:  func(int64) error { return nil },
	}
	conn, _ := ConnectBLE("addr")
	ch, err := conn.Subscribe("notify-uuid")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if platformCb == nil {
		t.Fatal("platform callback not set")
	}

	platformCb([]byte{0xAA})
	select {
	case data := <-ch:
		if !bytes.Equal(data, []byte{0xAA}) {
			t.Errorf("data = %v, want [0xAA]", data)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for data")
	}
}

func TestBLESubscribeDropWhenFull(t *testing.T) {
	saveP(t)
	var platformCb func([]byte)
	P = Platform{
		BLEConnect: func(string) (int64, error) { return 1, nil },
		BLESubscribe: func(h int64, uuid string, cb func([]byte)) error {
			platformCb = cb
			return nil
		},
		BLEUnsubscribe: func(int64, string) error { return nil },
		BLEDisconnect:  func(int64) error { return nil },
	}
	conn, _ := ConnectBLE("addr")
	_, _ = conn.Subscribe("uuid")

	// Fill the 64-capacity buffer, then send one more.
	for i := 0; i < 65; i++ {
		platformCb([]byte{byte(i)})
	}
	// If we got here without blocking, the drop-on-full works.
}

func TestBLEUnsubscribe(t *testing.T) {
	saveP(t)
	var unsubHandle int64
	var unsubUUID string
	P = Platform{
		BLEConnect: func(string) (int64, error) { return 3, nil },
		BLESubscribe: func(int64, string, func([]byte)) error {
			return nil
		},
		BLEUnsubscribe: func(h int64, uuid string) error {
			unsubHandle = h
			unsubUUID = uuid
			return nil
		},
		BLEDisconnect: func(int64) error { return nil },
	}
	conn, _ := ConnectBLE("addr")
	_, _ = conn.Subscribe("sub-uuid")
	err := conn.Unsubscribe("sub-uuid")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if unsubHandle != 3 {
		t.Errorf("handle = %d, want 3", unsubHandle)
	}
	if unsubUUID != "sub-uuid" {
		t.Errorf("uuid = %q, want %q", unsubUUID, "sub-uuid")
	}
}

// --- Close + disconnect ---

func TestBLEClose(t *testing.T) {
	saveP(t)
	unsubbed := map[string]bool{}
	var disconnectHandle int64
	P = Platform{
		BLEConnect: func(string) (int64, error) { return 5, nil },
		BLESubscribe: func(int64, string, func([]byte)) error {
			return nil
		},
		BLEUnsubscribe: func(h int64, uuid string) error {
			unsubbed[uuid] = true
			return nil
		},
		BLEDisconnect: func(h int64) error {
			disconnectHandle = h
			return nil
		},
	}
	conn, _ := ConnectBLE("addr")
	_, _ = conn.Subscribe("a")
	_, _ = conn.Subscribe("b")
	err := conn.Close()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !unsubbed["a"] || !unsubbed["b"] {
		t.Errorf("not all subscriptions cleaned up: %v", unsubbed)
	}
	if disconnectHandle != 5 {
		t.Errorf("disconnect handle = %d, want 5", disconnectHandle)
	}
	// Disconnected channel should be closed.
	select {
	case <-conn.Disconnected():
	default:
		t.Error("Disconnected() channel not closed after Close()")
	}
}

func TestBLEOnDisconnect_Remote(t *testing.T) {
	saveP(t)
	var disconnectCb func()
	P = Platform{
		BLEConnect:    func(string) (int64, error) { return 1, nil },
		BLEDisconnect: func(int64) error { return nil },
		BLEOnDisconnect: func(h int64, cb func()) {
			disconnectCb = cb
		},
	}
	conn, _ := ConnectBLE("addr")
	if disconnectCb == nil {
		t.Fatal("BLEOnDisconnect callback not registered")
	}

	// Simulate remote disconnect.
	disconnectCb()

	select {
	case <-conn.Disconnected():
	case <-time.After(time.Second):
		t.Fatal("Disconnected() not closed after remote disconnect")
	}
}

func TestBLEDoubleClose(t *testing.T) {
	saveP(t)
	P = Platform{
		BLEConnect:    func(string) (int64, error) { return 1, nil },
		BLEDisconnect: func(int64) error { return nil },
	}
	conn, _ := ConnectBLE("addr")
	_ = conn.Close()
	_ = conn.Close() // must not panic (sync.Once on disconnect channel)
}

// --- StreamAdapter ---

// mockBLEConn is a minimal BLEConnection for StreamAdapter tests.
type mockBLEConn struct {
	subCh        chan []byte
	writtenUUID  string
	writtenData  []byte
	writeErr     error
	closed       bool
	mu           sync.Mutex
	disconnected chan struct{}
}

func newMockBLEConn() *mockBLEConn {
	return &mockBLEConn{
		subCh:        make(chan []byte, 16),
		disconnected: make(chan struct{}),
	}
}

func (m *mockBLEConn) ReadCharacteristic(string) ([]byte, error) { return nil, nil }
func (m *mockBLEConn) WriteCharacteristic(uuid string, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.writtenUUID = uuid
	m.writtenData = append([]byte(nil), data...)
	return m.writeErr
}
func (m *mockBLEConn) Subscribe(string) (<-chan []byte, error) { return m.subCh, nil }
func (m *mockBLEConn) Unsubscribe(string) error                { return nil }
func (m *mockBLEConn) Disconnected() <-chan struct{}           { return m.disconnected }
func (m *mockBLEConn) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	return nil
}

func TestStreamAdapter_ReadWrite(t *testing.T) {
	mock := newMockBLEConn()
	sa, err := NewStreamAdapter(mock, "w-uuid", "r-uuid")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Read: push data into subscribe channel.
	mock.subCh <- []byte{1, 2, 3, 4, 5}
	buf := make([]byte, 10)
	n, err := sa.Read(buf)
	if err != nil {
		t.Fatalf("read error: %v", err)
	}
	if !bytes.Equal(buf[:n], []byte{1, 2, 3, 4, 5}) {
		t.Errorf("read = %v, want [1 2 3 4 5]", buf[:n])
	}

	// Write: should delegate to WriteCharacteristic with correct UUID.
	_, err = sa.Write([]byte{0xAA, 0xBB})
	if err != nil {
		t.Fatalf("write error: %v", err)
	}
	mock.mu.Lock()
	if mock.writtenUUID != "w-uuid" {
		t.Errorf("write uuid = %q, want %q", mock.writtenUUID, "w-uuid")
	}
	if !bytes.Equal(mock.writtenData, []byte{0xAA, 0xBB}) {
		t.Errorf("write data = %v, want [0xAA 0xBB]", mock.writtenData)
	}
	mock.mu.Unlock()
}

func TestStreamAdapter_ReadBuffering(t *testing.T) {
	mock := newMockBLEConn()
	sa, _ := NewStreamAdapter(mock, "w", "r")

	mock.subCh <- []byte{1, 2, 3, 4, 5}

	buf := make([]byte, 3)
	n, _ := sa.Read(buf)
	if !bytes.Equal(buf[:n], []byte{1, 2, 3}) {
		t.Errorf("first read = %v, want [1 2 3]", buf[:n])
	}

	// Second read should return buffered remainder without needing channel data.
	n, _ = sa.Read(buf)
	if !bytes.Equal(buf[:n], []byte{4, 5}) {
		t.Errorf("second read = %v, want [4 5]", buf[:n])
	}
}

func TestStreamAdapter_ReadAfterClose(t *testing.T) {
	mock := newMockBLEConn()
	sa, _ := NewStreamAdapter(mock, "w", "r")
	_ = sa.Close()

	buf := make([]byte, 10)
	_, err := sa.Read(buf)
	if err != io.EOF {
		t.Errorf("err = %v, want io.EOF", err)
	}
}

// --- serialHandle ---

func TestSerialHandle(t *testing.T) {
	saveP(t)
	var closeHandle int64
	P = Platform{
		SerialOpen: func(path string, br int) (int64, error) {
			return 99, nil
		},
		SerialRead: func(h int64, maxLen int) ([]byte, error) {
			return []byte{10, 20, 30}, nil
		},
		SerialWrite: func(h int64, data []byte) (int, error) {
			return len(data), nil
		},
		SerialClose: func(h int64) error {
			closeHandle = h
			return nil
		},
	}

	rwc, err := OpenSerial("/dev/test", 9600)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	buf := make([]byte, 10)
	n, err := rwc.Read(buf)
	if err != nil {
		t.Fatalf("read error: %v", err)
	}
	if !bytes.Equal(buf[:n], []byte{10, 20, 30}) {
		t.Errorf("read = %v, want [10 20 30]", buf[:n])
	}

	n, err = rwc.Write([]byte{1, 2})
	if err != nil || n != 2 {
		t.Errorf("write: n=%d, err=%v", n, err)
	}

	_ = rwc.Close()
	if closeHandle != 99 {
		t.Errorf("close handle = %d, want 99", closeHandle)
	}
}

func TestSerialHandle_ReadBuffering(t *testing.T) {
	saveP(t)
	callCount := 0
	P = Platform{
		SerialOpen: func(string, int) (int64, error) { return 1, nil },
		SerialRead: func(h int64, maxLen int) ([]byte, error) {
			callCount++
			return []byte{1, 2, 3, 4, 5}, nil
		},
		SerialClose: func(int64) error { return nil },
	}

	rwc, _ := OpenSerial("/dev/test", 9600)
	buf := make([]byte, 3)

	// First read: calls platform, gets 5 bytes, returns 3.
	n, _ := rwc.Read(buf)
	if !bytes.Equal(buf[:n], []byte{1, 2, 3}) {
		t.Errorf("first read = %v, want [1 2 3]", buf[:n])
	}
	if callCount != 1 {
		t.Errorf("platform called %d times, want 1", callCount)
	}

	// Second read: returns remaining 2 from pending, no platform call.
	n, _ = rwc.Read(buf)
	if !bytes.Equal(buf[:n], []byte{4, 5}) {
		t.Errorf("second read = %v, want [4 5]", buf[:n])
	}
	if callCount != 1 {
		t.Errorf("platform called %d times, want 1 (should use pending)", callCount)
	}
}

// --- WatchBLE ---

func TestWatchBLE_NormalizesCase(t *testing.T) {
	saveP(t)
	var userCb func([]BLEDevice)
	P = Platform{
		BLEWatch: func(_ []string, cb func([]BLEDevice)) func() {
			userCb = cb
			return func() {}
		},
	}

	var got []BLEDevice
	done := make(chan struct{})
	stop := WatchBLE(nil, func(devices []BLEDevice) {
		got = devices
		close(done)
	})
	defer stop()

	// Platform sends uppercase.
	userCb([]BLEDevice{
		{Address: "AA:BB:CC", ServiceUUIDs: []string{"1234-ABCD"}},
	})

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out")
	}

	if got[0].Address != "aa:bb:cc" {
		t.Errorf("address = %q, want lowercase", got[0].Address)
	}
	if got[0].ServiceUUIDs[0] != "1234-abcd" {
		t.Errorf("service uuid = %q, want lowercase", got[0].ServiceUUIDs[0])
	}
}
