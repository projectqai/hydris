//go:build linux || windows

package platform

import (
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/projectqai/hydris/hal"
	"tinygo.org/x/bluetooth"
)

const bleScanInterval = 5 * time.Second

var (
	bleMu          sync.Mutex
	bleConnections = make(map[int64]*bleConn)
	bleNextHandle  atomic.Int64
)

func bleWatch(serviceUUIDs []string, cb func([]hal.BLEDevice)) (stop func()) {
	adapter, err := bleAdapter()
	if err != nil {
		slog.Error("failed to find BLE adapter", "error", err)
		return func() {}
	}
	if err := adapter.Enable(); err != nil {
		slog.Error("failed to enable BLE adapter", "error", err)
		return func() {}
	}

	done := make(chan struct{})

	var mu sync.Mutex
	devices := make(map[string]*hal.BLEDevice)

	go func() {
		if err := adapter.Scan(func(_ *bluetooth.Adapter, result bluetooth.ScanResult) {
			addr := result.Address.String()
			name := result.LocalName()

			var uuids []string
			for _, u := range result.ServiceUUIDs() {
				uuids = append(uuids, u.String())
			}

			mu.Lock()
			if existing, ok := devices[addr]; ok {
				// Merge: Windows delivers advertisement and scan
				// response as separate events, so keep the best
				// data we've seen across all packets.
				if name != "" {
					existing.Name = name
				}
				if len(uuids) > 0 {
					existing.ServiceUUIDs = uuids
				}
				existing.RSSI = int(result.RSSI)
			} else {
				devices[addr] = &hal.BLEDevice{
					Address:      addr,
					Name:         name,
					ServiceUUIDs: uuids,
					RSSI:         int(result.RSSI),
				}
			}
			mu.Unlock()
		}); err != nil {
			slog.Error("BLE scan failed", "error", err)
		}
	}()

	// Probe devices for GATT services in the background so it
	// doesn't block the ticker from delivering snapshots.
	probed := make(map[string]bool)
	probeCh := make(chan hal.BLEDevice, 16)
	go func() {
		for d := range probeCh {
			addr, err := parseAddress(d.Address)
			if err != nil {
				continue
			}
			if uuids := bleProbeServices(addr); len(uuids) > 0 {
				mu.Lock()
				if dev, ok := devices[d.Address]; ok {
					dev.ServiceUUIDs = uuids
				}
				mu.Unlock()
			}
		}
	}()

	go func() {
		ticker := time.NewTicker(bleScanInterval)
		defer ticker.Stop()
		defer close(probeCh)
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				mu.Lock()
				for _, d := range devices {
					if len(d.ServiceUUIDs) == 0 && !probed[d.Address] {
						probed[d.Address] = true
						select {
						case probeCh <- *d:
						default:
						}
					}
				}
				snapshot := make([]hal.BLEDevice, 0, len(devices))
				for _, d := range devices {
					snapshot = append(snapshot, *d)
				}
				mu.Unlock()
				cb(snapshot)
			}
		}
	}()

	return func() {
		close(done)
		_ = adapter.StopScan()
	}
}

func bleConnect(address string) (int64, error) {
	adapter, err := bleAdapter()
	if err != nil {
		return 0, fmt.Errorf("find BLE adapter: %w", err)
	}
	if err := adapter.Enable(); err != nil {
		return 0, fmt.Errorf("enable BLE adapter: %w", err)
	}

	addr, err := parseAddress(address)
	if err != nil {
		return 0, fmt.Errorf("parse BLE address %q: %w", address, err)
	}

	device, err := adapter.Connect(addr, bluetooth.ConnectionParams{})
	if err != nil {
		return 0, fmt.Errorf("BLE connect %s: %w", address, err)
	}

	conn := &bleConn{
		address: address,
		device:  device,
		chars:   make(map[string]bluetooth.DeviceCharacteristic),
		subs:    make(map[string]chan []byte),
	}

	services, err := device.DiscoverServices(nil)
	if err != nil {
		_ = device.Disconnect()
		return 0, fmt.Errorf("discover services: %w", err)
	}

	for _, svc := range services {
		chars, err := svc.DiscoverCharacteristics(nil)
		if err != nil {
			continue
		}
		for _, c := range chars {
			conn.chars[c.UUID().String()] = c
		}
	}

	handle := bleNextHandle.Add(1)
	bleMu.Lock()
	bleConnections[handle] = conn
	bleMu.Unlock()

	return handle, nil
}

