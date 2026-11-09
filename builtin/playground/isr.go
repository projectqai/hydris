package playground

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// ISR simulator: a fixed-wing drone loiters over flat Flevoland farmland
// with a stabilised simcam gimbal staring at the orbit centre. It can be
// tasked to fly to any position, swinging there like a fixed wing, and
// reports full telemetry. Vehicles and people come from a global
// pseudo-random grid, so the camera finds the same targets at the same
// places wherever it looks.

const (
	isrDeviceID = controllerName + ".discovered.isr"

	// home orbit over the flat polders of Flevoland
	isrHomeLat = 52.4875
	isrHomeLon = 5.5850

	// pose rate: the camera's effective motion frame rate
	isrPoseInterval      = 50 * time.Millisecond
	isrTargetInterval    = 200 * time.Millisecond
	isrTelemetryInterval = time.Second

	// within this distance the gimbal stares at the orbit centre; beyond
	// it, in transit, it looks ahead and down along the flight path
	gimbalStareRangeM  = 1500.0
	transitLookDownDeg = 30.0
	// zoom never goes tighter than this slant range would give, so distant
	// stares stay wide enough to search
	gimbalMaxZoomRangeM = 900.0
	// on station once within this fraction of the orbit radius
	arrivalTolerance = 0.25

	// gimbal under manual control: rates at full stick
	manualPanRateDeg    = 45.0
	manualTiltRateDeg   = 30.0
	manualZoomRate      = 1.0 // slant range changes by e per second
	manualTiltLimitDeg  = 5.0 // never looks closer to the horizon than this
	manualMinZoomRangeM = 60.0
	manualMaxZoomRangeM = 4000.0
)

// isrConfigLimits bounds the aircraft under manual control, the same bounds the
// configuration accepts.
type isrConfigLimits struct{ minSpeed, maxSpeed, minAlt, maxAlt float64 }

var isrLimits = isrConfigLimits{minSpeed: 12, maxSpeed: 60, minAlt: 30, maxAlt: 3000}

type isrConfig struct {
	OrbitRadiusM float64 `json:"orbit_radius_m"`
	AltitudeM    float64 `json:"altitude_m"`
	SpeedMs      float64 `json:"speed_ms"`
}

func isrSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"orbit_radius_m": map[string]any{
				"type": "number", "title": "Orbit Radius (m)",
				"default": 600, "minimum": 150, "maximum": 3000, "ui:order": 0,
			},
			"altitude_m": map[string]any{
				"type": "number", "title": "Altitude (m)",
				"default": 250, "minimum": 30, "maximum": 3000, "ui:order": 1,
			},
			"speed_ms": map[string]any{
				"type": "number", "title": "Airspeed (m/s)",
				"default": 25, "minimum": 12, "maximum": 60, "ui:order": 2,
			},
		},
	})
	return s
}

