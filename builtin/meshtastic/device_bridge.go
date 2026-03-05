package meshtastic

import (
	"context"
	"log/slog"
	"sync"
)

// SerialWriter is implemented by Kotlin via gomobile.
type SerialWriter interface {
	Write(data []byte) (int, error)
}

// DeviceOpener is implemented by Kotlin. Go calls RequestDevice when a config
// entity needs a USB serial device opened.
// deviceFilter is the config "device" field — empty string means any device.
type DeviceOpener interface {
	RequestDevice(deviceFilter string)
}

// deviceConn is a writer + read channel for a single USB device.
type deviceConn struct {
	writer SerialWriter
	recvCh chan []byte
}

// deviceRequest represents a config instance waiting for a USB device.
type deviceRequest struct {
	deviceFilter string
	ch           chan *deviceConn
}

var (
	registryMu   sync.Mutex
	opener       DeviceOpener
	requests     []*deviceRequest
	connected    = make(map[string]chan []byte)
	deviceListCh = make(chan string, 1)
)

// SetDeviceOpener is called once at startup by Kotlin to provide the callback.
func SetDeviceOpener(o DeviceOpener) {
	registryMu.Lock()
	opener = o
	registryMu.Unlock()
}

// UpdateDeviceList is called by Kotlin with a JSON array of all current USB
// devices whenever the set changes (attach/detach) or at startup.
func UpdateDeviceList(devicesJSON string) {
	// Replace any pending update with the latest snapshot.
	select {
	case <-deviceListCh:
	default:
	}
	deviceListCh <- devicesJSON
}

// ConnectDevice is called from Kotlin after it opens a USB device in response
// to a RequestDevice call.
func ConnectDevice(deviceName string, writer SerialWriter) {
	recvCh := make(chan []byte, 256)
	conn := &deviceConn{writer: writer, recvCh: recvCh}

	registryMu.Lock()
	connected[deviceName] = recvCh

	// Find matching request: exact match first, then wildcard
	var matched *deviceRequest
	matchIdx := -1
	for i, r := range requests {
		if r.deviceFilter == deviceName {
			matched = r
			matchIdx = i
			break
		}
	}
	if matched == nil {
		for i, r := range requests {
			if r.deviceFilter == "" {
				matched = r
				matchIdx = i
				break
			}
		}
	}
	if matchIdx >= 0 {
		requests = append(requests[:matchIdx], requests[matchIdx+1:]...)
	}
	registryMu.Unlock()

	if matched != nil {
		matched.ch <- conn
	}
}

// DisconnectDevice is called when a USB device is removed.
func DisconnectDevice(deviceName string) {
	registryMu.Lock()
	delete(connected, deviceName)
	registryMu.Unlock()
}

// OnDeviceData is called from Kotlin's read thread when bytes arrive.
func OnDeviceData(deviceName string, data []byte) {
	buf := make([]byte, len(data))
	copy(buf, data)

	registryMu.Lock()
	ch, ok := connected[deviceName]
	registryMu.Unlock()

	if ok {
		select {
		case ch <- buf:
		default:
		}
	}
}

// waitForDevice registers a request and asks Kotlin to open the device.
func waitForDevice(ctx context.Context, deviceFilter string) (*deviceConn, error) {
	req := &deviceRequest{
		deviceFilter: deviceFilter,
		ch:           make(chan *deviceConn, 1),
	}

	registryMu.Lock()
	requests = append(requests, req)
	o := opener
	registryMu.Unlock()

	defer func() {
		registryMu.Lock()
		for i, r := range requests {
			if r == req {
				requests = append(requests[:i], requests[i+1:]...)
				break
			}
		}
		registryMu.Unlock()
	}()

	// Ask Kotlin to open the device
	if o != nil {
		o.RequestDevice(deviceFilter)
	} else {
		slog.Warn("no DeviceOpener registered, cannot request USB device")
	}

	select {
	case conn := <-req.ch:
		return conn, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
