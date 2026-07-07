package axis

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func runCamera(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func(), svcCfg serviceConfig) error {
	cfg := parseCameraConfig(entity, svcCfg)

	ip := ""
	if entity.Device != nil && entity.Device.Ip != nil {
		ip = entity.Device.Ip.GetHost()
	}
	if ip == "" && entity.Device != nil && len(entity.Device.Composition) > 0 {
		grpcConn, err := builtin.BuiltinClientConn("axis")
		if err != nil {
			return fmt.Errorf("grpc connect: %w", err)
		}
		parentClient := pb.NewWorldServiceClient(grpcConn)
		parentResp, err := parentClient.GetEntity(ctx, &pb.GetEntityRequest{Id: entity.Device.Composition[0]})
		_ = grpcConn.Close()
		if err != nil {
			return fmt.Errorf("get composition entity %s: %w", entity.Device.Composition[0], err)
		}
		if parentResp.Entity.Device != nil && parentResp.Entity.Device.Ip != nil {
			ip = parentResp.Entity.Device.Ip.GetHost()
		}
	}
	if ip == "" {
		ip = cfg.Host
	}
	if ip == "" {
		return fmt.Errorf("no IP address available for camera %s", entity.Id)
	}

	logger.Info("probing AXIS camera", "entityID", entity.Id, "ip", ip)

	model, serial, err := getDeviceInfo(ip, cfg.Username, cfg.Password)
	if err != nil {
		return fmt.Errorf("get device info from %s: %w", ip, err)
	}

	logger.Info("AXIS device info", "ip", ip, "model", model, "serial", serial)

	if serial != "" {
		hwID := "axis." + strings.ToLower(serial)
		dev := proto.Clone(entity.Device).(*pb.DeviceComponent)
		if dev == nil {
			dev = &pb.DeviceComponent{}
		}
		dev.UniqueHardwareId = proto.String(hwID)
		_ = controller.Push(ctx, controllerName, &pb.Entity{
			Id:     entity.Id,
			Device: dev,
		})
	}

	caps := getImageCapabilities(ip, cfg.Username, cfg.Password)
	if entity.Configurable != nil && (len(caps.Resolutions) > 0 || len(caps.Codecs) > 0 || caps.MaxFPS > 0) {
		entity.Configurable.Schema = cameraSchemaWithCaps(&caps)
	}

	fovWide, fovTele := getFieldAngle(ip, cfg.Username, cfg.Password)
	if fovWide > 0 {
		logger.Info("FOV from VAPIX", "wide", fovWide, "tele", fovTele)
	}
	rangeMax := 30.0

	streams := discoverStreams(ip, cfg)

	logger.Info("stream config",
		"resolution", cfg.Resolution,
		"codec", cfg.Codec,
		"fps", cfg.FPS,
		"compression", cfg.Compression,
		"bitrate", cfg.Bitrate,
		"streams", len(streams),
	)

	hasPTZ := false
	_, ptzErr := getPTZPosition(ip, cfg.Username, cfg.Password)
	if ptzErr == nil {
		hasPTZ = true
	}

	focalPointID := entity.Id + "~fp"

	camComp := &pb.CameraComponent{
		Streams: streams,
	}
	if hasPTZ {
		camComp.FocalPoint = proto.String(focalPointID)
	}
	if fovWide > 0 {
		camComp.Fov = proto.Float64(fovWide)
	}
	camComp.RangeMax = proto.Float64(rangeMax)
	if fovWide > 0 {
		camComp.FovWide = proto.Float64(fovWide)
	}
	if fovTele > 0 {
		camComp.FovTele = proto.Float64(fovTele)
	}

	headEntity := &pb.Entity{
		Id:      entity.Id,
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Camera:  camComp,
		Classification: &pb.ClassificationComponent{
			Taxonomy: []*pb.ClassificationTaxonomy{{
				Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
					Sensor: &pb.EquipmentTaxonomySensor{Kind: &pb.EquipmentTaxonomySensor_ElectroOptical{ElectroOptical: &pb.EquipmentTaxonomySensorElectroOptical{}}},
				}},
			}},
		},
	}
	if entity.Configurable != nil {
		headEntity.Configurable = entity.Configurable
	}
	if model != "" && entity.Label == nil {
		headEntity.Label = proto.String("AXIS " + model)
	}
	if hasPTZ && cfg.EnableDirectDrive {
		headEntity.ManualControl = &pb.ManualControlComponent{}
	}
	if err := controller.Push(ctx, controllerName, headEntity); err != nil {
		return fmt.Errorf("push head entity: %w", err)
	}

	logger.Info("camera connected", "entityID", entity.Id, "ip", ip, "streams", len(streams), "ptz", hasPTZ)

	if hasAPI(ip, cfg.Username, cfg.Password, "clear-view") {
		go runWiperTaskable(ctx, logger, ip, cfg, entity.Id)
	}

	ready()

	if hasPTZ {
		pos, posErr := getPTZPosition(ip, cfg.Username, cfg.Password)
		initAz := 0.0
		initEl := 0.0
		initRange := 0.0
		if posErr == nil {
			initAz = pos.Pan
			initEl = pos.Tilt
			initRange = vapixZoomToRange(pos.Zoom, rangeMax)
			logger.Info("initial PTZ position", "pan", pos.Pan, "tilt", pos.Tilt, "zoom", pos.Zoom)
		}

		elev := initEl
		if err := controller.Push(ctx, controllerName, &pb.Entity{
			Id:      focalPointID,
			Routing: entity.Routing,
			Pose: &pb.PoseComponent{
				Parent: entity.Id,
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth:   initAz,
						Elevation: &elev,
						Range:     proto.Float64(initRange),
					},
				},
			},
		}); err != nil {
			return fmt.Errorf("push focal point entity: %w", err)
		}
		if cfg.EnableDirectDrive {
			go watchManualControl(ctx, logger, ip, cfg, entity.Id)
		}
		return watchTargetPose(ctx, logger, ip, cfg, focalPointID, entity.Id, rangeMax)
	}

	<-ctx.Done()
	return nil
}