// isrDevice is the child device the service toggle creates.
func isrDevice() *pb.Entity {
	cfg, _ := structpb.NewStruct(map[string]any{
		"orbit_radius_m": 600.0,
		"altitude_m":     250.0,
		"speed_ms":       25.0,
	})
	return &pb.Entity{
		Id:         isrDeviceID,
		Label:      proto.String("ISR Drone Simulator"),
		Routing:    &pb.Routing{Channels: []*pb.Channel{{}}},
		Controller: &pb.Controller{Id: proto.String(controllerName)},
		Device: &pb.DeviceComponent{
			Parent:   proto.String(controllerName + ".service"),
			Class:    proto.String("isr"),
			Category: proto.String("Missions"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Geo:          &pb.GeoSpatialComponent{Latitude: isrHomeLat, Longitude: isrHomeLon},
		Configurable: &pb.ConfigurableComponent{Schema: isrSchema()},
		Config:       &pb.ConfigurationComponent{Value: cfg, Version: 1},
	}
}

type isrIDs struct {
	parent, drone, camera, task, gcs string
}

func newISRIDs(parent string) isrIDs {
	drone := parent + ".drone"
	return isrIDs{
		parent: parent,
		drone:  drone,
		camera: parent + ".camera",
		task:   drone + ".goto",
		gcs:    parent + ".gcs",
	}
}

func runISR(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg := isrConfig{OrbitRadiusM: 600, AltitudeM: 250, SpeedMs: 25}
	if entity.Config != nil && entity.Config.Value != nil {
		b, _ := entity.Config.Value.MarshalJSON()
		_ = json.Unmarshal(b, &cfg)
	}
	cfg.OrbitRadiusM = clampF(cfg.OrbitRadiusM, 150, 3000)
	cfg.AltitudeM = clampF(cfg.AltitudeM, 30, 3000)
	cfg.SpeedMs = clampF(cfg.SpeedMs, 12, 60)
	homeLat, homeLon := isrHomeLat, isrHomeLon
	if g := entity.Geo; g != nil && (g.Latitude != 0 || g.Longitude != 0) {
		homeLat, homeLon = g.Latitude, g.Longitude
	}

	conn, err := builtin.BuiltinClientConn(controllerName)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)
	ids := newISRIDs(entity.Id)

	// Sprites first: simcam briefly caches failed loads, so they must exist
	// before any target references them.
	spriteIDs, err := uploadISRSprites(ctx, client, ids.parent)
	if err != nil {
		logger.Warn("isr: upload sprites", "error", err)
	}

	now := time.Now()
	centreLat, centreLon := homeLat, homeLon
	fw := newOrbiting(centreLat, centreLon, cfg.OrbitRadiusM, cfg.AltitudeM, cfg.SpeedMs)
	// the ground station stands off the orbit, out of the camera's stare
	gcsLat, gcsLon := enuOffset(homeLat, homeLon, -1100, -1100)
	tel := newTelemetry(now, gcsLat, gcsLon)
	field := newTargetField(ids.parent)

	nav := isrNavigation(fw, centreLat, centreLon, cfg, false)
	if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{
		gcsEntity(ids, gcsLat, gcsLon),
		tel.fullEntity(ids.drone, ids.parent, ids.gcs, fw, nav, now),
		isrCameraEntity(ids, fw),
		gotoTaskable(ids),
	}}); err != nil {
		return fmt.Errorf("push drone: %w", err)
	}
	ready()
	logger.Info("isr: drone airborne", "orbit", fmt.Sprintf("%.4f,%.4f", centreLat, centreLon),
		"radius_m", cfg.OrbitRadiusM, "altitude_m", cfg.AltitudeM, "speed_ms", cfg.SpeedMs)

	defer func() {
		expCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		all := append([]string{ids.camera, ids.drone, ids.task, ids.gcs}, field.ids()...)
		for _, id := range append(all, spriteIDs...) {
			_, _ = client.ExpireEntity(expCtx, &pb.ExpireEntityRequest{Id: id})
		}
	}()

	tasks := make(chan [2]float64, 1)
	go watchGotoTask(ctx, logger, client, ids.task, tasks)
	tasked, taskActive := false, false

	input := controller.WatchManualControl(ctx, logger, client, ids.drone, nil)
	altTarget := cfg.AltitudeM
	var pilot manualPilot

	tick := time.NewTicker(isrPoseInterval)
	defer tick.Stop()
	last := now
	var lastTargets, lastTelemetry time.Time
	for {
		select {
		case <-ctx.Done():
			return nil
		case dest := <-tasks:
			centreLat, centreLon = dest[0], dest[1]
			tasked, taskActive = true, true
			pilot.overridden = input.Axes() != nil
			altTarget = cfg.AltitudeM
			pushExecState(ctx, client, ids.task, pb.TaskExecutionState_TaskExecutionStateRunning, "")
			logger.Info("isr: tasked", "lat", centreLat, "lon", centreLon)
			continue
		case now = <-tick.C:
		}
		dt := math.Min(now.Sub(last).Seconds(), 0.2)
		last = now

		axes := pilot.command(input.Axes())
		if axes != nil {
			if !pilot.flying {
				logger.Info("isr: under manual control")
				pilot.takeOver(fw, centreLat, centreLon)
			}
			fw.stepManual(dt, float64(axes.GetRoll()), float64(axes.GetPitch()), float64(axes.GetForward()), isrLimits)
			pilot.moveGimbal(axes, dt)
		} else {
			if pilot.flying {
				// Operator let go, or the link is lost: hold here.
				logger.Info("isr: manual control ended, loitering")
				pilot.flying = false
				if !pilot.overridden {
					centreLat, centreLon = fw.orbitAhead(cfg.OrbitRadiusM)
					altTarget = fw.alt
					tasked = false
				}
			}
			fw.step(dt, centreLat, centreLon, cfg.OrbitRadiusM, altTarget)
		}
		tel.step(fw, dt)
		nav = isrNavigation(fw, centreLat, centreLon, cfg, tasked)
		if pilot.flying {
			nav.mode = pb.NavigationMode_NavigationModeUnderway
			nav.tasked = false
		}
		if taskActive && nav.mode == pb.NavigationMode_NavigationModeLoitering {
			taskActive = false
			pushExecState(ctx, client, ids.task, pb.TaskExecutionState_TaskExecutionStateCompleted, "on station")
			logger.Info("isr: on station", "lat", centreLat, "lon", centreLon)
		}

		aim, lookLat, lookLon := gimbalAim(ids.camera, fw, centreLat, centreLon)
		if pilot.flying {
			aim, lookLat, lookLon = pilot.aim(ids.camera, fw)
		}
		changes := []*pb.Entity{poseEntity(ids.drone, fw), cameraMount(ids, fw), aim}

		if now.Sub(lastTargets) >= isrTargetInterval {
			lastTargets = now
			push, expire := field.update(now, lookLat, lookLon)
			changes = append(changes, push...)
			for _, id := range expire {
				_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id})
			}
		}
		if now.Sub(lastTelemetry) >= isrTelemetryInterval {
			lastTelemetry = now
			changes = append(changes, tel.fullEntity(ids.drone, ids.parent, ids.gcs, fw, nav, now))
		}
		if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: changes}); err != nil && ctx.Err() == nil {
			logger.Warn("isr: push", "error", err)
		}
	}
}

