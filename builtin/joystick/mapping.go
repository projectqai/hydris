package joystick

import (
	"encoding/json"
	"fmt"
	"math"
	"slices"

	"github.com/projectqai/hydris/hal"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// binding feeds one input into one output. Several on an output add up.
type binding struct {
	Output string `json:"output"`
	// exactly one of these selects the input
	Axis   *int `json:"axis,omitempty"`
	Button *int `json:"button,omitempty"`
	// Trigger is for inputs resting at -1: it maps them to 0 at rest, 1 fully in.
	Trigger bool    `json:"trigger,omitempty"`
	Invert  bool    `json:"invert,omitempty"`
	Scale   float64 `json:"scale,omitempty"` // 1 if unset
}

var outputs = []string{"forward", "right", "up", "yaw", "pitch", "roll", "pan", "tilt", "zoom"}

func stick(output string, axis int, invert bool, scale float64) binding {
	return binding{Output: output, Axis: &axis, Invert: invert, Scale: scale}
}

func trigger(output string, axis int, invert bool) binding {
	return binding{Output: output, Axis: &axis, Trigger: true, Invert: invert}
}

// Axes as in hal.JoystickState: 0/1 left stick, 2 left trigger, 3/4 right stick,
// 5 right trigger, 6/7 dpad. Sticks report up as negative, so they are inverted
// to make up positive.
var profiles = map[string][]binding{
	// Left stick flies, right stick looks, triggers zoom, dpad sets speed.
	"fixed_wing": {
		stick("roll", 0, false, 0), stick("pitch", 1, true, 0),
		stick("pan", 3, false, 0), stick("tilt", 4, true, 0),
		trigger("zoom", 5, false), trigger("zoom", 2, true),
		stick("forward", 7, true, 0),
	},
	// The usual mode 2 sticks: left is throttle and yaw, right is direction.
	"multirotor": {
		stick("yaw", 0, false, 0), stick("up", 1, true, 0),
		stick("right", 3, false, 0), stick("forward", 4, true, 0),
	},
	// Right stick looks, triggers zoom, left stick moves sideways where it can.
	// Zoom is on forward, which every camera driver understands.
	"camera": {
		stick("pan", 3, false, 3), stick("tilt", 4, true, 3),
		trigger("forward", 5, false), trigger("forward", 2, true),
		stick("right", 0, false, 0),
	},
}

type mapping struct {
	bindings       []binding
	deadzone, expo float64
}

// newMapping builds a profile's mapping. Custom bindings, as JSON, replace the
// profile's bindings of the outputs they name.
func newMapping(profile string, deadzone, expo float64, custom string) (*mapping, error) {
	base, ok := profiles[profile]
	if !ok {
		return nil, fmt.Errorf("unknown profile %q", profile)
	}
	m := &mapping{deadzone: deadzone, expo: expo}
	if custom != "" {
		if err := json.Unmarshal([]byte(custom), &m.bindings); err != nil {
			return nil, fmt.Errorf("bindings: %w", err)
		}
	}
	replaced := map[string]bool{}
	for _, b := range m.bindings {
		if !slices.Contains(outputs, b.Output) {
			return nil, fmt.Errorf("unknown output %q", b.Output)
		}
		if (b.Axis == nil) == (b.Button == nil) {
			return nil, fmt.Errorf("binding for %s needs exactly one of axis or button", b.Output)
		}
		replaced[b.Output] = true
	}
	for _, b := range base {
		if !replaced[b.Output] {
			m.bindings = append(m.bindings, b)
		}
	}
	return m, nil
}

func (m *mapping) value(b binding, st hal.JoystickState) float64 {
	var v float64
	switch {
	case b.Button != nil:
		if *b.Button >= 0 && *b.Button < len(st.Buttons) && st.Buttons[*b.Button] {
			v = 1
		}
	case *b.Axis >= 0 && *b.Axis < len(st.Axes):
		v = float64(st.Axes[*b.Axis])
		if b.Trigger {
			v = (v + 1) / 2
		}
		v = shape(v, m.deadzone, m.expo)
	}
	if b.Invert {
		v = -v
	}
	if b.Scale != 0 {
		v *= b.Scale
	}
	return v
}

// shape applies the dead zone, rescaled so the output still starts from zero and
// reaches full travel, then the expo curve.
func shape(v, deadzone, expo float64) float64 {
	mag := math.Abs(v)
	if mag <= deadzone {
		return 0
	}
	mag = math.Min((mag-deadzone)/(1-deadzone), 1)
	return math.Copysign((1-expo)*mag+expo*mag*mag*mag, v)
}

func (m *mapping) apply(st hal.JoystickState) *pb.ManualControlAxes {
	sum := map[string]float64{}
	for _, b := range m.bindings {
		sum[b.Output] += m.value(b, st)
	}
	get := func(name string) *float32 { return proto.Float32(float32(sum[name])) }
	return &pb.ManualControlAxes{
		Forward: get("forward"), Right: get("right"), Up: get("up"),
		Yaw: get("yaw"), Pitch: get("pitch"), Roll: get("roll"),
		Pan: get("pan"), Tilt: get("tilt"), Zoom: get("zoom"),
	}
}
