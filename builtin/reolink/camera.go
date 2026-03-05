package reolink

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// Known Reolink camera specs keyed by lowercased model name.
var cameraDB = map[string]cameraSpec{
	"duo 3 poe":    {FOVWide: 180, RangeMax: 30},
	"trackmix poe": {FOVWide: 104, FOVTele: 38, RangeMax: 30, HasPTZ: true},
	"argus 3 pro":  {FOVWide: 105, RangeMax: 10},
	"argus 4 pro":  {FOVWide: 180, RangeMax: 10},
	"e1 zoom":      {FOVWide: 98, FOVTele: 32, RangeMax: 12, HasPTZ: true, TiltOffset: 350},
	"e1 outdoor":   {FOVWide: 90, FOVTele: 50, RangeMax: 12, HasPTZ: true},
	"cx410":        {FOVWide: 89, RangeMax: 30},
	"cx810":        {FOVWide: 93, RangeMax: 30},
}

type cameraSpec struct {
	FOVWide    float64
	FOVTele    float64
	RangeMax   float64
	RangeMin   float64
	HasPTZ     bool
	TiltOffset float64 // Reolink tilt value that corresponds to true horizon
}

func lookupSpec(model string) *cameraSpec {
	key := strings.ToLower(strings.TrimSpace(model))
	if spec, ok := cameraDB[key]; ok {
		return &spec
	}
	for dbKey, spec := range cameraDB {
		if strings.HasPrefix(key, dbKey) {
			return &spec
		}
	}
	return nil
}

