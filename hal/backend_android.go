//go:build android

package hal

import (
	"encoding/json"
	"strings"
	"sync"
)

// On Android, the Platform functions are wired by the android/ package
// which calls SetPlatformFunc for each capability. The android/ package
// defines the gomobile-visible interfaces (PlatformBLE, PlatformSerial).

var (
	androidMu            sync.Mutex
	androidSerialCb      func([]SerialPort)
	androidBLECb         func([]BLEDevice)
	androidNotifyCbs     = make(map[string]func([]byte))
	androidDisconnectCbs = make(map[int64]func())
)

// androidHandler implements the Handler interface from the android/ package.
// Kotlin calls these methods to push events into Go.
type androidHandler struct{}

func (androidHandler) OnSerialPorts(portsJSON string) {
	var ports []SerialPort
	if err := json.Unmarshal([]byte(portsJSON), &ports); err != nil {
		return
	}
	androidMu.Lock()
	cb := androidSerialCb
	androidMu.Unlock()
	if cb != nil {
		cb(ports)
	}
}

func (androidHandler) OnBLEDevices(devicesJSON string) {
	var devices []BLEDevice
	if err := json.Unmarshal([]byte(devicesJSON), &devices); err != nil {
		return
	}
	androidMu.Lock()
	cb := androidBLECb
	androidMu.Unlock()
	if cb != nil {
		cb(devices)
	}
}

func (androidHandler) OnBLENotification(handle int64, charUUID string, data []byte) {
	key := notifyKey(handle, charUUID)
	androidMu.Lock()
	cb := androidNotifyCbs[key]
	androidMu.Unlock()
	if cb != nil {
		// gomobile may reuse the backing byte array
		buf := make([]byte, len(data))
		copy(buf, data)
		cb(buf)
	}
}

func (androidHandler) OnBLEDisconnect(handle int64) {
	androidMu.Lock()
	cb := androidDisconnectCbs[handle]
	delete(androidDisconnectCbs, handle)
	androidMu.Unlock()
	if cb != nil {
		cb()
	}
}

func notifyKey(handle int64, charUUID string) string {
	return string(rune(handle)) + ":" + charUUID
}

// GetHandler returns the Go-side event handler for Kotlin to call.
func GetHandler() androidHandler {
	return androidHandler{}
}

// SetSerialWatch is called by the android/ package to wire serial discovery.
func SetSerialWatch(start func(), stop func()) {
	P.SerialWatch = func(cb func([]SerialPort)) func() {
		androidMu.Lock()
		androidSerialCb = cb
		androidMu.Unlock()
		start()
		return func() {
			androidMu.Lock()
			androidSerialCb = nil
			androidMu.Unlock()
			stop()
		}
	}
}

// SetBLEWatch is called by the android/ package to wire BLE discovery.
func SetBLEWatch(start func(), stop func()) {
	P.BLEWatch = func(_ []string, cb func([]BLEDevice)) func() {
		androidMu.Lock()
		androidBLECb = cb
		androidMu.Unlock()
		start()
		return func() {
			androidMu.Lock()
			androidBLECb = nil
			androidMu.Unlock()
			stop()
		}
	}
}

// SetBLEOps wires the BLE connection operations.
func SetBLEOps(
	connect func(string) (int64, error),
	disconnect func(int64) error,
	read func(int64, string) ([]byte, error),
	write func(int64, string, []byte) error,
	subscribe func(int64, string) error,
	unsubscribe func(int64, string) error,
) {
	P.BLEConnect = func(address string) (int64, error) {
		return connect(strings.ToUpper(address))
	}
	P.BLEDisconnect = disconnect
	P.BLERead = read
	P.BLEWrite = write
	P.BLESubscribe = func(handle int64, charUUID string, cb func([]byte)) error {
		key := notifyKey(handle, charUUID)
		androidMu.Lock()
		androidNotifyCbs[key] = cb
		androidMu.Unlock()
		return subscribe(handle, charUUID)
	}
	P.BLEUnsubscribe = func(handle int64, charUUID string) error {
		key := notifyKey(handle, charUUID)
		androidMu.Lock()
		delete(androidNotifyCbs, key)
		androidMu.Unlock()
		return unsubscribe(handle, charUUID)
	}
	P.BLEOnDisconnect = func(handle int64, cb func()) {
		androidMu.Lock()
		androidDisconnectCbs[handle] = cb
		androidMu.Unlock()
	}
}

// SetSensors wires the sensor reading function.
// The provided function returns a JSON-encoded []SensorReading snapshot.
func SetSensors(read func() string) {
	P.ReadSensors = func() []SensorReading {
		data := read()
		if data == "" {
			return nil
		}
		var readings []SensorReading
		if err := json.Unmarshal([]byte(data), &readings); err != nil {
			return nil
		}
		return readings
	}
}

// SetSerialOps wires the serial I/O operations.
func SetSerialOps(
	open func(string, int) (int64, error),
	read func(int64, int) ([]byte, error),
	write func(int64, []byte) (int, error),
	close func(int64) error,
) {
	P.SerialOpen = open
	P.SerialRead = read
	P.SerialWrite = write
	P.SerialClose = close
}
