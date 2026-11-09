//go:build windows

package platform

import (
	"fmt"
	"slices"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/projectqai/hydris/hal"
)

// winmm's joystick API: no cgo or redistributable, and it sees both XInput and
// DirectInput devices. Its limit for gamepads is that both triggers share an axis.

const (
	joystickWatchInterval = 2 * time.Second

	joyReturnAll   = 0xFF
	joyNoError     = 0
	joyPOVCentered = 0xFFFF
	joyAxisCentre  = 32767.5
	joyButtonCount = 32
)

var (
	winmm           = syscall.NewLazyDLL("winmm.dll")
	joyGetNumDevs   = winmm.NewProc("joyGetNumDevs")
	joyGetDevCapsW  = winmm.NewProc("joyGetDevCapsW")
	joyGetPosEx     = winmm.NewProc("joyGetPosEx")
	jsWinHandleLock sync.Mutex
	jsWinHandles    = map[int64]uint32{}
	jsWinNext       int64
)

type joyCaps struct {
	Mid, Pid               uint16
	Pname                  [32]uint16
	Xmin, Xmax, Ymin, Ymax uint32
	Zmin, Zmax             uint32
	NumButtons             uint32
	PeriodMin, PeriodMax   uint32
	Rmin, Rmax, Umin, Umax uint32
	Vmin, Vmax             uint32
	Caps, MaxAxes, NumAxes uint32
	MaxButtons             uint32
	RegKey                 [32]uint16
	OEMVxD                 [260]uint16
}

type joyInfoEx struct {
	Size, Flags                uint32
	X, Y, Z, R, U, V           uint32
	Buttons, ButtonNumber, POV uint32
	Reserved1, Reserved2       uint32
}

func joyRead(id uint32) (joyInfoEx, bool) {
	info := joyInfoEx{Flags: joyReturnAll}
	info.Size = uint32(unsafe.Sizeof(info))
	ret, _, _ := joyGetPosEx.Call(uintptr(id), uintptr(unsafe.Pointer(&info)))
	return info, ret == joyNoError
}

func scanJoysticks() []hal.JoystickDevice {
	if joyGetNumDevs.Find() != nil {
		return nil
	}
	n, _, _ := joyGetNumDevs.Call()
	var devices []hal.JoystickDevice
	for id := uint32(0); id < uint32(n); id++ {
		if _, ok := joyRead(id); !ok {
			continue
		}
		var caps joyCaps
		ret, _, _ := joyGetDevCapsW.Call(uintptr(id), uintptr(unsafe.Pointer(&caps)), unsafe.Sizeof(caps))
		if ret != joyNoError {
			continue
		}
		devices = append(devices, hal.JoystickDevice{
			ID:        fmt.Sprintf("%04x-%04x-%d", caps.Mid, caps.Pid, id),
			Name:      syscall.UTF16ToString(caps.Pname[:]),
			VendorID:  uint32(caps.Mid),
			ProductID: uint32(caps.Pid),
			Axes:      8,
			Buttons:   joyButtonCount,
		})
	}
	return devices
}

func joystickWatch(cb func([]hal.JoystickDevice)) (stop func()) {
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(joystickWatchInterval)
		defer t.Stop()
		var last []hal.JoystickDevice
		first := true
		for {
			devices := scanJoysticks()
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

func joystickOpen(id string) (int64, error) {
	for _, d := range scanJoysticks() {
		if d.ID != id {
			continue
		}
		var index uint32
		var mid, pid uint32
		if _, err := fmt.Sscanf(d.ID, "%04x-%04x-%d", &mid, &pid, &index); err != nil {
			return 0, err
		}
		jsWinHandleLock.Lock()
		defer jsWinHandleLock.Unlock()
		jsWinNext++
		jsWinHandles[jsWinNext] = index
		return jsWinNext, nil
	}
	return 0, fmt.Errorf("joystick %s is not connected", id)
}

func joystickRead(handle int64) (hal.JoystickState, error) {
	jsWinHandleLock.Lock()
	index, ok := jsWinHandles[handle]
	jsWinHandleLock.Unlock()
	if !ok {
		return hal.JoystickState{}, fmt.Errorf("joystick not open")
	}
	info, ok := joyRead(index)
	if !ok {
		return hal.JoystickState{}, fmt.Errorf("joystick gone")
	}
	return joyState(info), nil
}

func joystickClose(handle int64) error {
	jsWinHandleLock.Lock()
	delete(jsWinHandles, handle)
	jsWinHandleLock.Unlock()
	return nil
}

// joyState maps winmm's report to the common gamepad layout. XInput pads report
// the left stick on X/Y, the right on U/R, and both triggers on Z: above centre
// for the left, below for the right.
func joyState(info joyInfoEx) hal.JoystickState {
	norm := func(v uint32) float32 { return float32((float64(v) - joyAxisCentre) / joyAxisCentre) }
	trigger := norm(info.Z)
	axes := []float32{
		norm(info.X), norm(info.Y),
		max(trigger, 0)*2 - 1,
		norm(info.U), norm(info.R),
		max(-trigger, 0)*2 - 1,
		0, 0,
	}
	if info.POV != joyPOVCentered {
		switch {
		case info.POV > 31500 || info.POV < 4500: // up
			axes[7] = -1
		case info.POV > 13500 && info.POV < 22500: // down
			axes[7] = 1
		}
		switch {
		case info.POV > 4500 && info.POV < 13500: // right
			axes[6] = 1
		case info.POV > 22500 && info.POV < 31500: // left
			axes[6] = -1
		}
	}
	buttons := make([]bool, joyButtonCount)
	for i := range buttons {
		buttons[i] = info.Buttons&(1<<i) != 0
	}
	return hal.JoystickState{Axes: axes, Buttons: buttons}
}