// runCamera connects to a Reolink camera, pushes stream entities, and
// if the camera has PTZ, watches TargetPoseComponent to drive it.
func runCamera(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func(), svcCfg serviceConfig) error {
	cfg := parseCameraConfig(entity, svcCfg)

	ip := ""
	if entity.Device != nil && entity.Device.Ip != nil {
		ip = entity.Device.Ip.GetHost()
	}
	if ip == "" && entity.Device != nil && len(entity.Device.Composition) > 0 {
		grpcConn, err := builtin.BuiltinClientConn()
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
		return fmt.Errorf("no IP address available for camera %s", entity.Id)
	}

	logger.Info("probing Reolink camera", "entityID", entity.Id, "ip", ip)

	// Get device info via Reolink API.
	manufacturer, model, serial, err := getDeviceInfo(ip, cfg.Username, cfg.Password)
	if err != nil {
		return fmt.Errorf("get device info from %s: %w", ip, err)
	}

	logger.Info("Reolink device info", "ip", ip, "model", model, "serial", serial)

	spec := lookupSpec(model)
	if spec != nil {
		logger.Info("matched camera database", "model", model, "fov", spec.FOVWide)
		if cfg.FOV == 0 && spec.FOVWide > 0 {
			cfg.FOV = spec.FOVWide
		}
		if cfg.RangeMin == 0 && spec.RangeMin > 0 {
			cfg.RangeMin = spec.RangeMin
		}
		if cfg.RangeMax == 0 && spec.RangeMax > 0 {
			cfg.RangeMax = spec.RangeMax
		}
	}

	// Set hardware identity.
	if serial != "" {
		hwID := strings.ToLower(manufacturer) + "." + serial
		_ = controller.Push(ctx, &pb.Entity{
			Id: entity.Id,
			Device: &pb.DeviceComponent{
				UniqueHardwareId: proto.String(hwID),
			},
		})
	}

	// Build Reolink RTSP stream URIs.
	// Reolink standard: rtsp://<user>:<pass>@<ip>/h264Preview_01_main
	cameras := []*pb.MediaStream{
		{
			Label:    "Sub Stream",
			Url:      fmt.Sprintf("rtsp://%s:%s@%s/h264Preview_01_sub", cfg.Username, cfg.Password, ip),
			Protocol: pb.MediaStreamProtocol_MediaStreamProtocolRtsp,
			Role:     pb.MediaStreamRole_MediaStreamRoleSub,
		},
		{
			Label:    "Main Stream",
			Url:      fmt.Sprintf("rtsp://%s:%s@%s/h264Preview_01_main", cfg.Username, cfg.Password, ip),
			Protocol: pb.MediaStreamProtocol_MediaStreamProtocolRtsp,
			Role:     pb.MediaStreamRole_MediaStreamRoleMain,
		},
		{
			Label:    "Snapshot",
			Url:      fmt.Sprintf("http://%s/cgi-bin/api.cgi?cmd=Snap&channel=0&user=%s&password=%s", ip, cfg.Username, cfg.Password),
			Protocol: pb.MediaStreamProtocol_MediaStreamProtocolImage,
			Role:     pb.MediaStreamRole_MediaStreamRoleSnapshot,
		},
	}

	focalPointID := entity.Id + "~fp"

	camComp := &pb.CameraComponent{
		Streams: cameras,
	}
	if spec != nil && spec.HasPTZ {
		camComp.FocalPoint = proto.String(focalPointID)
	}
	if cfg.FOV > 0 {
		camComp.Fov = proto.Float64(cfg.FOV)
	}
	if cfg.RangeMin > 0 {
		camComp.RangeMin = proto.Float64(cfg.RangeMin)
	}
	if cfg.RangeMax > 0 {
		camComp.RangeMax = proto.Float64(cfg.RangeMax)
	}
	if spec != nil {
		if spec.FOVWide > 0 {
			camComp.FovWide = proto.Float64(spec.FOVWide)
		}
		if spec.FOVTele > 0 {
			camComp.FovTele = proto.Float64(spec.FOVTele)
		}
	}

	headEntity := &pb.Entity{
		Id:     entity.Id,
		Camera: camComp,
		Geo: &pb.GeoSpatialComponent{
			Latitude:  cfg.Latitude,
			Longitude: cfg.Longitude,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: "SFGPE-----",
		},
	}
	if model != "" {
		label := manufacturer + " " + model
		headEntity.Label = proto.String(label)
	}
	if err := controller.Push(ctx, headEntity); err != nil {
		return fmt.Errorf("push head entity: %w", err)
	}

	logger.Info("camera connected", "entityID", entity.Id, "ip", ip, "streams", len(cameras))

	ready()

	// If camera has PTZ, push the focal point entity and watch its TargetPoseComponent.
	hasPTZ := spec != nil && spec.HasPTZ
	if hasPTZ {
		// Read initial PTZ position so the focal point starts correct.
		initAz := 0.0
		initEl := 0.0
		initRange := 0.0
		curPos, posErr := getPTZPosition(ip, cfg.Username, cfg.Password)
		if posErr == nil {
			initAz = reolinkPanToAzimuth(curPos.Pan)
			initEl = reolinkTiltToElevation(curPos.Tilt, spec.TiltOffset)
			initRange = reolinkZoomToRange(curPos.Zoom, spec)
			logger.Info("initial PTZ position", "pan", curPos.Pan, "tilt", curPos.Tilt, "zoom", curPos.Zoom, "tiltOffset", spec.TiltOffset)
		}

		elev := initEl
		if err := controller.Push(ctx, &pb.Entity{
			Id: focalPointID,
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
			Symbol: &pb.SymbolComponent{
				MilStd2525C: "SF--------",
			},
		}); err != nil {
			return fmt.Errorf("push focal point entity: %w", err)
		}
		return watchTargetPose(ctx, logger, ip, cfg, focalPointID, entity.Id, spec)
	}

	<-ctx.Done()
	return nil
}

