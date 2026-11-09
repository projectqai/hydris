//go:build darwin

package hal

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"sync"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
)

var (
	dylib uintptr

	// Serial
	cHalSerialWatch func(cb uintptr) uintptr
	cHalStopWatch   func(handle uintptr)
	cHalSerialOpen  func(path string, baud int32) int64
	cHalSerialRead  func(handle int64, buf *byte, n int32) int32
	cHalSerialWrite func(handle int64, buf *byte, n int32) int32
	cHalSerialClose func(handle int64) int32

	// BLE
	cHalBleWatch        func(cb uintptr) uintptr
	cHalBleConnect      func(address string) int64
	cHalBleDisconnect   func(handle int64) int32
	cHalBleRead         func(handle int64, charUUID string, buf *byte, n int32) int32
	cHalBleWrite        func(handle int64, charUUID string, data *byte, n int32) int32
	cHalBleSubscribe    func(handle int64, charUUID string, cb uintptr) int32
	cHalBleUnsubscribe  func(handle int64, charUUID string) int32
	cHalBleServices     func(handle int64, buf *byte, n int32) int32
	cHalBleOnDisconnect func(handle int64, cb uintptr)

	// Joystick. Absent from a dylib built before joystick support.
	cHalJoystickList func(buf *byte, n int32) int32
	cHalJoystickRead func(id string, axes *float32, buttons *byte) int32
	cHalJoystickMain func()

	// Error
	cHalGetError func(buf *byte, n int32) int32
)

func init() {
	path := findDylib()
	if path == "" {
		slog.Warn("hydris HAL dylib not found, hardware access unavailable")
		return
	}

	var err error
	dylib, err = purego.Dlopen(path, purego.RTLD_LAZY)
	if err != nil {
		slog.Error("failed to load HAL dylib", "path", path, "error", err)
		return
	}

	purego.RegisterLibFunc(&cHalSerialWatch, dylib, "HalSerialWatch")
	purego.RegisterLibFunc(&cHalStopWatch, dylib, "HalStopWatch")
	purego.RegisterLibFunc(&cHalSerialOpen, dylib, "HalSerialOpen")
	purego.RegisterLibFunc(&cHalSerialRead, dylib, "HalSerialRead")
	purego.RegisterLibFunc(&cHalSerialWrite, dylib, "HalSerialWrite")
	purego.RegisterLibFunc(&cHalSerialClose, dylib, "HalSerialClose")

	purego.RegisterLibFunc(&cHalBleWatch, dylib, "HalBleWatch")
	purego.RegisterLibFunc(&cHalBleConnect, dylib, "HalBleConnect")
	purego.RegisterLibFunc(&cHalBleDisconnect, dylib, "HalBleDisconnect")
	purego.RegisterLibFunc(&cHalBleRead, dylib, "HalBleRead")
	purego.RegisterLibFunc(&cHalBleWrite, dylib, "HalBleWrite")
	purego.RegisterLibFunc(&cHalBleSubscribe, dylib, "HalBleSubscribe")
	purego.RegisterLibFunc(&cHalBleUnsubscribe, dylib, "HalBleUnsubscribe")
	purego.RegisterLibFunc(&cHalBleServices, dylib, "HalBleServices")
	purego.RegisterLibFunc(&cHalBleOnDisconnect, dylib, "HalBleOnDisconnect")

	purego.RegisterLibFunc(&cHalGetError, dylib, "HalGetError")

	P = Platform{
		SerialWatch: darwinSerialWatch,
		SerialOpen:  darwinSerialOpen,
		SerialRead:  darwinSerialRead,
		SerialWrite: darwinSerialWrite,
		SerialClose: darwinSerialClose,

		BLEWatch:        darwinBLEWatch,
		BLEConnect:      darwinBLEConnect,
		BLEDisconnect:   darwinBLEDisconnect,
		BLERead:         darwinBLERead,
		BLEWrite:        darwinBLEWrite,
		BLESubscribe:    darwinBLESubscribe,
		BLEUnsubscribe:  darwinBLEUnsubscribe,
		BLEServices:     darwinBLEServices,
		BLEOnDisconnect: darwinBLEOnDisconnect,
	}

	if _, err := purego.Dlsym(dylib, "HalJoystickMainThread"); err != nil {
		slog.Warn("HAL dylib predates joystick support, run make hal_dylib")
		return
	}
	purego.RegisterLibFunc(&cHalJoystickList, dylib, "HalJoystickList")
	purego.RegisterLibFunc(&cHalJoystickRead, dylib, "HalJoystickRead")
	purego.RegisterLibFunc(&cHalJoystickMain, dylib, "HalJoystickMainThread")
	P.JoystickWatch = darwinJoystickWatch
	P.JoystickOpen = darwinJoystickOpen
	P.JoystickRead = darwinJoystickRead
	P.JoystickClose = darwinJoystickClose

	// The main goroutine starts out on the main thread, and only stays there if
	// it is locked during init.
	runtime.LockOSThread()
	P.MainThread = cHalJoystickMain
}