func bleOnDisconnect(handle int64, cb func()) {
	bleMu.Lock()
	conn, ok := bleConnections[handle]
	bleMu.Unlock()
	if ok {
		conn.mu.Lock()
		conn.onDisconnect = cb
		conn.mu.Unlock()
	}
}

func bleDisconnect(handle int64) error {
	bleMu.Lock()
	conn, ok := bleConnections[handle]
	if ok {
		delete(bleConnections, handle)
	}
	bleMu.Unlock()
	if !ok {
		return fmt.Errorf("unknown BLE handle %d", handle)
	}
	return conn.Close()
}

func getbleConn(handle int64) (*bleConn, error) {
	bleMu.Lock()
	conn, ok := bleConnections[handle]
	bleMu.Unlock()
	if !ok {
		return nil, fmt.Errorf("unknown BLE handle %d", handle)
	}
	return conn, nil
}

func bleRead(handle int64, charUUID string) ([]byte, error) {
	conn, err := getbleConn(handle)
	if err != nil {
		return nil, err
	}
	return conn.ReadCharacteristic(charUUID)
}

func bleWrite(handle int64, charUUID string, data []byte) error {
	conn, err := getbleConn(handle)
	if err != nil {
		return err
	}
	return conn.WriteCharacteristic(charUUID, data)
}

func bleSubscribe(handle int64, charUUID string, cb func([]byte)) error {
	conn, err := getbleConn(handle)
	if err != nil {
		return err
	}
	conn.mu.Lock()
	defer conn.mu.Unlock()

	char, ok := conn.chars[charUUID]
	if !ok {
		return fmt.Errorf("characteristic %s not found", charUUID)
	}

	ch := make(chan []byte, 64)
	conn.subs[charUUID] = ch

	err = char.EnableNotifications(func(buf []byte) {
		data := make([]byte, len(buf))
		copy(data, buf)
		select {
		case ch <- data:
		default:
		}
	})
	if err != nil {
		delete(conn.subs, charUUID)
		close(ch)
		return fmt.Errorf("enable notifications: %w", err)
	}

	go func() {
		for data := range ch {
			cb(data)
		}
	}()

	return nil
}

func bleUnsubscribe(handle int64, charUUID string) error {
	conn, err := getbleConn(handle)
	if err != nil {
		return err
	}
	return conn.Unsubscribe(charUUID)
}

// bleConn wraps a tinygo bluetooth.Device.
type bleConn struct {
	address      string
	device       bluetooth.Device
	mu           sync.Mutex
	chars        map[string]bluetooth.DeviceCharacteristic
	subs         map[string]chan []byte
	closed       bool
	onDisconnect func()
}

func (c *bleConn) ReadCharacteristic(uuid string) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	char, ok := c.chars[uuid]
	if !ok {
		return nil, fmt.Errorf("characteristic %s not found", uuid)
	}
	buf := make([]byte, 512)
	n, err := char.Read(buf)
	if err != nil {
		return nil, err
	}
	return buf[:n], nil
}

func (c *bleConn) WriteCharacteristic(uuid string, data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	char, ok := c.chars[uuid]
	if !ok {
		return fmt.Errorf("characteristic %s not found", uuid)
	}
	_, err := char.WriteWithoutResponse(data)
	return err
}

func (c *bleConn) Unsubscribe(uuid string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch, ok := c.subs[uuid]
	if !ok {
		return nil
	}
	delete(c.subs, uuid)
	close(ch)
	return nil
}

func (c *bleConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	for uuid, ch := range c.subs {
		close(ch)
		delete(c.subs, uuid)
	}
	return c.device.Disconnect()
}

func parseAddress(addr string) (bluetooth.Address, error) {
	mac, err := bluetooth.ParseMAC(strings.ToUpper(addr))
	if err != nil {
		return bluetooth.Address{}, err
	}
	return bluetooth.Address{MACAddress: bluetooth.MACAddress{MAC: mac}}, nil
}