// watchTargetPose watches for TargetPoseComponent on the focal point entity
// and drives the physical camera toward it using the Reolink API with
// closed-loop feedback, one axis at a time.
func watchTargetPose(ctx context.Context, logger *slog.Logger, ip string, cfg cameraConfig, entityID, parentID string, spec *cameraSpec) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, worldClient, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &entityID,
			Component: []uint32{62}, // TargetPoseComponent
		},
	})
	if err != nil {
		return fmt.Errorf("watch target pose: %w", err)
	}

	// Read initial position and push it as current pose.
	curPos, err := getPTZPosition(ip, cfg.Username, cfg.Password)
	if err != nil {
		logger.Warn("failed to read initial PTZ position", "error", err)
	} else {
		logger.Info("initial PTZ position", "pan", curPos.Pan, "tilt", curPos.Tilt, "zoom", curPos.Zoom, "tiltOffset", spec.TiltOffset)
		az := reolinkPanToAzimuth(curPos.Pan)
		el := reolinkTiltToElevation(curPos.Tilt, spec.TiltOffset)
		rng := reolinkZoomToRange(curPos.Zoom, spec)
		pushPose(ctx, worldClient, entityID, parentID, az, el, rng)
	}

	// Poll the physical PTZ position periodically so that external
	// control (e.g. joystick, web UI) is reflected in the entity pose.
	go pollPhysicalPose(ctx, logger, ip, cfg, entityID, parentID, spec, worldClient)

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

		// Extract target azimuth/elevation/range from the TargetPoseComponent.
		var targetAz, targetEl, targetRange float64
		switch o := tp.Offset.(type) {
		case *pb.TargetPoseComponent_Polar:
			targetAz = o.Polar.Azimuth
			if o.Polar.Elevation != nil {
				targetEl = *o.Polar.Elevation
			}
			if o.Polar.Range != nil {
				targetRange = *o.Polar.Range
			}
		default:
			continue
		}

		// Convert target azimuth (degrees) to Reolink pan units.
		// Reolink pan range is typically 0-3600 (tenths of a degree over 360°).
		// The target azimuth from TargetPoseComponent is in degrees relative
		// to the camera's pose parent (base heading).
		targetPan := azimuthToReolinkPan(targetAz)
		targetTilt := elevationToReolinkTilt(targetEl, spec.TiltOffset)

		// Clamp tilt to the camera's physical range.
		// Reolink PTZ tilt: 0 = horizon, positive = up, negative = down.
		// Typical range: -200 (20° below horizon) to +900 (90° up).
		if targetTilt < -200 {
			targetTilt = -200
		}
		if targetTilt > 900 {
			targetTilt = 900
		}

		logger.Info("target pose received",
			"entityID", entityID,
			"azimuth", targetAz,
			"elevation", targetEl,
			"targetPan", targetPan,
			"targetTilt", targetTilt,
		)

		// Read current position.
		curPos, err = getPTZPosition(ip, cfg.Username, cfg.Password)
		if err != nil {
			logger.Warn("failed to read PTZ position", "error", err)
			continue
		}

		// Skip if already at target.
		if math.Abs(curPos.Pan-targetPan) < panTolerance && math.Abs(curPos.Tilt-targetTilt) < tiltTolerance {
			continue
		}

		// Report intermediate positions during the control loop.
		reportPos := func(pos ptzPosition) {
			az := reolinkPanToAzimuth(pos.Pan)
			el := reolinkTiltToElevation(pos.Tilt, spec.TiltOffset)
			pushPose(ctx, worldClient, entityID, parentID, az, el, targetRange)
		}

		// Move pan axis.
		curPos.Pan = moveAxis(ip, cfg.Username, cfg.Password, curPos.Pan, targetPan,
			func(sign int) string {
				if sign > 0 {
					return "Right"
				}
				return "Left"
			},
			func(p ptzPosition) float64 { return p.Pan },
			reportPos,
			panSpeedProfile,
			panTolerance,
		)

		// Move tilt axis.
		curPos.Tilt = moveAxis(ip, cfg.Username, cfg.Password, curPos.Tilt, targetTilt,
			func(sign int) string {
				if sign > 0 {
					return "Up"
				}
				return "Down"
			},
			func(p ptzPosition) float64 { return p.Tilt },
			reportPos,
			tiltSpeedProfile,
			tiltTolerance,
		)

		// Set zoom based on target range if the camera has optical zoom.
		if spec.FOVTele > 0 && spec.FOVTele < spec.FOVWide && targetRange > 0 {
			// Reolink zoom is 0-32. Map target range to zoom level:
			// closer targets need less zoom, farther targets need more.
			// Use RangeMax as the distance where we want full zoom.
			rangeMax := spec.RangeMax
			if rangeMax <= 0 {
				rangeMax = 60
			}
			zoomNorm := targetRange / rangeMax // 0..1 (clamped below)
			if zoomNorm > 1 {
				zoomNorm = 1
			}
			zoomPos := int(zoomNorm * 32)
			if zoomPos < 0 {
				zoomPos = 0
			}
			if zoomPos > 32 {
				zoomPos = 32
			}
			setAbsoluteZoom(ip, cfg.Username, cfg.Password, zoomPos)
		}

		logger.Info("PTZ move complete",
			"entityID", entityID,
			"pan", curPos.Pan,
			"tilt", curPos.Tilt,
			"range", targetRange,
		)

		// Push final pose.
		reportPos(curPos)
	}
}

