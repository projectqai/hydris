// Package hal provides hardware access (BLE, serial, camera) via a
// platform-specific backend. On Linux/Windows the backend is compiled in.
// On macOS it loads a Swift dylib via purego. On Android it uses gomobile.
//
// Address conventions:
//   - BLE addresses are normalized to lowercase at the HAL boundary.
//     The format is platform-dependent: colon-separated MAC on Linux
//     and Android (e.g. "aa:bb:cc:dd:ee:ff"), UUID on macOS.
//   - Platform backends that require a different case (e.g. Android
//     needs uppercase MACs) must convert internally.
package hal

import (
	"fmt"
	"io"
	"strings"
	"sync"
)

// ReadSensors returns a snapshot of all available no-permission sensors.
// Returns nil if the platform does not support sensor reading.
func ReadSensors() []SensorReading {
	if P.ReadSensors == nil {
		return nil
	}
	return P.ReadSensors()
}

// WatchSerial starts serial port discovery. The callback receives full
// snapshots whenever the port list changes. Returns a stop function.
func WatchSerial(cb func(ports []SerialPort)) (stop func()) {
	if P.SerialWatch == nil {
		return func() {}
	}
	return P.SerialWatch(cb)
}

// WatchBLE starts BLE scanning. The callback receives periodic snapshots.
func WatchBLE(serviceUUIDs []string, cb func(devices []BLEDevice)) (stop func()) {
	if P.BLEWatch == nil {
		return func() {}
	}
	return P.BLEWatch(serviceUUIDs, func(devices []BLEDevice) {
		for i := range devices {
			for j := range devices[i].ServiceUUIDs {
				devices[i].ServiceUUIDs[j] = strings.ToLower(devices[i].ServiceUUIDs[j])
			}
			devices[i].Address = strings.ToLower(devices[i].Address)
		}
		cb(devices)
	})
}

// OpenSerial opens a serial port and returns an io.ReadWriteCloser.
func OpenSerial(path string, baudRate int) (io.ReadWriteCloser, error) {
	if P.SerialOpen == nil {
		return nil, fmt.Errorf("serial not supported on this platform")
	}
	handle, err := P.SerialOpen(path, baudRate)
	if err != nil {
		return nil, err
	}
	return &serialHandle{handle: handle}, nil
}

// ConnectBLE establishes a GATT connection and returns a BLEConnection.
func ConnectBLE(address string) (BLEConnection, error) {
	if P.BLEConnect == nil {
		return nil, fmt.Errorf("BLE not supported on this platform")
	}
	handle, err := P.BLEConnect(address)
	if err != nil {
		return nil, err
	}
	bh := &bleHandle{handle: handle, subs: make(map[string]struct{}), disconnected: make(chan struct{})}
	if P.BLEOnDisconnect != nil {
		P.BLEOnDisconnect(handle, func() {
			bh.closeDisconnected()
		})
	}
	return bh, nil
}

// serialHandle wraps a platform serial handle as io.ReadWriteCloser.
// SerialRead returns chunks; we buffer them for Go's io.Reader interface.
type serialHandle struct {
	handle  int64
	pending []byte
}

func (s *serialHandle) Read(buf []byte) (int, error) {
	if len(s.pending) == 0 {
		data, err := P.SerialRead(s.handle, len(buf))
		if err != nil {
			return 0, err
		}
		s.pending = data
	}
	n := copy(buf, s.pending)
	s.pending = s.pending[n:]
	return n, nil
}

func (s *serialHandle) Write(data []byte) (int, error) { return P.SerialWrite(s.handle, data) }
func (s *serialHandle) Close() error                   { return P.SerialClose(s.handle) }

// bleHandle wraps a platform BLE handle as BLEConnection.
type bleHandle struct {
	handle       int64
	mu           sync.Mutex
	subs         map[string]struct{}
	disconnected chan struct{}
	disconnOnce  sync.Once
}

func (b *bleHandle) ReadCharacteristic(uuid string) ([]byte, error) {
	return P.BLERead(b.handle, uuid)
}

func (b *bleHandle) WriteCharacteristic(uuid string, data []byte) error {
	return P.BLEWrite(b.handle, uuid, data)
}

func (b *bleHandle) Subscribe(uuid string) (<-chan []byte, error) {
	ch := make(chan []byte, 64)
	err := P.BLESubscribe(b.handle, uuid, func(data []byte) {
		select {
		case ch <- data:
		default:
		}
	})
	if err != nil {
		close(ch)
		return nil, err
	}
	b.mu.Lock()
	b.subs[uuid] = struct{}{}
	b.mu.Unlock()
	return ch, nil
}

func (b *bleHandle) Unsubscribe(uuid string) error {
	b.mu.Lock()
	delete(b.subs, uuid)
	b.mu.Unlock()
	return P.BLEUnsubscribe(b.handle, uuid)
}

func (b *bleHandle) Disconnected() <-chan struct{} {
	return b.disconnected
}

func (b *bleHandle) closeDisconnected() {
	b.disconnOnce.Do(func() { close(b.disconnected) })
}

func (b *bleHandle) Close() error {
	b.mu.Lock()
	for uuid := range b.subs {
		_ = P.BLEUnsubscribe(b.handle, uuid)
		delete(b.subs, uuid)
	}
	b.mu.Unlock()
	b.closeDisconnected()
	return P.BLEDisconnect(b.handle)
}

// StreamAdapter flattens a BLEConnection into an io.ReadWriteCloser
// using fixed characteristic UUIDs for read (subscribe) and write.
type StreamAdapter struct {
	conn      BLEConnection
	writeUUID string
	notifyCh  <-chan []byte
	pending   []byte
	closed    chan struct{}
	once      sync.Once
}

// NewStreamAdapter subscribes to readUUID for incoming data and writes to writeUUID.
func NewStreamAdapter(conn BLEConnection, writeUUID, readUUID string) (*StreamAdapter, error) {
	ch, err := conn.Subscribe(readUUID)
	if err != nil {
		return nil, err
	}
	return &StreamAdapter{
		conn:      conn,
		writeUUID: writeUUID,
		notifyCh:  ch,
		closed:    make(chan struct{}),
	}, nil
}

func (s *StreamAdapter) Read(p []byte) (int, error) {
	if len(s.pending) > 0 {
		n := copy(p, s.pending)
		s.pending = s.pending[n:]
		return n, nil
	}
	select {
	case data, ok := <-s.notifyCh:
		if !ok {
			return 0, io.EOF
		}
		n := copy(p, data)
		if n < len(data) {
			s.pending = data[n:]
		}
		return n, nil
	case <-s.closed:
		return 0, io.EOF
	}
}

func (s *StreamAdapter) Write(p []byte) (int, error) {
	if err := s.conn.WriteCharacteristic(s.writeUUID, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (s *StreamAdapter) Close() error {
	s.once.Do(func() { close(s.closed) })
	return s.conn.Close()
}
