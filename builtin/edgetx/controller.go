package edgetx

import (
	"context"
	"encoding/binary"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/hal"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const controllerName = "edgetx"

func init() {
	builtin.Register(controllerName, Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	go watchDevicesAndPublish(ctx, logger)

	if err := controller.Push(ctx, &pb.Entity{
		Id:    "edgetx.service",
		Label: proto.String("EdgeTX"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Vehicles"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("gamepad-2"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	<-ctx.Done()
	return nil
}

func runInstance(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	if entity.Config != nil && entity.Config.Value != nil {
		if v, ok := entity.Config.Value.Fields["enabled"]; ok && !v.GetBoolValue() {
			return nil // intentionally idle
		}
	}

	if entity.Device == nil || len(entity.Device.Composition) == 0 {
		return fmt.Errorf("no composition device for entity %s", entity.Id)
	}

	parentDeviceEntityID := entity.Device.Composition[0]

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	parentResp, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: parentDeviceEntityID})
	if err != nil {
		return fmt.Errorf("get parent device %s: %w", parentDeviceEntityID, err)
	}

	parentEntity := parentResp.Entity
	if parentEntity.Device == nil || parentEntity.Device.Serial == nil {
		return fmt.Errorf("parent device %s has no serial descriptor", parentDeviceEntityID)
	}

	serialPath := parentEntity.Device.Serial.GetPath()
	if serialPath == "" {
		return fmt.Errorf("parent device %s has empty serial path", parentDeviceEntityID)
	}

	logger.Info("Opening EdgeTX serial port", "path", serialPath)
	port, err := hal.OpenSerial(serialPath, 400000)
	if err != nil {
		return fmt.Errorf("open serial %s: %w", serialPath, err)
	}
	defer func() { _ = port.Close() }()

	go func() {
		<-ctx.Done()
		_ = port.Close()
	}()

	logger.Info("EdgeTX serial port opened, reading CRSF frames", "path", serialPath, "entityID", entity.Id)

	// Send device info ping to get radio name/firmware.
	if _, err := port.Write(buildDevicePing(0xEA)); err != nil {
		logger.Warn("failed to send device ping", "error", err)
	}

	entityID := entity.Id
	reader := newCRSFReader(port)

	var (
		frameCount    uint64
		lastPushTime  time.Time
		lastPushCount uint64
		deviceLabel   string
	)

	pushStats := func() {
		now := time.Now()
		var fps float64
		if !lastPushTime.IsZero() {
			dt := now.Sub(lastPushTime).Seconds()
			if dt > 0 {
				fps = float64(frameCount-lastPushCount) / dt
			}
		}
		lastPushTime = now
		lastPushCount = frameCount

		nowPb := timestamppb.New(now)
		e := &pb.Entity{
			Id: entityID,
			Device: &pb.DeviceComponent{
				Category: proto.String("Vehicles"),
				Parent:   proto.String("edgetx.service"),
				State:    pb.DeviceState_DeviceStateActive,
			},
			Link: &pb.LinkComponent{
				LastSeen: nowPb,
			},
			Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
				{
					Kind:       pb.MetricKind_MetricKindCount.Enum(),
					Unit:       pb.MetricUnit_MetricUnitCount,
					Label:      proto.String("frames received"),
					Id:         proto.Uint32(1),
					Val:        &pb.Metric_Uint64{Uint64: frameCount},
					MeasuredAt: nowPb,
				},
				{
					Kind:       pb.MetricKind_MetricKindFrequency.Enum(),
					Unit:       pb.MetricUnit_MetricUnitHertz,
					Label:      proto.String("frame rate"),
					Id:         proto.Uint32(2),
					Val:        &pb.Metric_Double{Double: fps},
					MeasuredAt: nowPb,
				},
			}},
		}
		if deviceLabel != "" {
			e.Label = proto.String(deviceLabel)
		}
		if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{e}}); err != nil && ctx.Err() == nil {
			logger.Error("failed to push stats", "error", err)
		}
	}

	// Periodic stats ticker.
	statsTicker := time.NewTicker(2 * time.Second)
	defer statsTicker.Stop()

	frameCh := make(chan *crsfFrame, 64)
	errCh := make(chan error, 1)

	go func() {
		for {
			frame, err := reader.readFrame()
			if err != nil {
				errCh <- err
				return
			}
			select {
			case frameCh <- frame:
			default: // drop if channel full
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return nil

		case err := <-errCh:
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("read CRSF frame: %w", err)

		case <-statsTicker.C:
			pushStats()

		case frame := <-frameCh:
			frameCount++

			if frame.Type == crsfFrameDeviceInfo {
				if info := decodeDeviceInfo(frame.Payload); info != nil {
					logger.Info("EdgeTX device info", "name", info.Name,
						"serial", fmt.Sprintf("0x%08x", info.SerialNumber),
						"hw", fmt.Sprintf("0x%08x", info.HardwareID))
					deviceLabel = info.Name
				}
			}

			changes := handleFrame(logger, frame, entityID)
			if len(changes) == 0 {
				continue
			}

			if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: changes}); err != nil {
				if ctx.Err() != nil {
					return nil
				}
				logger.Error("failed to push telemetry", "error", err)
			}
		}
	}
}