// pollPhysicalPose periodically reads the camera's actual PTZ position and
// pushes it so external control (joystick, web UI, etc.) is reflected.
func pollPhysicalPose(ctx context.Context, logger *slog.Logger, ip string, cfg cameraConfig, entityID, parentID string, spec *cameraSpec, client pb.WorldServiceClient) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pos, err := getPTZPosition(ip, cfg.Username, cfg.Password)
			if err != nil {
				continue
			}
			az := reolinkPanToAzimuth(pos.Pan)
			el := reolinkTiltToElevation(pos.Tilt, spec.TiltOffset)
			rng := reolinkZoomToRange(pos.Zoom, spec)
			pushPose(ctx, client, entityID, parentID, az, el, rng)
		}
	}
}

// pushPose updates the entity's PoseComponent to reflect the physical camera orientation.
func pushPose(ctx context.Context, client pb.WorldServiceClient, entityID, parentID string, azimuth, elevation, rng float64) {
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
						Range:     proto.Float64(rng),
					},
				},
			},
		}},
	})
}

// Coordinate conversion between degrees and Reolink units.
// Reolink uses 0-3600 for pan (tenths of a degree, 0-360°)
// and 0-900 for tilt (tenths of a degree, 0-90°).
// Azimuth 0° from TargetPoseComponent = camera's forward direction.
// We map azimuth [-180, 180) to Reolink pan [0, 3600).

func azimuthToReolinkPan(az float64) float64 {
	// Normalize to [0, 360)
	az = math.Mod(az, 360)
	if az < 0 {
		az += 360
	}
	return az * 10 // Reolink uses tenths of a degree
}

func reolinkPanToAzimuth(pan float64) float64 {
	az := math.Mod(pan/10, 360) // Convert from tenths to degrees
	if az < 0 {
		az += 360
	}
	return az
}

func elevationToReolinkTilt(el float64, tiltOffset float64) float64 {
	// Reolink tilt: tiltOffset = horizon, positive = looking up.
	// Elevation: positive = up, negative = down.
	if el < -90 {
		el = -90
	}
	if el > 90 {
		el = 90
	}
	return el*10 + tiltOffset
}

func reolinkTiltToElevation(tilt float64, tiltOffset float64) float64 {
	return (tilt - tiltOffset) / 10
}

// reolinkZoomToRange converts a Reolink zoom position (0-32) back to a
// range value in meters, the inverse of the zoom calculation in watchTargetPose.
func reolinkZoomToRange(zoom float64, spec *cameraSpec) float64 {
	if spec == nil || spec.FOVTele <= 0 || spec.FOVTele >= spec.FOVWide {
		return 0
	}
	rangeMax := spec.RangeMax
	if rangeMax <= 0 {
		rangeMax = 60
	}
	zoomNorm := zoom / 32
	if zoomNorm < 0 {
		zoomNorm = 0
	}
	if zoomNorm > 1 {
		zoomNorm = 1
	}
	return zoomNorm * rangeMax
}
