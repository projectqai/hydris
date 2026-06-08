package observe

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sync"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const controllerName = "observe"

func init() {
	builtin.Register(controllerName, Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	schema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"altitude_offset": map[string]any{
				"type":        "number",
				"title":       "Altitude Offset (m)",
				"description": "Added to the target altitude before computing elevation.",
				"default":     0,
			},
			"elevation_offset": map[string]any{
				"type":        "number",
				"title":       "Elevation Offset (°)",
				"description": "Added to the computed elevation angle.",
				"default":     0,
			},
			"zoom_mode": map[string]any{
				"type":        "string",
				"title":       "Zoom Mode",
				"description": "off = no zoom (wide angle), auto = distance-proportional zoom, manual = fixed zoom level.",
				"enum":        []any{"off", "auto", "manual"},
				"default":     "auto",
			},
			"zoom_level": map[string]any{
				"type":        "number",
				"title":       "Zoom Level",
				"description": "In auto mode: extra zoom beyond distance baseline (0 = pure distance, 1 = full tele). In manual mode: exact zoom (0 = wide, 1 = full tele).",
				"default":     0,
			},
		},
	})

	if err := controller.Push(ctx, controllerName, &pb.Entity{
		Id:    controllerName + ".service",
		Label: proto.String("Observe"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Mission"),
		},
		Configurable: &pb.ConfigurableComponent{
			Schema: schema,
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("crosshair"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	return controller.Run(ctx, controllerName, controllerName+".service", func(ctx context.Context, entity *pb.Entity, ready func()) error {
		ready()

		grpcConn, err := builtin.BuiltinClientConn("observe")
		if err != nil {
			return fmt.Errorf("grpc connect: %w", err)
		}
		defer func() { _ = grpcConn.Close() }()

		client := pb.NewWorldServiceClient(grpcConn)
		cfg := configFromEntity(entity)

		return watchCameras(ctx, logger, client, cfg)
	})
}

type aimConfig struct {
	altitudeOffset  float64
	elevationOffset float64
	zoomMode        string
	zoomLevel       float64
}

func configFromEntity(entity *pb.Entity) aimConfig {
	cfg := aimConfig{zoomMode: "auto"}
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return cfg
	}
	f := entity.Config.Value.Fields
	if v, ok := f["altitude_offset"]; ok {
		cfg.altitudeOffset = v.GetNumberValue()
	}
	if v, ok := f["elevation_offset"]; ok {
		cfg.elevationOffset = v.GetNumberValue()
	}
	if v, ok := f["zoom_mode"]; ok {
		cfg.zoomMode = v.GetStringValue()
	}
	if v, ok := f["zoom_level"]; ok {
		cfg.zoomLevel = v.GetNumberValue()
	}
	return cfg
}

type camState struct {
	mu           sync.RWMutex
	focalPointID string
	lat, lon     float64
	alt          float64
	rangeMax     float64

	activeMu     sync.Mutex
	activeCancel context.CancelFunc
}

// replaceActive cancels any running observation (track or look_at) and
// installs a new cancel func. Both execution watchers call this so that
// a look_at cancels an active track and vice versa.
func (c *camState) replaceActive(cancel context.CancelFunc) {
	c.activeMu.Lock()
	if c.activeCancel != nil {
		c.activeCancel()
	}
	c.activeCancel = cancel
	c.activeMu.Unlock()
}

func (c *camState) clearActive() {
	c.replaceActive(nil)
}

func trackTaskableID(cameraID string) string {
	return "observe.track." + cameraID
}

func lookAtTaskableID(cameraID string) string {
	return "observe.look_at." + cameraID
}

func watchCameras(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, cfg aimConfig) error {
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentCamera)},
		},
	})
	if err != nil {
		return fmt.Errorf("watch cameras: %w", err)
	}

	cameras := make(map[string]*camState)
	cancels := make(map[string]context.CancelFunc)

	defer func() {
		for _, cancel := range cancels {
			cancel()
		}
		for camID := range cameras {
			_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: trackTaskableID(camID)})
			_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: lookAtTaskableID(camID)})
		}
	}()

	for {
		event, err := stream.Recv()
		if err != nil {
			return fmt.Errorf("camera watch: %w", err)
		}
		if event.Entity == nil {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			ent := event.Entity
			if ent.Camera == nil || ent.Camera.FocalPoint == nil || ent.Geo == nil {
				continue
			}

			camID := ent.Id
			cam, exists := cameras[camID]
			if !exists {
				cam = &camState{}
				cameras[camID] = cam

				tid := trackTaskableID(camID)
				lid := lookAtTaskableID(camID)
				_, pushErr := client.Push(ctx, &pb.EntityChangeRequest{
					Changes: []*pb.Entity{
						{
							Id: tid,
							Controller: &pb.Controller{
								Id: proto.String(controllerName),
							},
							Routing: ent.Routing,
							Taskable: &pb.TaskableComponent{
								Label:    proto.String("Track"),
								Icon:     proto.String("crosshair"),
								Mode:     pb.TaskableMode_TaskableModeReconcile,
								Effect:   proto.String("Aim this camera at a target"),
								Assignee: []*pb.TaskableAssignee{{EntityId: &camID}},
								Target: &pb.TaskableTarget{
									Entity: &pb.TaskableTargetEntity{
										Max: proto.Uint32(1),
									},
								},
								Taxonomy: &pb.TaskingTaxonomy{
									Kind: &pb.TaskingTaxonomy_Observe{
										Observe: &pb.TaskingTaxonomyObserve{
											Kind: &pb.TaskingTaxonomyObserve_Track{
												Track: &pb.TaskingTaxonomyTrack{},
											},
										},
									},
								},
							},
						},
						{
							Id: lid,
							Controller: &pb.Controller{
								Id: proto.String(controllerName),
							},
							Routing: ent.Routing,
							Taskable: &pb.TaskableComponent{
								Label:    proto.String("Look At"),
								Icon:     proto.String("eye"),
								Mode:     pb.TaskableMode_TaskableModeReconcile,
								Effect:   proto.String("Aim this camera at a position"),
								Assignee: []*pb.TaskableAssignee{{EntityId: &camID}},
								Target: &pb.TaskableTarget{
									Position: &pb.TaskableTargetPosition{},
								},
								Taxonomy: &pb.TaskingTaxonomy{
									Kind: &pb.TaskingTaxonomy_Observe{
										Observe: &pb.TaskingTaxonomyObserve{
											Kind: &pb.TaskingTaxonomyObserve_LookAt{
												LookAt: &pb.TaskingTaxonomyLookAt{},
											},
										},
									},
								},
							},
						},
					},
				})
				if pushErr != nil {
					logger.Error("push taskables", "camera", camID, "error", pushErr)
					continue
				}

				camCtx, camCancel := context.WithCancel(ctx)
				cancels[camID] = camCancel
				go watchTrackExecution(camCtx, logger, client, tid, cam, cfg)
				go watchLookAtExecution(camCtx, logger, client, lid, cam, cfg)

				logger.Info("camera discovered, taskables created", "camera", camID)
			}

			cam.mu.Lock()
			cam.focalPointID = ent.Camera.GetFocalPoint()
			cam.lat = ent.Geo.Latitude
			cam.lon = ent.Geo.Longitude
			cam.alt = ent.Geo.GetAltitude()
			cam.rangeMax = ent.Camera.GetRangeMax()
			cam.mu.Unlock()

		case pb.EntityChange_EntityChangeExpired, pb.EntityChange_EntityChangeUnobserved:
			camID := event.Entity.Id
			if cancel, ok := cancels[camID]; ok {
				cancel()
				delete(cancels, camID)
			}
			if _, ok := cameras[camID]; ok {
				_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: trackTaskableID(camID)})
				_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: lookAtTaskableID(camID)})
				delete(cameras, camID)
				logger.Info("camera gone, taskables expired", "camera", camID)
			}
		}
	}
}

