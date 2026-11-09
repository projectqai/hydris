// Package joystick lets a joystick or gamepad connected to this node drive a
// vehicle. Each connected device becomes a configurable entity. With no
// configuration, the engage button takes the first free vehicle and the next
// button moves on to another, so two pads end up on two vehicles.
package joystick

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/hal"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	controllerName = "joystick"
	serviceID      = controllerName + ".service"
	profileAuto    = "auto"

	frameInterval = 20 * time.Millisecond // 50 Hz, well inside a driver's link timeout
	// how often axes are published when they change, for looking at
	metricInterval = 200 * time.Millisecond
)

func init() {
	builtin.Register(controllerName, Run)
}

type config struct {
	Target       string  `json:"target"`
	Profile      string  `json:"profile"`
	EngageButton int     `json:"engage_button"`
	NextButton   int     `json:"next_button"`
	Deadzone     float64 `json:"deadzone"`
	Expo         float64 `json:"expo"`
	Bindings     string  `json:"bindings"`
}

// The dead zone is generous because worn sticks rest well off centre, and a stick
// that doesn't centre would fly the vehicle by itself. Buttons are start and back
// in the layout of hal.JoystickState.
var defaults = config{Profile: profileAuto, EngageButton: 7, NextButton: 6, Deadzone: 0.25, Expo: 0.3}

func configSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"target": map[string]any{
				"type": "string", "title": "Vehicle", "ui:order": 0,
				"description": "ID of the entity to drive. Leave empty to take the first free one.",
			},
			"profile": map[string]any{
				"type": "string", "title": "Profile", "default": profileAuto, "ui:order": 1,
				"oneOf": []any{
					map[string]any{"const": profileAuto, "title": "Automatic", "description": "Chosen from the kind of vehicle"},
					map[string]any{"const": "fixed_wing", "title": "Fixed wing", "description": "Left stick flies, right stick looks, triggers zoom, dpad sets speed"},
					map[string]any{"const": "multirotor", "title": "Multirotor", "description": "Left stick is throttle and yaw, right stick is direction"},
					map[string]any{"const": "camera", "title": "Camera", "description": "Right stick looks, triggers zoom"},
				},
			},
			"engage_button": map[string]any{
				"type": "integer", "title": "Engage Button", "default": defaults.EngageButton, "minimum": 0, "ui:order": 2,
				"description": "Press to start and stop driving. A pad sends nothing until engaged.",
			},
			"next_button": map[string]any{
				"type": "integer", "title": "Next Vehicle Button", "default": defaults.NextButton, "minimum": 0, "ui:order": 3,
				"description": "Press to move on to the next vehicle",
			},
			"deadzone": map[string]any{
				"type": "number", "title": "Dead Zone", "default": defaults.Deadzone, "minimum": 0, "maximum": 0.6, "ui:order": 4,
				"description": "Fraction of stick travel ignored around centre",
			},
			"expo": map[string]any{
				"type": "number", "title": "Expo", "default": defaults.Expo, "minimum": 0, "maximum": 1, "ui:order": 5,
				"description": "0 is linear, 1 gives the finest control near centre",
			},
			"bindings": map[string]any{
				"type": "string", "title": "Custom Bindings", "ui:widget": "textarea", "ui:order": 6,
				"description":    "JSON list replacing the profile's bindings for the outputs it names",
				"ui:placeholder": `[{"output":"roll","axis":3,"invert":true}]`,
			},
		},
	})
	return s
}

// Run publishes the service and an entity for each device that shows up.
func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	if err := controller.Push(ctx, controllerName, &pb.Entity{
		Id:            serviceID,
		Label:         proto.String("Joysticks"),
		Controller:    &pb.Controller{Id: proto.String(controllerName)},
		Device:        &pb.DeviceComponent{Category: proto.String("Vehicles"), State: pb.DeviceState_DeviceStateActive},
		Interactivity: &pb.InteractivityComponent{Icon: proto.String("gamepad-2")},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	conn, err := builtin.BuiltinClientConn(controllerName)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)

	var mu sync.Mutex
	running := map[string]bool{}
	stop := hal.WatchJoysticks(func(devices []hal.JoystickDevice) {
		mu.Lock()
		defer mu.Unlock()
		for _, d := range devices {
			if !running[d.ID] {
				running[d.ID] = true
				go func() {
					if err := runDevice(ctx, logger, client, d); err != nil && ctx.Err() == nil {
						logger.Warn("joystick: stopped", "device", d.ID, "error", err)
					}
				}()
			}
		}
	})
	defer stop()

	<-ctx.Done()
	return nil
}