func watchManualControl(ctx context.Context, logger *slog.Logger, ip string, cfg cameraConfig, camID string) {
	grpcConn, err := builtin.BuiltinClientConn("axis")
	if err != nil {
		logger.Warn("axis: manual control connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &camID,
			Component: []uint32{65},
		},
	})
	if err != nil {
		logger.Warn("axis: manual control watch", "error", err)
		return
	}

	var lastPanSpeed, lastTiltSpeed, lastZoomSpeed int
	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Warn("axis: manual control recv", "error", err)
			return
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}

		panSpeed, tiltSpeed, zoomSpeed := 0, 0, 0
		tmc := event.Entity.TargetManualControl
		if tmc != nil && len(tmc.Input) > 0 {
			if axes := tmc.Input[0].Axes; axes != nil {
				pan := axes.GetPan()
				if pan == 0 {
					pan = axes.GetRight() * 0.5
				}
				panSpeed = int(pan * 15)
				tiltSpeed = int(axes.GetTilt() * 15)
				zoomSpeed = int(axes.GetForward() * 45)
			}
		}

		if panSpeed != lastPanSpeed || tiltSpeed != lastTiltSpeed {
			lastPanSpeed = panSpeed
			lastTiltSpeed = tiltSpeed
			if err := continuousPanTiltMove(ip, cfg.Username, cfg.Password, panSpeed, tiltSpeed); err != nil {
				logger.Warn("axis: continuous move", "error", err)
			}
		}
		if zoomSpeed != lastZoomSpeed {
			lastZoomSpeed = zoomSpeed
			if err := continuousZoomMove(ip, cfg.Username, cfg.Password, zoomSpeed); err != nil {
				logger.Warn("axis: continuous zoom", "error", err)
			}
		}
	}
}

