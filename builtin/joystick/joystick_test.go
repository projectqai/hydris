package joystick

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/projectqai/hydris/hal"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func rest() hal.JoystickState {
	return hal.JoystickState{Axes: []float32{0, 0, -1, 0, 0, -1, 0, 0}, Buttons: make([]bool, 8)}
}

func down(button int) hal.JoystickState {
	st := rest()
	st.Buttons[button] = true
	return st
}

// fleet stands in for the engine and arbitrates the way it does.
type fleet struct {
	mu       sync.Mutex
	vehicles []vehicle
	holders  map[string]string
}

func newFleet(ids ...string) *fleet {
	f := &fleet{holders: map[string]string{}}
	for _, id := range ids {
		f.vehicles = append(f.vehicles, vehicle{id: id, profile: "fixed_wing"})
	}
	return f
}

func (f *fleet) list(context.Context) ([]vehicle, error) { return f.vehicles, nil }

func (f *fleet) send(_ context.Context, e *pb.Entity) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	session := e.TargetManualControl.GetSession()
	if len(e.TargetManualControl.Input) == 0 {
		if f.holders[e.Id] == session {
			delete(f.holders, e.Id)
		}
		return nil
	}
	if h := f.holders[e.Id]; h != "" && h != session {
		return status.Error(codes.FailedPrecondition, "held")
	}
	f.holders[e.Id] = session
	return nil
}

func (f *fleet) held() map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]string{}
	for k, v := range f.holders {
		out[k] = v
	}
	return out
}

type pad struct {
	mu     sync.Mutex
	states []hal.JoystickState
	err    error
	metric chan hal.JoystickState
}

func (p *pad) read() (hal.JoystickState, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.states) == 0 {
		if p.err != nil {
			return hal.JoystickState{}, p.err
		}
		return rest(), nil
	}
	st := p.states[0]
	p.states = p.states[1:]
	return st, nil
}

func (p *pad) tap(button int) {
	p.mu.Lock()
	p.states = append(p.states, rest(), down(button), rest())
	p.mu.Unlock()
}