// manualPilot is the state of the aircraft while an operator flies it.
type manualPilot struct {
	flying bool
	// a task arrived during manual flight. The task wins: the stick is ignored
	// until the operator lets go, so frames still in flight can't undo it.
	overridden bool

	// the gimbal holds these, independent of where the aircraft turns
	bearingDeg, elevationDeg, rangeM float64
}

// command filters the operator's input by whether it currently has authority.
func (p *manualPilot) command(axes *pb.ManualControlAxes) *pb.ManualControlAxes {
	if axes == nil {
		p.overridden = false
		return nil
	}
	if p.overridden {
		return nil
	}
	return axes
}

// takeOver starts manual flight with the gimbal where it is already looking.
func (p *manualPilot) takeOver(fw *fixedWing, cLat, cLon float64) {
	p.flying = true
	e, n := enuDelta(fw.lat, fw.lon, cLat, cLon)
	d := math.Hypot(e, n)
	if d < gimbalStareRangeM {
		p.bearingDeg = math.Atan2(e, n) * 180 / math.Pi
		p.elevationDeg = -math.Atan2(fw.alt, d) * 180 / math.Pi
		p.rangeM = math.Min(math.Hypot(d, fw.alt), gimbalMaxZoomRangeM)
		return
	}
	p.bearingDeg = fw.headingDeg()
	p.elevationDeg = -transitLookDownDeg
	p.rangeM = fw.alt / math.Sin(transitLookDownDeg*math.Pi/180)
}

func (p *manualPilot) moveGimbal(axes *pb.ManualControlAxes, dt float64) {
	p.bearingDeg = math.Mod(p.bearingDeg+float64(axes.GetPan())*manualPanRateDeg*dt+360, 360)
	p.elevationDeg = clampF(p.elevationDeg+float64(axes.GetTilt())*manualTiltRateDeg*dt, -89, -manualTiltLimitDeg)
	p.rangeM = clampF(p.rangeM*math.Exp(-float64(axes.GetZoom())*manualZoomRate*dt), manualMinZoomRangeM, manualMaxZoomRangeM)
}

