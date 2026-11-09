//go:build linux

package platform

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"

	"github.com/projectqai/hydris/hal"
)

func jsEvent(kind byte, number byte, value int16) []byte {
	b := make([]byte, jsEventSize)
	binary.LittleEndian.PutUint16(b[4:6], uint16(value))
	b[6], b[7] = kind, number
	return b
}

func TestJoystickEvents(t *testing.T) {
	var in bytes.Buffer
	in.Write(jsEvent(jsEventAxis|jsEventInit, 0, -32767))
	in.Write(jsEvent(jsEventAxis, 1, 32767))
	in.Write(jsEvent(jsEventAxis, 2, -32768))
	in.Write(jsEvent(jsEventButton, 1, 1))
	in.Write(jsEvent(jsEventAxis, 200, 1)) // beyond what the device reported

	d := &jsDevice{state: hal.JoystickState{Axes: make([]float32, 3), Buttons: make([]bool, 2)}}
	d.readEvents(&in)

	want := []float32{-1, 1, -1}
	for i, v := range want {
		if d.state.Axes[i] != v {
			t.Errorf("axis %d = %v, want %v", i, d.state.Axes[i], v)
		}
	}
	if d.state.Buttons[0] || !d.state.Buttons[1] {
		t.Errorf("buttons = %v", d.state.Buttons)
	}
	if d.err == nil {
		t.Error("end of the stream must report the device as gone")
	}
}

func TestJoystickIDIsURLSafe(t *testing.T) {
	id := joystickID(0x045e, 0x028e, "usb-0000:00:14.0-2/input0")
	if strings.ContainsAny(id, ":/.") || !strings.HasPrefix(id, "045e-028e-") {
		t.Errorf("id = %q", id)
	}
}