func handleFrame(logger *slog.Logger, frame *crsfFrame, entityID string) []*pb.Entity {
	switch frame.Type {
	case crsfFrameGPS:
		return handleGPS(logger, frame.Payload, entityID)
	case crsfFrameBattery:
		return handleBattery(frame.Payload, entityID)
	case crsfFrameLinkStats:
		return handleLinkStats(frame.Payload, entityID)
	case crsfFrameAttitude:
		return handleAttitude(frame.Payload, entityID)
	case crsfFrameVario:
		return handleVario(frame.Payload, entityID)
	case crsfFrameFlightMode:
		return handleFlightMode(frame.Payload, entityID)
	case crsfFrameRCChannels:
		return handleRCChannels(frame.Payload, entityID)
	case crsfFrameBaroAlt:
		return handleBaroAlt(frame.Payload, entityID)
	default:
		return nil
	}
}

func handleGPS(logger *slog.Logger, payload []byte, entityID string) []*pb.Entity {
	gps, err := decodeGPS(payload)
	if err != nil {
		logger.Debug("GPS decode error", "error", err)
		return nil
	}

	if gps.Latitude == 0 && gps.Longitude == 0 {
		return nil
	}

	alt := gps.Altitude

	headingRad := gps.Heading * math.Pi / 180.0
	velEast := gps.GroundSpeed * math.Sin(headingRad)
	velNorth := gps.GroundSpeed * math.Cos(headingRad)

	sats := uint32(gps.Satellites)
	fixType := pb.GnssFixType_GnssFixType3D
	if gps.Satellites == 0 {
		fixType = pb.GnssFixType_GnssFixTypeNone
	}

	return []*pb.Entity{{
		Id: entityID,
		Geo: &pb.GeoSpatialComponent{
			Latitude:  gps.Latitude,
			Longitude: gps.Longitude,
			Altitude:  &alt,
		},
		Kinematics: &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				East:  &velEast,
				North: &velNorth,
			},
		},
		Gnss: &pb.GnssComponent{
			FixType:        &fixType,
			SatellitesUsed: &sats,
		},
	}}
}

func handleBattery(payload []byte, entityID string) []*pb.Entity {
	bat, err := decodeBattery(payload)
	if err != nil {
		return nil
	}

	remaining := float32(bat.Remaining) / 100.0
	capUsed := float32(bat.CapacityUsed)

	return []*pb.Entity{{
		Id: entityID,
		Power: &pb.PowerComponent{
			Voltage:                &bat.Voltage,
			BatteryChargeRemaining: &remaining,
			CurrentA:               &bat.Current,
			CapacityUsedMah:        &capUsed,
		},
	}}
}

// ELRS RF mode index to label and approximate packet rate.
var elrsRFModes = map[uint8]struct {
	label string
	hz    uint32
}{
	0: {"4Hz", 4}, 1: {"25Hz", 25}, 2: {"50Hz", 50}, 3: {"100Hz", 100},
	4: {"100Hz Full", 100}, 5: {"150Hz", 150}, 6: {"200Hz", 200},
	7: {"250Hz", 250}, 8: {"500Hz", 500},
}

func handleLinkStats(payload []byte, entityID string) []*pb.Entity {
	ls, err := decodeLinkStats(payload)
	if err != nil {
		return nil
	}

	bestRSSI := ls.UplinkRSSI1
	if ls.UplinkRSSI2 > bestRSSI {
		bestRSSI = ls.UplinkRSSI2
	}
	snr := int32(ls.UplinkSNR)
	txPower := txPowerMilliwatts[ls.UplinkTXPower]
	lq := uint32(ls.UplinkLQ)
	ant := uint32(ls.ActiveAntenna)

	link := &pb.LinkComponent{
		RssiDbm:            &bestRSSI,
		SnrDb:              &snr,
		LastSeen:           timestamppb.New(time.Now()),
		LinkQualityPercent: &lq,
		TxPowerMw:          &txPower,
		ActiveAntenna:      &ant,
	}

	if rm, ok := elrsRFModes[ls.RFMode]; ok {
		link.RfMode = &rm.label
		link.PacketRateHz = &rm.hz
	}

	return []*pb.Entity{{
		Id:   entityID,
		Link: link,
	}}
}

