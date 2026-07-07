// Package simcam implements a camera simulator. It publishes one or more
// PTZ-capable Camera entities whose video streams are rendered in-process
// from the simulated gimbal pose. The frames are deliberately busy with
// orientation cues — color-coded sky by azimuth, a horizon line tracking
// tilt, a rolling compass strip, and a HUD showing pan/tilt/zoom — so the
// user can immediately see where each camera is pointing.
//
// Streams are served over MJPEG via the shared engine HTTP server under
// /plugin/simcam/cam/<id>. The MediaTransformer rewrites the published URL
// to the standard /media/image/... proxy path for consumers.
package simcam

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	controllerName  = "simcam"
	serviceEntityID = controllerName + ".service"

	maxTargets = 8

	// Geographic anchor for simulated targets — chosen to sit next to the
	// playground "Simulated Drone Radar" so the debugger lines up on the
	// same area of the map.
	anchorLatitude  = 51.9555
	anchorLongitude = 4.1694
)

func init() {
	builtin.Register(controllerName, Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	if err := controller.Push(ctx, controllerName, &pb.Entity{
		Id:    serviceEntityID,
		Label: proto.String("Camera Debugger"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Cameras"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Configurable: &pb.ConfigurableComponent{
			Schema: serviceSchema(),
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{
					Class:       "camera",
					Label:       "Simulated PTZ Camera",
					Description: "A simulated PTZ camera that renders a synthetic video stream from its geographic position.",
				},
			},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("camera"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	return controller.Run(ctx, controllerName, serviceEntityID, runService)
}

func serviceSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"target_count": map[string]any{
				"type":        "integer",
				"title":       "Simulated Targets",
				"description": "Number of movable map markers with a TrackComponent for testing camera cueing",
				"default":     0,
				"minimum":     0,
				"maximum":     maxTargets,
				"ui:order":    0,
			},
			"enable_focalpoint_symbols": map[string]any{
				"type":        "boolean",
				"title":       "Focal Point Symbols",
				"description": "Attach a symbol to every camera focal point so it appears on the map",
				"default":     false,
				"ui:order":    1,
			},
		},
	})
	return s
}

func cameraSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"fov_wide": map[string]any{
				"type":        "number",
				"title":       "Wide FOV",
				"description": "Field of view at maximum wide angle (degrees)",
				"default":     defaultFovWide,
				"minimum":     10,
				"maximum":     120,
				"ui:order":    0,
			},
			"fov_tele": map[string]any{
				"type":        "number",
				"title":       "Tele FOV",
				"description": "Field of view at maximum telephoto (degrees)",
				"default":     defaultFovTele,
				"minimum":     1,
				"maximum":     60,
				"ui:order":    1,
			},
			"range_max": map[string]any{
				"type":        "number",
				"title":       "Max Range",
				"description": "Maximum zoom range in meters",
				"default":     defaultRangeMax,
				"minimum":     100,
				"maximum":     20000,
				"ui:order":    2,
			},
			"render_behind_wall": map[string]any{
				"type":        "boolean",
				"title":       "Render Behind Walls",
				"description": "Show entities that are behind walls (disables wall occlusion)",
				"default":     false,
				"ui:order":    3,
			},
			"instant_slew": map[string]any{
				"type":        "boolean",
				"title":       "Instant Slew",
				"description": "Snap to target position immediately instead of simulating slew rate",
				"default":     false,
				"ui:order":    4,
			},
			"enable_detections": map[string]any{
				"type":        "boolean",
				"title":       "Simulated Detections",
				"description": "Emit detection entities with bounding boxes for objects visible in camera streams",
				"default":     false,
				"ui:order":    5,
			},
			"enable_direct_drive": map[string]any{
				"type":        "boolean",
				"title":       "Direct Drive",
				"description": "Accept manual joystick control for pan and tilt",
				"default":     false,
				"ui:order":    6,
			},
		},
	})
	return s
}

type serviceConfig struct {
	TargetCount            int
	EnableFocalpointSymbol bool
}

func parseServiceConfig(entity *pb.Entity) serviceConfig {
	var cfg serviceConfig
	if entity.Config == nil || entity.Config.Value == nil {
		return cfg
	}
	fields := entity.Config.Value.Fields
	if v, ok := fields["target_count"]; ok {
		cfg.TargetCount = int(v.GetNumberValue())
	}
	if v, ok := fields["enable_focalpoint_symbols"]; ok {
		cfg.EnableFocalpointSymbol = v.GetBoolValue()
	}
	cfg.TargetCount = clampInt(cfg.TargetCount, 0, maxTargets)
	return cfg
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func runService(ctx context.Context, entity *pb.Entity, ready func()) error {
	cfg := parseServiceConfig(entity)
	logger := slog.Default().With("module", controllerName)
	logger.Info("simcam: starting",
		"targets", cfg.TargetCount,
		"focalpoint_symbols", cfg.EnableFocalpointSymbol)

	ready()

	var wg sync.WaitGroup

	if cfg.TargetCount > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			runTargets(ctx, logger, cfg.TargetCount)
		}()
	}

	if cfg.EnableFocalpointSymbol {
		wg.Add(1)
		go func() {
			defer wg.Done()
			runFocalpointSymbols(ctx, logger)
		}()
	}

	classes := []controller.DeviceClass{
		{Class: "camera", Label: "Simulated PTZ Camera", Schema: cameraSchema()},
	}

	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := controller.WatchChildren(ctx, controllerName, serviceEntityID, controllerName, classes, func(ctx context.Context, entityID string) error {
			return controller.Run(ctx, controllerName, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
				return runCamera(ctx, logger, entity, ready)
			})
		}); err != nil && ctx.Err() == nil {
			logger.Error("simcam: watch children", "error", err)
		}
	}()

	wg.Wait()
	return ctx.Err()
}