// runDevice publishes a device and drives with it. The entity stays when the
// device is unplugged, so its configuration is there when it comes back; until
// then running it fails and is retried.
func runDevice(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, d hal.JoystickDevice) error {
	id := controllerName + ".discovered." + d.ID
	entity := &pb.Entity{
		Id:            id,
		Label:         proto.String(d.Name),
		Controller:    &pb.Controller{Id: proto.String(controllerName)},
		Device:        &pb.DeviceComponent{Parent: proto.String(serviceID), Class: proto.String("joystick"), State: pb.DeviceState_DeviceStateActive},
		Configurable:  &pb.ConfigurableComponent{Schema: configSchema()},
		Interactivity: &pb.InteractivityComponent{Icon: proto.String("gamepad-2")},
	}
	// Only a device seen for the first time gets defaults.
	if existing, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: id}); err != nil || existing.GetEntity().GetConfig() == nil {
		value, _ := structpb.NewStruct(map[string]any{
			"profile": defaults.Profile, "engage_button": float64(defaults.EngageButton), "next_button": float64(defaults.NextButton),
			"deadzone": defaults.Deadzone, "expo": defaults.Expo,
		})
		entity.Config = &pb.ConfigurationComponent{Value: value, Version: 1}
	}
	if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{entity}}); err != nil {
		return fmt.Errorf("push device: %w", err)
	}

	return controller.Run(ctx, controllerName, id, func(ctx context.Context, e *pb.Entity, ready func()) error {
		cfg := defaults
		if e.GetConfig().GetValue() != nil {
			b, err := e.Config.Value.MarshalJSON()
			if err != nil {
				return err
			}
			if err := json.Unmarshal(b, &cfg); err != nil {
				return fmt.Errorf("parse config: %w", err)
			}
		}
		mappings := map[string]*mapping{}
		for name := range profiles {
			m, err := newMapping(name, cfg.Deadzone, cfg.Expo, cfg.Bindings)
			if err != nil {
				return err
			}
			mappings[name] = m
		}
		if cfg.Profile != profileAuto && mappings[cfg.Profile] == nil {
			return fmt.Errorf("unknown profile %q", cfg.Profile)
		}
		pad, err := hal.OpenJoystick(d.ID)
		if err != nil {
			return err
		}
		defer func() { _ = pad.Close() }()
		ready()

		return drive(ctx, logger, cfg, driver{
			read:     pad.Read,
			mappings: mappings,
			vehicles: func(ctx context.Context) ([]vehicle, error) { return listVehicles(ctx, client, cfg.Target) },
			send: func(ctx context.Context, frame *pb.Entity) error {
				_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{frame}})
				return err
			},
			metrics: func(st hal.JoystickState) {
				_, _ = client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{{Id: id, Metric: &pb.MetricComponent{Metrics: axisMetrics(st)}}}})
			},
		})
	})
}

var axisNames = []string{"left stick x", "left stick y", "left trigger", "right stick x", "right stick y", "right trigger", "dpad x", "dpad y"}

func axisMetrics(st hal.JoystickState) []*pb.Metric {
	metrics := make([]*pb.Metric, len(st.Axes))
	for i, v := range st.Axes {
		label := fmt.Sprintf("axis %d", i)
		if i < len(axisNames) {
			label = axisNames[i]
		}
		metrics[i] = &pb.Metric{Label: &label, Id: proto.Uint32(uint32(i + 1)), Val: &pb.Metric_Float{Float: v}}
	}
	return metrics
}

// vehicle is something a pad can drive.
type vehicle struct {
	id, profile string
	camera      bool
}

// listVehicles returns what a pad can drive, vehicles before cameras, since
// flying is what a pad is usually picked up for.
func listVehicles(ctx context.Context, client pb.WorldServiceClient, pinned string) ([]vehicle, error) {
	filter := &pb.EntityFilter{Component: []uint32{uint32(pb.EntityComponent_EntityComponentManualControl)}}
	if pinned != "" {
		filter.Id = &pinned
	}
	resp, err := client.ListEntities(ctx, &pb.ListEntitiesRequest{Filter: filter})
	if err != nil {
		return nil, err
	}
	list := make([]vehicle, 0, len(resp.Entities))
	for _, e := range resp.Entities {
		list = append(list, vehicle{id: e.Id, profile: autoProfile(e), camera: e.Camera != nil})
	}
	slices.SortFunc(list, func(a, b vehicle) int {
		if a.camera != b.camera {
			if b.camera {
				return -1
			}
			return 1
		}
		return strings.Compare(a.id, b.id)
	})
	return list, nil
}