func (p *pad) start(t *testing.T, f *fleet) {
	t.Helper()
	mappings := map[string]*mapping{}
	for name := range profiles {
		m, err := newMapping(name, 0, 0, "")
		if err != nil {
			t.Fatal(err)
		}
		mappings[name] = m
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = drive(ctx, slog.Default(), defaults, driver{
			read: p.read, mappings: mappings, vehicles: f.list, send: f.send,
			metrics: func(st hal.JoystickState) {
				if p.metric != nil {
					p.metric <- st
				}
			},
		})
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting: %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestPadSendsNothingUntilEngaged(t *testing.T) {
	f := newFleet("a")
	p := &pad{states: []hal.JoystickState{down(defaults.EngageButton), down(defaults.EngageButton)}} // held at start: no press
	p.start(t, f)
	time.Sleep(60 * time.Millisecond)
	if len(f.held()) != 0 {
		t.Errorf("sent without a press: %v", f.held())
	}
}

func TestTwoPadsTwoDrones(t *testing.T) {
	f := newFleet("a", "b")
	one, two := &pad{}, &pad{}
	one.start(t, f)
	two.start(t, f)
	one.tap(defaults.EngageButton)
	eventually(t, "first on a", func() bool { return f.held()["a"] != "" })
	two.tap(defaults.EngageButton)
	eventually(t, "second on b", func() bool { return f.held()["b"] != "" })
}

func TestEngageAgainReleasesAndReturnsToSameVehicle(t *testing.T) {
	f := newFleet("a", "b")
	p := &pad{}
	p.start(t, f)
	p.tap(defaults.EngageButton)
	eventually(t, "on a", func() bool { return f.held()["a"] != "" })
	p.tap(defaults.NextButton)
	eventually(t, "moved to b", func() bool { h := f.held(); return h["b"] != "" && h["a"] == "" })
	p.tap(defaults.EngageButton)
	eventually(t, "released", func() bool { return len(f.held()) == 0 })
	p.tap(defaults.EngageButton)
	eventually(t, "back on b", func() bool { return f.held()["b"] != "" })
}

func TestNextWrapsAndSkipsHeld(t *testing.T) {
	f := newFleet("a", "b", "c")
	f.holders["b"] = "other"
	p := &pad{}
	p.start(t, f)
	p.tap(defaults.EngageButton)
	eventually(t, "on a", func() bool { return f.held()["a"] != "" })
	p.tap(defaults.NextButton)
	eventually(t, "skipped to c", func() bool { return f.held()["c"] != "" })
	p.tap(defaults.NextButton)
	eventually(t, "wrapped to a", func() bool { return f.held()["a"] != "" && f.held()["c"] == "" })
}

func TestLosingVehicleStopsSending(t *testing.T) {
	f := newFleet("a")
	p := &pad{}
	p.start(t, f)
	p.tap(defaults.EngageButton)
	eventually(t, "on a", func() bool { return f.held()["a"] != "" })
	f.mu.Lock()
	f.holders["a"] = "usurper"
	f.mu.Unlock()
	time.Sleep(60 * time.Millisecond)
	if f.held()["a"] != "usurper" {
		t.Error("must not take it back")
	}
}

func TestUnplugReleases(t *testing.T) {
	f := newFleet("a")
	p := &pad{}
	p.start(t, f)
	p.tap(defaults.EngageButton)
	eventually(t, "on a", func() bool { return f.held()["a"] != "" })
	p.mu.Lock()
	p.err = errors.New("joystick gone")
	p.mu.Unlock()
	eventually(t, "released", func() bool { return len(f.held()) == 0 })
}

func TestMetricsWhileIdle(t *testing.T) {
	moved := rest()
	moved.Axes[0] = 0.5
	p := &pad{states: []hal.JoystickState{moved}, metric: make(chan hal.JoystickState, 16)}
	p.start(t, newFleet("a"))
	select {
	case st := <-p.metric:
		if st.Axes[0] != 0.5 {
			t.Errorf("axes = %v", st.Axes)
		}
	case <-time.After(time.Second):
		t.Fatal("no metrics")
	}
	m := axisMetrics(moved)
	if len(m) != 8 || m[0].GetLabel() != "left stick x" || m[0].GetFloat() != 0.5 {
		t.Errorf("metrics = %v", m)
	}
}

func near(a float32, b float64) bool { return math.Abs(float64(a)-b) < 1e-6 }

func TestFixedWingMapping(t *testing.T) {
	m, err := newMapping("fixed_wing", 0, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if a := m.apply(rest()); a.GetRoll() != 0 || a.GetPitch() != 0 || a.GetZoom() != 0 {
		t.Errorf("a pad at rest must command nothing: %v", a)
	}
	st := rest()
	st.Axes[0], st.Axes[1], st.Axes[5], st.Axes[7] = 1, -1, 1, -1
	a := m.apply(st)
	if !near(a.GetRoll(), 1) || !near(a.GetPitch(), 1) || !near(a.GetZoom(), 1) || !near(a.GetForward(), 1) {
		t.Errorf("axes = %v", a)
	}
}

func TestDeadzoneAndExpo(t *testing.T) {
	if shape(0.2, 0.25, 0) != 0 {
		t.Error("inside the dead zone")
	}
	if got := shape(-1, 0.25, 0.5); got != -1 {
		t.Errorf("full travel stays full travel: %v", got)
	}
	if got := shape(0.5, 0, 1); got != 0.125 {
		t.Errorf("expo: %v", got)
	}
}

func TestCustomBindings(t *testing.T) {
	m, err := newMapping("fixed_wing", 0, 0, `[{"output":"roll","axis":3,"invert":true},{"output":"forward","button":0,"scale":0.5}]`)
	if err != nil {
		t.Fatal(err)
	}
	st := rest()
	st.Axes[0], st.Axes[3] = 1, 1 // axis 0 was the profile's roll: replaced
	st.Buttons[0] = true
	if a := m.apply(st); !near(a.GetRoll(), -1) || !near(a.GetForward(), 0.5) {
		t.Errorf("axes = %v", a)
	}
	for _, bad := range []string{"not json", `[{"output":"nope","axis":1}]`, `[{"output":"pan"}]`, `[{"output":"pan","axis":1,"button":1}]`} {
		if _, err := newMapping("camera", 0, 0, bad); err == nil {
			t.Errorf("%s: expected an error", bad)
		}
	}
}

func TestAutoProfile(t *testing.T) {
	fixed := &pb.Entity{Classification: &pb.ClassificationComponent{Taxonomy: []*pb.ClassificationTaxonomy{{
		Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
			Domain: &pb.VehicleTaxonomy_Air{Air: &pb.VehicleTaxonomyAir{
				Kind: &pb.VehicleTaxonomyAir_FixedWing{FixedWing: &pb.VehicleTaxonomyAirFixedWing{}},
			}},
		}},
	}}}}
	for want, e := range map[string]*pb.Entity{"fixed_wing": fixed, "camera": {Camera: &pb.CameraComponent{}}, "multirotor": {}} {
		if got := autoProfile(e); got != want {
			t.Errorf("%s: got %s", want, got)
		}
	}
}