func watchTargetPose(ctx context.Context, logger *slog.Logger, ip string, cfg cameraConfig, entityID, parentID string, rangeMax float64) error {
	grpcConn, err := builtin.BuiltinClientConn("axis")
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, worldClient, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &entityID,
			Component: []uint32{62},
		},
	})
	if err != nil {
		return fmt.Errorf("watch target pose: %w", err)
	}

	pos, err := getPTZPosition(ip, cfg.Username, cfg.Password)
	if err == nil {
		pushPose(ctx, worldClient, entityID, parentID, pos.Pan, pos.Tilt, vapixZoomToRange(pos.Zoom, rangeMax))
	}

	go pollPhysicalPose(ctx, logger, ip, cfg, entityID, parentID, rangeMax, worldClient)

	var lastTargetAz, lastTargetEl float64
	lastTargetInit := false

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("target pose stream: %w", err)
		}

		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}

		tp := event.Entity.TargetPose
		if tp == nil {
			continue
		}

		var targetAz, targetEl float64
		switch o := tp.Offset.(type) {
		case *pb.TargetPoseComponent_Polar:
			targetAz = o.Polar.Azimuth
			if o.Polar.Elevation != nil {
				targetEl = *o.Polar.Elevation
			}
		default:
			continue
		}

		if lastTargetInit && targetAz == lastTargetAz && targetEl == lastTargetEl {
			continue
		}
		lastTargetAz = targetAz
		lastTargetEl = targetEl
		lastTargetInit = true

		logger.Info("target pose received",
			"entityID", entityID,
			"azimuth", targetAz,
			"elevation", targetEl,
		)

		curPos, curErr := getPTZPosition(ip, cfg.Username, cfg.Password)
		curZoom := 1.0
		if curErr == nil {
			curZoom = curPos.Zoom
		}

		if err := absoluteMove(ip, cfg.Username, cfg.Password, targetAz, targetEl, curZoom); err != nil {
			logger.Warn("absolute move failed", "error", err)
			continue
		}

		time.Sleep(500 * time.Millisecond)

		pos, err = getPTZPosition(ip, cfg.Username, cfg.Password)
		if err == nil {
			pushPose(ctx, worldClient, entityID, parentID, pos.Pan, pos.Tilt, vapixZoomToRange(pos.Zoom, rangeMax))
		}
	}
}

func pollPhysicalPose(ctx context.Context, logger *slog.Logger, ip string, cfg cameraConfig, entityID, parentID string, rangeMax float64, client pb.WorldServiceClient) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	var lastPan, lastTilt, lastZoom float64
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pos, err := getPTZPosition(ip, cfg.Username, cfg.Password)
			if err != nil {
				continue
			}
			if pos.Pan == lastPan && pos.Tilt == lastTilt && pos.Zoom == lastZoom {
				continue
			}
			lastPan, lastTilt, lastZoom = pos.Pan, pos.Tilt, pos.Zoom
			pushPose(ctx, client, entityID, parentID, pos.Pan, pos.Tilt, vapixZoomToRange(pos.Zoom, rangeMax))
		}
	}
}

func pushPose(ctx context.Context, client pb.WorldServiceClient, entityID, parentID string, azimuth, elevation, zoom float64) {
	elev := elevation
	_, _ = client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: entityID,
			Pose: &pb.PoseComponent{
				Parent: parentID,
				Offset: &pb.PoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth:   azimuth,
						Elevation: &elev,
						Range:     proto.Float64(zoom),
					},
				},
			},
		}},
	})
}

func runWiperTaskable(ctx context.Context, logger *slog.Logger, ip string, cfg cameraConfig, cameraEntityID string) {
	grpcConn, err := builtin.BuiltinClientConn("axis")
	if err != nil {
		logger.Error("wiper: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	taskID := cameraEntityID + "~wiper"
	if _, err := client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: taskID,
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Taskable: &pb.TaskableComponent{
				Label:  proto.String("Wiper"),
				Icon:   proto.String("droplets"),
				Mode:   pb.TaskableMode_TaskableModeReconcile,
				Effect: proto.String("Run the camera wiper/washer"),
				Assignee: []*pb.TaskableAssignee{
					{EntityId: proto.String(cameraEntityID)},
				},
			},
		}},
	}); err != nil {
		logger.Error("wiper: failed to push taskable", "error", err)
		return
	}

	defer func() {
		expCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = client.ExpireEntity(expCtx, &pb.ExpireEntityRequest{Id: taskID})
		cancel()
	}()

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &taskID,
			Component: []uint32{41},
		},
	})
	if err != nil {
		logger.Error("wiper: failed to watch task execution", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			return
		}

		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		exec := event.Entity.TaskExecution
		if exec == nil || exec.State != pb.TaskExecutionState_TaskExecutionStatePending {
			continue
		}

		logger.Info("wiper: starting", "camera", cameraEntityID)

		state := pb.TaskExecutionState_TaskExecutionStateCompleted
		var reason *string
		if err := startWiper(ip, cfg.Username, cfg.Password); err != nil {
			logger.Warn("wiper: failed", "error", err)
			state = pb.TaskExecutionState_TaskExecutionStateFailed
			reason = proto.String(err.Error())
		}

		_, _ = client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: taskID,
				TaskExecution: &pb.TaskExecutionComponent{
					Task:   taskID,
					State:  state,
					Reason: reason,
				},
			}},
		})
	}
}