func watchTrackExecution(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, entityID string, cam *camState, cfg aimConfig) {
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &entityID,
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentTaskExecution)},
		},
	})
	if err != nil {
		logger.Error("watch track execution", "entity", entityID, "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Error("track execution recv", "entity", entityID, "error", err)
			return
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		exec := event.Entity.TaskExecution
		if exec == nil || exec.State != pb.TaskExecutionState_TaskExecutionStatePending {
			continue
		}

		target := exec.GetTarget()
		ent := target.GetEntity()
		if ent == nil || len(ent.GetEntity()) == 0 {
			pushExecState(ctx, client, entityID, pb.TaskExecutionState_TaskExecutionStateFailed, "no entity target")
			continue
		}

		targetEntityID := ent.GetEntity()[0]
		trackCtx, trackCancel := context.WithCancel(ctx)
		cam.replaceActive(trackCancel)

		pushExecState(ctx, client, entityID, pb.TaskExecutionState_TaskExecutionStateRunning, "")
		logger.Info("tracking target", "taskable", entityID, "target", targetEntityID)

		go watchTarget(trackCtx, logger, client, entityID, targetEntityID, cam, cfg)
	}
}

func watchLookAtExecution(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, entityID string, cam *camState, cfg aimConfig) {
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &entityID,
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentTaskExecution)},
		},
	})
	if err != nil {
		logger.Error("watch look_at execution", "entity", entityID, "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Error("look_at execution recv", "entity", entityID, "error", err)
			return
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		exec := event.Entity.TaskExecution
		if exec == nil || exec.State != pb.TaskExecutionState_TaskExecutionStatePending {
			continue
		}

		target := exec.GetTarget()
		pos := target.GetPosition()
		if pos == nil {
			pushExecState(ctx, client, entityID, pb.TaskExecutionState_TaskExecutionStateFailed, "no position target")
			continue
		}

		cam.clearActive()

		pushExecState(ctx, client, entityID, pb.TaskExecutionState_TaskExecutionStateRunning, "")
		aimAt(client, cam, cfg, pos.Latitude, pos.Longitude, pos.GetAltitude())
		pushExecState(ctx, client, entityID, pb.TaskExecutionState_TaskExecutionStateCompleted, "")
		logger.Info("look at position", "taskable", entityID, "lat", pos.Latitude, "lon", pos.Longitude)
	}
}