// aim is gimbalAim for manual flight. It returns the ground point the camera
// looks at, so the camera finds targets wherever the operator points it.
func (p *manualPilot) aim(cameraID string, fw *fixedWing) (aim *pb.Entity, lookLat, lookLon float64) {
	ground := fw.alt / math.Tan(-p.elevationDeg*math.Pi/180)
	s, c := math.Sincos(p.bearingDeg * math.Pi / 180)
	lookLat, lookLon = enuOffset(fw.lat, fw.lon, s*ground, c*ground)
	rel := math.Mod(p.bearingDeg-fw.headingDeg()+720, 360)
	elev, rng := p.elevationDeg, p.rangeM
	return &pb.Entity{
		Id: cameraID + "~fp",
		TargetPose: &pb.TargetPoseComponent{Offset: &pb.TargetPoseComponent_Polar{Polar: &pb.PolarOffset{
			Azimuth: rel, Elevation: &elev, Range: &rng,
		}}},
	}, lookLat, lookLon
}

// isrNavigation derives the navigation mode: loitering once established
// near the orbit, guided while flying to a tasked position.
func isrNavigation(fw *fixedWing, cLat, cLon float64, cfg isrConfig, tasked bool) navState {
	e, n := enuDelta(cLat, cLon, fw.lat, fw.lon)
	d := math.Hypot(e, n)
	nav := navState{
		mode:      pb.NavigationMode_NavigationModeLoitering,
		tasked:    tasked,
		centreLat: cLat, centreLon: cLon,
		distanceM: d, radius: cfg.OrbitRadiusM,
	}
	if math.Abs(d-cfg.OrbitRadiusM) > arrivalTolerance*cfg.OrbitRadiusM {
		nav.mode = pb.NavigationMode_NavigationModeGuided
		nav.arrivalSeconds = math.Max(d-cfg.OrbitRadiusM, 0) / fw.speed
	}
	return nav
}

// gimbalAim points the camera at the orbit centre, or ahead and down while
// transiting, and returns the ground point it looks at. The azimuth is
// relative to the drone's heading, as the pose transform expects.
func gimbalAim(cameraID string, fw *fixedWing, cLat, cLon float64) (aim *pb.Entity, lookLat, lookLon float64) {
	e, n := enuDelta(fw.lat, fw.lon, cLat, cLon)
	d := math.Hypot(e, n)
	var az, elev, rng float64
	if d < gimbalStareRangeM {
		az = math.Atan2(e, n) * 180 / math.Pi
		elev = -math.Atan2(fw.alt, d) * 180 / math.Pi
		rng = math.Min(math.Hypot(d, fw.alt), gimbalMaxZoomRangeM)
		lookLat, lookLon = cLat, cLon
	} else {
		az = fw.headingDeg()
		elev = -transitLookDownDeg
		ground := fw.alt / math.Tan(transitLookDownDeg*math.Pi/180)
		rng = fw.alt / math.Sin(transitLookDownDeg*math.Pi/180)
		s, c := math.Sincos(fw.heading)
		lookLat, lookLon = enuOffset(fw.lat, fw.lon, s*ground, c*ground)
	}
	rel := math.Mod(az-fw.headingDeg()+720, 360)
	return &pb.Entity{
		Id: cameraID + "~fp",
		TargetPose: &pb.TargetPoseComponent{Offset: &pb.TargetPoseComponent_Polar{Polar: &pb.PolarOffset{
			Azimuth: rel, Elevation: &elev, Range: &rng,
		}}},
	}, lookLat, lookLon
}

// cameraMount hangs the camera under the drone on a stabilised mount.
func cameraMount(ids isrIDs, fw *fixedWing) *pb.Entity {
	return &pb.Entity{
		Id: ids.camera,
		Pose: &pb.PoseComponent{
			Parent: ids.drone,
			Offset: &pb.PoseComponent_Cartesian{Cartesian: &pb.CartesianOffset{
				UpM:         proto.Float64(-0.3),
				Orientation: fw.gimbalStabilisation().proto(),
			}},
		},
	}
}

