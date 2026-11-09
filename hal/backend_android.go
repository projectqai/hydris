//go:build android

package hal

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"
)

// On Android, the Platform functions are wired by the android/ package
// which calls SetPlatformFunc for each capability. The android/ package
// defines the gomobile-visible interfaces (PlatformBLE, PlatformSerial).

var (
	androidMu            sync.Mutex
	androidSerialCb      func([]SerialPort)
	androidBLECb         func([]BLEDevice)
	androidMDNSCb        func([]MDNSPeer)
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

func (androidHandler) OnMDNSPeers(peersJSON string) {
	var peers []MDNSPeer
	if err := json.Unmarshal([]byte(peersJSON), &peers); err != nil {
		return
	}
	androidMu.Lock()
	cb := androidMDNSCb
	androidMu.Unlock()
	if cb != nil {
		cb(peers)
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

// SetMDNS is called by the android/ package to wire mDNS (NsdManager).
func SetMDNS(
	register func(instance, service string, port int, txtJSON string),
	unregister func(),
	startBrowse func(service string),
	stopBrowse func(),
) {
	P.MDNSAdvertise = func(instance, service string, port int, txt map[string]string) (func(), error) {
		txtJSON, err := json.Marshal(txt)
		if err != nil {
			return nil, err
		}
		register(instance, service, port, string(txtJSON))
		return unregister, nil
	}
	P.MDNSBrowse = func(service string, cb func([]MDNSPeer)) (func(), error) {
		androidMu.Lock()
		androidMDNSCb = cb
		androidMu.Unlock()
		startBrowse(service)
		return func() {
			androidMu.Lock()
			androidMDNSCb = nil
			androidMu.Unlock()
			stopBrowse()
		}, nil
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

// SetJoystick wires gamepad access. list returns a JSON-encoded []JoystickDevice
// snapshot; read returns a JSON-encoded JoystickState, empty once the device is gone.
func SetJoystick(list func() string, read func(string) string) {
	devices := func() []JoystickDevice {
		var d []JoystickDevice
		if err := json.Unmarshal([]byte(list()), &d); err != nil {
			return nil
		}
		return d
	}
	var mu sync.Mutex
	handles := map[int64]string{}
	var next int64

	P.JoystickWatch = func(cb func([]JoystickDevice)) (stop func()) {
		done := make(chan struct{})
		go func() {
			t := time.NewTicker(2 * time.Second)
			defer t.Stop()
			var last []JoystickDevice
			first := true
			for {
				d := devices()
				if first || !slices.Equal(d, last) {
					cb(d)
					last, first = d, false
				}
				select {
				case <-done:
					return
				case <-t.C:
				}
			}
		}()
		var once sync.Once
		return func() { once.Do(func() { close(done) }) }
	}
	P.JoystickOpen = func(id string) (int64, error) {
		if !slices.ContainsFunc(devices(), func(d JoystickDevice) bool { return d.ID == id }) {
			return 0, fmt.Errorf("joystick %s is not connected", id)
		}
		mu.Lock()
		defer mu.Unlock()
		next++
		handles[next] = id
		return next, nil
	}
	P.JoystickRead = func(handle int64) (JoystickState, error) {
		mu.Lock()
		id, ok := handles[handle]
		mu.Unlock()
		if !ok {
			return JoystickState{}, fmt.Errorf("joystick not open")
		}
		data := read(id)
		if data == "" {
			return JoystickState{}, fmt.Errorf("joystick gone")
		}
		var st JoystickState
		if err := json.Unmarshal([]byte(data), &st); err != nil {
			return JoystickState{}, err
		}
		return st, nil
	}
	P.JoystickClose = func(handle int64) error {
		mu.Lock()
		delete(handles, handle)
		mu.Unlock()
		return nil
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