func aimAt(client pb.WorldServiceClient, cam *camState, cfg aimConfig, lat, lon, alt float64) {
	cam.mu.RLock()
	focalPointID := cam.focalPointID
	camLat := cam.lat
	camLon := cam.lon
	camAlt := cam.alt
	rangeMax := cam.rangeMax
	cam.mu.RUnlock()

	if focalPointID == "" {
		return
	}

	targetAlt := alt + cfg.altitudeOffset
	az, dist := latLngToAzimuthRange(camLat, camLon, lat, lon)
	altDiff := targetAlt - camAlt
	elev := math.Atan2(altDiff, dist)*180/math.Pi + cfg.elevationOffset
	var rng float64
	switch cfg.zoomMode {
	case "off":
		rng = 0
	case "manual":
		rng = cfg.zoomLevel * rangeMax
	default:
		slant := math.Sqrt(dist*dist + altDiff*altDiff)
		if rangeMax > 0 && slant > rangeMax {
			slant = rangeMax
		}
		rng = slant + cfg.zoomLevel*(rangeMax-slant)
	}

	_, _ = client.Push(context.Background(), &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: focalPointID,
			TargetPose: &pb.TargetPoseComponent{
				Offset: &pb.TargetPoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth:   az,
						Elevation: &elev,
						Range:     &rng,
					},
				},
			},
		}},
	})
}

func watchTarget(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, taskableEntityID, targetID string, cam *camState, cfg aimConfig) {
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id: &targetID,
		},
	})
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		logger.Error("watch target", "target", targetID, "error", err)
		pushExecState(ctx, client, taskableEntityID, pb.TaskExecutionState_TaskExecutionStateFailed, "cannot watch target")
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Error("target watch recv", "target", targetID, "error", err)
			return
		}
		if event.Entity == nil {
			continue
		}

		if event.T == pb.EntityChange_EntityChangeExpired || event.T == pb.EntityChange_EntityChangeUnobserved {
			pushExecState(ctx, client, taskableEntityID, pb.TaskExecutionState_TaskExecutionStateCompleted, "target expired")
			return
		}

		geo := event.Entity.Geo
		if geo == nil {
			continue
		}

		aimAt(client, cam, cfg, geo.Latitude, geo.Longitude, geo.GetAltitude())
	}
}

func pushExecState(ctx context.Context, client pb.WorldServiceClient, entityID string, state pb.TaskExecutionState, reason string) {
	exec := &pb.TaskExecutionComponent{
		Task:  entityID,
		State: state,
	}
	if reason != "" {
		exec.Reason = &reason
	}
	_, _ = client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:            entityID,
			TaskExecution: exec,
		}},
	})
}

func latLngToAzimuthRange(lat1, lon1, lat2, lon2 float64) (azimuth, distance float64) {
	const earthR = 6371000.0
	lat1r := lat1 * math.Pi / 180.0
	lat2r := lat2 * math.Pi / 180.0
	dlat := (lat2 - lat1) * math.Pi / 180.0
	dlon := (lon2 - lon1) * math.Pi / 180.0

	a := math.Sin(dlat/2)*math.Sin(dlat/2) +
		math.Cos(lat1r)*math.Cos(lat2r)*math.Sin(dlon/2)*math.Sin(dlon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	distance = earthR * c

	y := math.Sin(dlon) * math.Cos(lat2r)
	x := math.Cos(lat1r)*math.Sin(lat2r) - math.Sin(lat1r)*math.Cos(lat2r)*math.Cos(dlon)
	azimuth = math.Atan2(y, x) * 180.0 / math.Pi
	if azimuth < 0 {
		azimuth += 360.0
	}
	return azimuth, distance
}