func handleAttitude(payload []byte, entityID string) []*pb.Entity {
	att, err := decodeAttitude(payload)
	if err != nil {
		return nil
	}

	qx, qy, qz, qw := eulerToQuaternion(att.RollRad, att.PitchRad, att.YawRad)

	return []*pb.Entity{{
		Id: entityID,
		Orientation: &pb.OrientationComponent{
			Orientation: &pb.Quaternion{
				X: qx,
				Y: qy,
				Z: qz,
				W: qw,
			},
		},
	}}
}

func handleVario(payload []byte, entityID string) []*pb.Entity {
	v, err := decodeVario(payload)
	if err != nil {
		return nil
	}

	return []*pb.Entity{{
		Id: entityID,
		Kinematics: &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				Up: proto.Float64(v.VerticalSpeed),
			},
		},
	}}
}

func handleFlightMode(payload []byte, entityID string) []*pb.Entity {
	mode := decodeFlightMode(payload)
	if mode == "" {
		return nil
	}

	navMode := flightModeToNavMode(mode)
	emergency := strings.HasPrefix(mode, "!") // EdgeTX prefixes failsafe modes with "!"

	return []*pb.Entity{{
		Id: entityID,
		Navigation: &pb.NavigationComponent{
			Mode:      &navMode,
			Emergency: &emergency,
		},
	}}
}

func flightModeToNavMode(mode string) pb.NavigationMode {
	m := strings.ToUpper(strings.TrimPrefix(mode, "!"))
	switch {
	case m == "MANU" || m == "ACRO":
		return pb.NavigationMode_NavigationModeUnderway
	case m == "STAB" || m == "ANGL" || m == "HRZN" || m == "LEVL":
		return pb.NavigationMode_NavigationModeUnderway
	case m == "HOLD" || m == "PHLD" || m == "LOIT" || m == "LOITER":
		return pb.NavigationMode_NavigationModeLoitering
	case m == "AUTO" || m == "WAYP" || m == "WP" || m == "MISN":
		return pb.NavigationMode_NavigationModeAutonomous
	case m == "RTH" || m == "RTL" || m == "LAND":
		return pb.NavigationMode_NavigationModeReturning
	case m == "!FS!" || m == "FS" || m == "FAILSAFE":
		return pb.NavigationMode_NavigationModeUnspecified
	case strings.Contains(m, "GUID"):
		return pb.NavigationMode_NavigationModeGuided
	default:
		return pb.NavigationMode_NavigationModeUnderway
	}
}

func handleRCChannels(payload []byte, entityID string) []*pb.Entity {
	channels, err := decodeRCChannels(payload)
	if err != nil {
		return nil
	}

	now := timestamppb.Now()
	metrics := make([]*pb.Metric, 16)
	for i, ch := range channels {
		us := float64(int(ch)-992)*5.0/8.0 + 1500.0
		metrics[i] = &pb.Metric{
			Kind:       pb.MetricKind_MetricKindCount.Enum(),
			Unit:       pb.MetricUnit_MetricUnitCount,
			Label:      proto.String(fmt.Sprintf("CH%d", i+1)),
			Id:         proto.Uint32(uint32(40 + i)),
			Val:        &pb.Metric_Double{Double: us},
			MeasuredAt: now,
		}
	}

	return []*pb.Entity{{
		Id:     entityID,
		Metric: &pb.MetricComponent{Metrics: metrics},
	}}
}

func handleBaroAlt(payload []byte, entityID string) []*pb.Entity {
	if len(payload) < 3 {
		return nil
	}

	// Altitude: uint16 in decimeters with 10000 offset (10000 = 0m).
	// Vertical speed: int8 in m/s.
	raw := binary.BigEndian.Uint16(payload[0:2])
	vspeed := int8(payload[2])

	alt := float64(int(raw)-10000) / 10.0 // meters
	now := timestamppb.Now()

	return []*pb.Entity{{
		Id: entityID,
		Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
			{
				Kind:       pb.MetricKind_MetricKindDistance.Enum(),
				Unit:       pb.MetricUnit_MetricUnitMeter,
				Label:      proto.String("baro altitude"),
				Id:         proto.Uint32(13),
				Val:        &pb.Metric_Double{Double: alt},
				MeasuredAt: now,
			},
			{
				Kind:       pb.MetricKind_MetricKindSpeed.Enum(),
				Unit:       pb.MetricUnit_MetricUnitMeterPerSecond,
				Label:      proto.String("baro vspeed"),
				Id:         proto.Uint32(14),
				Val:        &pb.Metric_Double{Double: float64(vspeed)},
				MeasuredAt: now,
			},
		}},
	}}
}
