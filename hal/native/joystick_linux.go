//go:build linux

package platform

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/projectqai/hydris/hal"
)

// The kernel's joystick API, /dev/input/js*. Unlike evdev it needs no mapping of
// event codes, and desktop distributions give the seated user access to it.

const (
	joystickWatchInterval = 2 * time.Second

	jsEventButton = 0x01
	jsEventAxis   = 0x02
	jsEventInit   = 0x80
	jsEventSize   = 8

	jsiocgAxes    = 0x80016a11
	jsiocgButtons = 0x80016a12
)

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

func scanJoysticks() []hal.JoystickDevice {
	paths, _ := filepath.Glob("/dev/input/js*")
	slices.Sort(paths)
	var devices []hal.JoystickDevice
	for _, path := range paths {
		f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
		if err != nil {
			continue
		}
		axes, buttons := jsCounts(f)
		_ = f.Close()
		devices = append(devices, describeJoystick(path, axes, buttons))
	}
	return devices
}

func jsCounts(f *os.File) (axes, buttons int) {
	var a, b uint8
	_, _, _ = syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), jsiocgAxes, uintptr(unsafe.Pointer(&a)))
	_, _, _ = syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), jsiocgButtons, uintptr(unsafe.Pointer(&b)))
	return int(a), int(b)
}

func describeJoystick(path string, axes, buttons int) hal.JoystickDevice {
	node := filepath.Base(path)
	sys := filepath.Join("/sys/class/input", node, "device")
	read := func(rel string) string {
		b, _ := os.ReadFile(filepath.Join(sys, rel))
		return strings.TrimSpace(string(b))
	}
	hex := func(rel string) uint32 {
		v, _ := strconv.ParseUint(read(rel), 16, 32)
		return uint32(v)
	}
	d := hal.JoystickDevice{
		Name:      read("name"),
		VendorID:  hex("id/vendor"),
		ProductID: hex("id/product"),
		Axes:      axes,
		Buttons:   buttons,
	}
	if d.Name == "" {
		d.Name = node
	}
	// Serial number if it has one, else the port it is plugged into, so two
	// identical pads stay apart and each keeps its configuration.
	where := read("uniq")
	if where == "" {
		where = read("phys")
	}
	if where == "" {
		where = node
	}
	d.ID = joystickID(d.VendorID, d.ProductID, where)
	return d
}

func joystickID(vendor, product uint32, where string) string {
	clean := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			return r
		}
		return '-'
	}, where)
	return fmt.Sprintf("%04x-%04x-%s", vendor, product, clean)
}

type jsDevice struct {
	file *os.File

	mu    sync.Mutex
	state hal.JoystickState
	err   error
}

// readEvents applies events to the state until the reader fails. A trailing
// partial event can't happen on this device: the kernel delivers whole ones.
func (d *jsDevice) readEvents(r io.Reader) {
	buf := make([]byte, jsEventSize)
	for {
		if _, err := io.ReadFull(r, buf); err != nil {
			d.mu.Lock()
			d.err = fmt.Errorf("joystick gone: %w", err)
			d.mu.Unlock()
			return
		}
		value := int16(binary.LittleEndian.Uint16(buf[4:6]))
		kind := buf[6] &^ jsEventInit
		number := int(buf[7])

		d.mu.Lock()
		switch kind {
		case jsEventAxis:
			if number < len(d.state.Axes) {
				d.state.Axes[number] = max(float32(value)/32767, -1)
			}
		case jsEventButton:
			if number < len(d.state.Buttons) {
				d.state.Buttons[number] = value != 0
			}
		}
		d.mu.Unlock()
	}
}

var (
	jsMu      sync.Mutex
	jsHandles = map[int64]*jsDevice{}
	jsNext    int64
)

func joystickOpen(id string) (int64, error) {
	paths, _ := filepath.Glob("/dev/input/js*")
	for _, path := range paths {
		f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
		if err != nil {
			continue
		}
		axes, buttons := jsCounts(f)
		if describeJoystick(path, axes, buttons).ID != id {
			_ = f.Close()
			continue
		}
		d := &jsDevice{file: f, state: hal.JoystickState{Axes: make([]float32, axes), Buttons: make([]bool, buttons)}}
		go d.readEvents(f)
		jsMu.Lock()
		jsNext++
		h := jsNext
		jsHandles[h] = d
		jsMu.Unlock()
		return h, nil
	}
	return 0, fmt.Errorf("joystick %s is not connected", id)
}

func joystickRead(handle int64) (hal.JoystickState, error) {
	jsMu.Lock()
	d := jsHandles[handle]
	jsMu.Unlock()
	if d == nil {
		return hal.JoystickState{}, errors.New("joystick not open")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.err != nil {
		return hal.JoystickState{}, d.err
	}
	return hal.JoystickState{Axes: slices.Clone(d.state.Axes), Buttons: slices.Clone(d.state.Buttons)}, nil
}

func joystickClose(handle int64) error {
	jsMu.Lock()
	d := jsHandles[handle]
	delete(jsHandles, handle)
	jsMu.Unlock()
	if d == nil {
		return nil
	}
	return d.file.Close()
}