// Joystick

const (
	darwinJoystickAxes    = 8
	darwinJoystickButtons = 8
)

var (
	darwinJoystickMu      sync.Mutex
	darwinJoystickHandles = map[int64]string{}
	darwinJoystickNext    int64
)

func darwinJoysticks() []JoystickDevice {
	buf := make([]byte, 16384)
	n := cHalJoystickList(&buf[0], int32(len(buf)))
	if n <= 0 {
		return nil
	}
	var devices []JoystickDevice
	if err := json.Unmarshal(buf[:n], &devices); err != nil {
		slog.Warn("joystick list", "error", err)
		return nil
	}
	return devices
}

func darwinJoystickWatch(cb func([]JoystickDevice)) (stop func()) {
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		var last []JoystickDevice
		first := true
		for {
			devices := darwinJoysticks()
			if first || !slices.Equal(devices, last) {
				cb(devices)
				last, first = devices, false
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

func darwinJoystickOpen(id string) (int64, error) {
	if !slices.ContainsFunc(darwinJoysticks(), func(d JoystickDevice) bool { return d.ID == id }) {
		return 0, fmt.Errorf("joystick %s is not connected", id)
	}
	darwinJoystickMu.Lock()
	defer darwinJoystickMu.Unlock()
	darwinJoystickNext++
	darwinJoystickHandles[darwinJoystickNext] = id
	return darwinJoystickNext, nil
}

func darwinJoystickRead(handle int64) (JoystickState, error) {
	darwinJoystickMu.Lock()
	id, ok := darwinJoystickHandles[handle]
	darwinJoystickMu.Unlock()
	if !ok {
		return JoystickState{}, fmt.Errorf("joystick not open")
	}
	axes := make([]float32, darwinJoystickAxes)
	raw := make([]byte, darwinJoystickButtons)
	if cHalJoystickRead(id, &axes[0], &raw[0]) != 0 {
		return JoystickState{}, fmt.Errorf("joystick gone")
	}
	buttons := make([]bool, len(raw))
	for i, b := range raw {
		buttons[i] = b != 0
	}
	return JoystickState{Axes: axes, Buttons: buttons}, nil
}

func darwinJoystickClose(handle int64) error {
	darwinJoystickMu.Lock()
	delete(darwinJoystickHandles, handle)
	darwinJoystickMu.Unlock()
	return nil
}

func getHalError() error {
	buf := make([]byte, 1024)
	n := cHalGetError(&buf[0], int32(len(buf)))
	if n <= 0 {
		return fmt.Errorf("unknown HAL error")
	}
	return fmt.Errorf("%s", buf[:n])
}

// Serial

func darwinSerialWatch(cb func([]SerialPort)) (stop func()) {
	goCb := purego.NewCallback(func(ptr *byte, length int32) {
		data := unsafe.Slice(ptr, length)
		var ports []SerialPort
		if err := json.Unmarshal(data, &ports); err != nil {
			slog.Error("hal serial watch: bad json", "error", err)
			return
		}
		cb(ports)
	})
	handle := cHalSerialWatch(goCb)
	return func() { cHalStopWatch(handle) }
}

func darwinSerialOpen(path string, baudRate int) (int64, error) {
	h := cHalSerialOpen(path, int32(baudRate))
	if h == 0 {
		return 0, getHalError()
	}
	return h, nil
}

func darwinSerialRead(handle int64, maxLen int) ([]byte, error) {
	buf := make([]byte, maxLen)
	n := cHalSerialRead(handle, &buf[0], int32(len(buf)))
	if n < 0 {
		return nil, getHalError()
	}
	return buf[:n], nil
}

func darwinSerialWrite(handle int64, data []byte) (int, error) {
	if len(data) == 0 {
		return 0, nil
	}
	n := cHalSerialWrite(handle, &data[0], int32(len(data)))
	if n < 0 {
		return 0, getHalError()
	}
	return int(n), nil
}

func darwinSerialClose(handle int64) error {
	if cHalSerialClose(handle) != 0 {
		return getHalError()
	}
	return nil
}

// BLE

func darwinBLEWatch(serviceUUIDs []string, cb func([]BLEDevice)) (stop func()) {
	goCb := purego.NewCallback(func(ptr *byte, length int32) {
		data := unsafe.Slice(ptr, length)
		var devices []BLEDevice
		if err := json.Unmarshal(data, &devices); err != nil {
			slog.Error("hal ble watch: bad json", "error", err)
			return
		}
		cb(devices)
	})
	handle := cHalBleWatch(goCb)
	if handle == 0 {
		slog.Error("failed to start BLE scanning — adapter not available")
		return func() {}
	}
	return func() { cHalStopWatch(handle) }
}

func darwinBLEConnect(address string) (int64, error) {
	h := cHalBleConnect(address)
	if h == 0 {
		return 0, getHalError()
	}
	return h, nil
}

func darwinBLEOnDisconnect(handle int64, cb func()) {
	goCb := purego.NewCallback(func() { cb() })
	cHalBleOnDisconnect(handle, goCb)
}

func darwinBLEDisconnect(handle int64) error {
	if cHalBleDisconnect(handle) != 0 {
		return getHalError()
	}
	return nil
}

func darwinBLERead(handle int64, charUUID string) ([]byte, error) {
	buf := make([]byte, 512)
	n := cHalBleRead(handle, charUUID, &buf[0], int32(len(buf)))
	if n < 0 {
		return nil, getHalError()
	}
	return buf[:n], nil
}

func darwinBLEWrite(handle int64, charUUID string, data []byte) error {
	if len(data) == 0 {
		return nil
	}
	if cHalBleWrite(handle, charUUID, &data[0], int32(len(data))) != 0 {
		return getHalError()
	}
	return nil
}

func darwinBLESubscribe(handle int64, charUUID string, cb func([]byte)) error {
	goCb := purego.NewCallback(func(ptr *byte, length int32) {
		data := make([]byte, length)
		copy(data, unsafe.Slice(ptr, length))
		cb(data)
	})
	if cHalBleSubscribe(handle, charUUID, goCb) != 0 {
		return getHalError()
	}
	return nil
}

func darwinBLEUnsubscribe(handle int64, charUUID string) error {
	if cHalBleUnsubscribe(handle, charUUID) != 0 {
		return getHalError()
	}
	return nil
}

func darwinBLEServices(handle int64) ([]GATTService, error) {
	buf := make([]byte, 8192)
	n := cHalBleServices(handle, &buf[0], int32(len(buf)))
	if n < 0 {
		return nil, getHalError()
	}
	var services []GATTService
	if err := json.Unmarshal(buf[:n], &services); err != nil {
		return nil, fmt.Errorf("hal ble services: bad json: %w", err)
	}
	return services, nil
}

func findDylib() string {
	const name = "libhydris_hal.dylib"

	// Next to the executable (app bundle / installed location).
	exe, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(exe), name)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}

	// Next to the executable's real path (resolves symlinks).
	if exe != "" {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			candidate := filepath.Join(filepath.Dir(real), name)
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
		}
	}

	// In hal/macos/ relative to the executable (dev layout).
	if exe != "" {
		candidate := filepath.Join(filepath.Dir(exe), "hal", "macos", name)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}

	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return ""
}