// autoProfile picks the stick layout that suits a kind of vehicle.
func autoProfile(e *pb.Entity) string {
	if e.Camera != nil {
		return "camera"
	}
	for _, t := range e.GetClassification().GetTaxonomy() {
		if t.GetVehicle().GetAir().GetFixedWing() != nil {
			return "fixed_wing"
		}
	}
	return "multirotor"
}

type driver struct {
	read     func() (hal.JoystickState, error)
	mappings map[string]*mapping
	vehicles func(context.Context) ([]vehicle, error)
	send     func(context.Context, *pb.Entity) error
	metrics  func(hal.JoystickState)
}

// from lists the vehicles to try, starting with the one with this id if it's
// there, wrapping around.
func from(list []vehicle, id string) []vehicle {
	start := slices.IndexFunc(list, func(v vehicle) bool { return v.id == id })
	if start < 0 {
		start = 0
	}
	return append(slices.Clone(list[start:]), list[:start]...)
}

// drive runs one device until it fails or ctx ends. Sending waits for each frame
// to be accepted, so a slow path lowers the rate instead of building a queue.
func drive(ctx context.Context, logger *slog.Logger, cfg config, d driver) error {
	tick := time.NewTicker(frameInterval)
	defer tick.Stop()

	var (
		session   string  // non-empty while engaged
		current   vehicle // what is being driven, or was last
		engageWas bool
		nextWas   bool
		first     = true
		published []float32
		lastPub   time.Time
	)
	mappingFor := func(v vehicle) *mapping {
		if m := d.mappings[cfg.Profile]; m != nil {
			return m
		}
		if m := d.mappings[v.profile]; m != nil {
			return m
		}
		return d.mappings["multirotor"]
	}
	release := func() {
		if session != "" {
			// Not ctx: the release should get out even during shutdown.
			rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
			defer cancel()
			_ = d.send(rctx, &pb.Entity{Id: current.id, TargetManualControl: &pb.TargetManualControlComponent{Session: &session}})
			session = ""
		}
	}
	defer release()

	// engage takes the first vehicle in the list that accepts a frame.
	engage := func(st hal.JoystickState, pick func([]vehicle) []vehicle) {
		list, err := d.vehicles(ctx)
		if err != nil {
			logger.Warn("joystick: list vehicles", "error", err)
			return
		}
		for _, v := range pick(list) {
			s := newSession()
			if err := d.send(ctx, frame(v.id, s, mappingFor(v).apply(st))); err != nil {
				logger.Info("joystick: can't take vehicle", "vehicle", v.id, "reason", err)
				continue
			}
			session, current = s, v
			logger.Info("joystick: driving", "vehicle", v.id)
			return
		}
		logger.Warn("joystick: no vehicle available to drive")
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
		st, err := d.read()
		if err != nil {
			return err
		}

		if !slices.Equal(st.Axes, published) && time.Since(lastPub) >= metricInterval {
			published, lastPub = st.Axes, time.Now()
			d.metrics(st)
		}

		pressed := func(button int, was *bool) bool {
			down := button >= 0 && button < len(st.Buttons) && st.Buttons[button]
			// A button already down when we start isn't a press.
			press := down && !*was && !first
			*was = down
			return press
		}
		engagePress, nextPress := pressed(cfg.EngageButton, &engageWas), pressed(cfg.NextButton, &nextWas)
		first = false

		switch {
		case engagePress && session != "":
			release()
			logger.Info("joystick: released", "vehicle", current.id)
		case engagePress:
			// Back to the vehicle it had, if any.
			engage(st, func(l []vehicle) []vehicle { return from(l, current.id) })
		case nextPress && session != "":
			was := current.id
			release()
			engage(st, func(l []vehicle) []vehicle {
				rest := from(l, was)
				if len(rest) > 0 && rest[0].id == was {
					rest = append(rest[1:], rest[0]) // the one we left only if nothing else is free
				}
				return rest
			})
		case session != "":
			if err := d.send(ctx, frame(current.id, session, mappingFor(current).apply(st))); err != nil && ctx.Err() == nil {
				// Lost it: the operator decides what next. Retrying would grab it
				// the moment it frees up, which they may no longer want.
				logger.Warn("joystick: lost vehicle", "vehicle", current.id, "reason", err)
				session = ""
			}
		}
	}
}

func frame(target, session string, axes *pb.ManualControlAxes) *pb.Entity {
	return &pb.Entity{Id: target, TargetManualControl: &pb.TargetManualControlComponent{
		Session: &session,
		Input:   []*pb.ManualControlInput{{Axes: axes}},
	}}
}

func newSession() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