func isrCameraEntity(ids isrIDs, fw *fixedWing) *pb.Entity {
	cfg, _ := structpb.NewStruct(map[string]any{
		"fov_wide":  30.0,
		"fov_tele":  3.0,
		"range_max": 2000.0,
	})
	e := cameraMount(ids, fw)
	e.Label = proto.String("ISR1 Camera")
	e.Routing = &pb.Routing{Channels: []*pb.Channel{{}}}
	e.Controller = &pb.Controller{Id: proto.String(controllerName)}
	e.Device = &pb.DeviceComponent{
		Parent: proto.String(simcamServiceID),
		Class:  proto.String("camera"),
		State:  pb.DeviceState_DeviceStateActive,
	}
	e.Config = &pb.ConfigurationComponent{Value: cfg}
	e.Assembly = &pb.AssemblyComponent{Parent: proto.String(ids.drone)}
	return e
}

func gcsEntity(ids isrIDs, lat, lon float64) *pb.Entity {
	return &pb.Entity{
		Id:            ids.gcs,
		Label:         proto.String("ISR Ground Station"),
		Controller:    &pb.Controller{Id: proto.String(controllerName)},
		Device:        &pb.DeviceComponent{Parent: proto.String(ids.parent), State: pb.DeviceState_DeviceStateActive},
		Symbol:        &pb.SymbolComponent{MilStd2525C: "SFGPUUS--------"},
		Geo:           &pb.GeoSpatialComponent{Latitude: lat, Longitude: lon, Altitude: proto.Float64(0)},
		Interactivity: &pb.InteractivityComponent{Icon: proto.String("radio-tower")},
	}
}

// -- tasking ------------------------------------------------------------------

func gotoTaskable(ids isrIDs) *pb.Entity {
	return &pb.Entity{
		Id:         ids.task,
		Controller: &pb.Controller{Id: proto.String(controllerName)},
		Routing:    &pb.Routing{Channels: []*pb.Channel{{}}},
		Taskable: &pb.TaskableComponent{
			Label:    proto.String("Survey with ISR1"),
			Icon:     proto.String("plane"),
			Mode:     pb.TaskableMode_TaskableModeReconcile,
			Effect:   proto.String("ISR1 flies to the position and orbits it, keeping its camera on the centre"),
			Assignee: []*pb.TaskableAssignee{{EntityId: proto.String(ids.drone)}},
			Target:   &pb.TaskableTarget{Position: &pb.TaskableTargetPosition{}},
			Taxonomy: &pb.TaskingTaxonomy{Kind: &pb.TaskingTaxonomy_Movement{Movement: &pb.TaskingTaxonomyMovement{
				Kind: &pb.TaskingTaxonomyMovement_MoveTo{MoveTo: &pb.TaskingTaxonomyMoveTo{}},
			}}},
		},
	}
}

// watchGotoTask forwards pending go-to executions; a newer one replaces any
// not yet picked up.
func watchGotoTask(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, taskID string, out chan [2]float64) {
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &taskID,
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentTaskExecution)},
		},
	})
	if err != nil {
		logger.Error("isr: watch task", "error", err)
		return
	}
	for {
		ev, err := stream.Recv()
		if err != nil {
			return
		}
		exec := ev.Entity.GetTaskExecution()
		if ev.T != pb.EntityChange_EntityChangeUpdated || exec == nil || exec.State != pb.TaskExecutionState_TaskExecutionStatePending {
			continue
		}
		pos := exec.GetTarget().GetPosition()
		if pos == nil {
			pushExecState(ctx, client, taskID, pb.TaskExecutionState_TaskExecutionStateFailed, "no position target")
			continue
		}
		select {
		case <-out:
		default:
		}
		out <- [2]float64{pos.Latitude, pos.Longitude}
	}
}

func pushExecState(ctx context.Context, client pb.WorldServiceClient, taskID string, state pb.TaskExecutionState, reason string) {
	exec := &pb.TaskExecutionComponent{Task: taskID, State: state}
	if reason != "" {
		exec.Reason = &reason
	}
	_, _ = client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{{Id: taskID, TaskExecution: exec}}})
}
