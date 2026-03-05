package mavlink

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "mavlink"

	schema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"ui:groups": []any{
			map[string]any{"key": "connection", "title": "Connection"},
			map[string]any{"key": "entity", "title": "Entity", "collapsed": true},
		},
		"properties": map[string]any{
			"transport": map[string]any{
				"type":    "string",
				"title":   "Transport",
				"default": "udp_server",
				"oneOf": []any{
					map[string]any{"const": "udp_server", "title": "UDP Server", "description": "Listen for incoming UDP (vehicle connects to us)"},
					map[string]any{"const": "udp_client", "title": "UDP Client", "description": "Connect to a UDP endpoint (e.g. SITL)"},
					map[string]any{"const": "tcp_client", "title": "TCP Client", "description": "Connect to a TCP endpoint"},
					map[string]any{"const": "tcp_server", "title": "TCP Server", "description": "Listen for incoming TCP connections"},
				},
				"ui:group": "connection",
				"ui:order": 0,
			},
			"address": map[string]any{
				"type":           "string",
				"title":          "Address",
				"description":    "Listen or connect address (host:port)",
				"default":        "0.0.0.0:14550",
				"ui:placeholder": "e.g. 0.0.0.0:14550",
				"ui:group":       "connection",
				"ui:order":       1,
			},
			"entity_expiry_seconds": map[string]any{
				"type":        "number",
				"title":       "Entity Expiry",
				"description": "How long to keep vehicles without updates",
				"default":     60,
				"minimum":     5,
				"ui:unit":     "s",
				"ui:group":    "connection",
				"ui:order":    2,
			},
			"stream_request": map[string]any{
				"type":        "boolean",
				"title":       "Request Streams",
				"description": "Request telemetry streams from ArduPilot vehicles",
				"default":     true,
				"ui:group":    "connection",
				"ui:order":    3,
			},
			"stream_rate_hz": map[string]any{
				"type":        "number",
				"title":       "Stream Rate",
				"description": "Requested telemetry rate",
				"default":     4,
				"minimum":     1,
				"maximum":     50,
				"ui:unit":     "Hz",
				"ui:group":    "connection",
				"ui:order":    4,
			},
			"mavlink_version": map[string]any{
				"type":        "number",
				"title":       "MAVLink Version",
				"description": "Protocol version for outgoing frames (1 or 2)",
				"enum":        []any{1, 2},
				"default":     2,
				"ui:group":    "connection",
				"ui:order":    5,
			},
			"entity_prefix": map[string]any{
				"type":           "string",
				"title":          "Entity Prefix",
				"description":    "Prefix for entity IDs (default: mavlink)",
				"ui:placeholder": "mavlink",
				"ui:group":       "entity",
				"ui:order":       0,
			},
			"sidc": map[string]any{
				"type":           "string",
				"title":          "Symbol",
				"description":    "MIL-STD-2525C symbol code override",
				"ui:placeholder": "e.g. SFAPMF----*****",
				"ui:group":       "entity",
				"ui:order":       1,
			},
		},
		"required": []any{"address"},
	})

	serviceEntityID := controllerName + ".service"

	if err := controller.Push(ctx,
		&pb.Entity{
			Id:    serviceEntityID,
			Label: proto.String("MAVLink"),
			Controller: &pb.Controller{
				Id: &controllerName,
			},
			Device: &pb.DeviceComponent{
				Category: proto.String("Vehicles"),
			},
			Configurable: &pb.ConfigurableComponent{
				SupportedDeviceClasses: []*pb.DeviceClassOption{
					{Class: "endpoint", Label: "MAVLink Endpoint"},
				},
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String("radio"),
			},
		},
	); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "endpoint", Label: "MAVLink Endpoint", Schema: schema},
	}

	return controller.WatchChildren(ctx, serviceEntityID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			ready()
			return runEndpoint(ctx, logger, entity)
		})
	})
}

type endpointConfig struct {
	Transport           string `json:"transport"`
	Address             string `json:"address"`
	EntityExpirySeconds int    `json:"entity_expiry_seconds"`
	StreamRequest       bool   `json:"stream_request"`
	StreamRateHz        int    `json:"stream_rate_hz"`
	MavlinkVersion      int    `json:"mavlink_version"`
	EntityPrefix        string `json:"entity_prefix"`
	SIDC                string `json:"sidc"`
}

func parseConfig(config *pb.ConfigurationComponent) (*endpointConfig, error) {
	if config.Value == nil || config.Value.Fields == nil {
		return nil, fmt.Errorf("empty config value")
	}

	fields := config.Value.Fields
	c := &endpointConfig{
		Transport:           "udp_server",
		Address:             "0.0.0.0:14550",
		EntityExpirySeconds: 60,
		StreamRequest:       true,
		StreamRateHz:        4,
		MavlinkVersion:      2,
		EntityPrefix:        "mavlink",
	}

	if v, ok := fields["transport"]; ok {
		c.Transport = v.GetStringValue()
	}
	if v, ok := fields["address"]; ok {
		c.Address = v.GetStringValue()
	}
	if v, ok := fields["entity_expiry_seconds"]; ok {
		c.EntityExpirySeconds = int(v.GetNumberValue())
	}
	if v, ok := fields["stream_request"]; ok {
		c.StreamRequest = v.GetBoolValue()
	}
	if v, ok := fields["stream_rate_hz"]; ok {
		c.StreamRateHz = int(v.GetNumberValue())
	}
	if v, ok := fields["mavlink_version"]; ok {
		c.MavlinkVersion = int(v.GetNumberValue())
	}
	if v, ok := fields["entity_prefix"]; ok && v.GetStringValue() != "" {
		c.EntityPrefix = v.GetStringValue()
	}
	if v, ok := fields["sidc"]; ok {
		c.SIDC = v.GetStringValue()
	}

	return c, nil
}

func runEndpoint(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	config := entity.Config
	if config == nil {
		return fmt.Errorf("entity %s has no config", entity.Id)
	}
	cfg, err := parseConfig(config)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	if cfg.Address == "" {
		return fmt.Errorf("address is required")
	}

	var endpoint gomavlib.EndpointConf
	switch cfg.Transport {
	case "udp_server":
		endpoint = gomavlib.EndpointUDPServer{Address: cfg.Address}
	case "udp_client":
		endpoint = gomavlib.EndpointUDPClient{Address: cfg.Address}
	case "tcp_client":
		endpoint = gomavlib.EndpointTCPClient{Address: cfg.Address}
	case "tcp_server":
		endpoint = gomavlib.EndpointTCPServer{Address: cfg.Address}
	default:
		return fmt.Errorf("unknown transport: %s", cfg.Transport)
	}

	outVersion := gomavlib.V2
	if cfg.MavlinkVersion == 1 {
		outVersion = gomavlib.V1
	}

	node := &gomavlib.Node{
		Endpoints:              []gomavlib.EndpointConf{endpoint},
		Dialect:                common.Dialect,
		OutVersion:             outVersion,
		HeartbeatDisable:       false,
		StreamRequestEnable:    cfg.StreamRequest,
		StreamRequestFrequency: cfg.StreamRateHz,
		OutSystemID:            254, // GCS
	}

	if err := node.Initialize(); err != nil {
		return fmt.Errorf("mavlink node init: %w", err)
	}
	defer node.Close()

	logger.Info("MAVLink endpoint started", "transport", cfg.Transport, "address", cfg.Address)

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)
	controllerName := "mavlink"
	trackerID := entity.Id
	startedAt := timestamppb.Now()

	var messagesReceived, entitiesPushed uint64

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case evt, ok := <-node.Events():
			if !ok {
				return fmt.Errorf("mavlink node closed")
			}

			evtFrame, ok := evt.(*gomavlib.EventFrame)
			if !ok {
				continue
			}

			messagesReceived++

			sysID := evtFrame.SystemID()
			compID := evtFrame.ComponentID()
			entityID := fmt.Sprintf("%s.%d.%d", cfg.EntityPrefix, sysID, compID)
			expiry := time.Duration(cfg.EntityExpirySeconds) * time.Second

			var ent *pb.Entity

			switch msg := evtFrame.Message().(type) {
			case *common.MessageHeartbeat:
				ent = heartbeatToEntity(entityID, controllerName, trackerID, startedAt, msg, cfg, expiry)

			case *common.MessageGlobalPositionInt:
				ent = globalPositionToEntity(entityID, controllerName, trackerID, startedAt, msg, expiry)

			case *common.MessageAttitude:
				ent = attitudeToEntity(entityID, controllerName, trackerID, startedAt, msg, expiry)

			case *common.MessageSysStatus:
				ent = sysStatusToEntity(entityID, controllerName, trackerID, startedAt, msg, expiry)

			case *common.MessageBatteryStatus:
				ent = batteryStatusToEntity(entityID, controllerName, trackerID, startedAt, msg, expiry)

			case *common.MessageVfrHud:
				ent = vfrHudToEntity(entityID, controllerName, trackerID, startedAt, msg, expiry)

			case *common.MessageGpsRawInt:
				ent = gpsRawToEntity(entityID, controllerName, trackerID, startedAt, msg, expiry)

			case *common.MessageMissionCurrent:
				ent = missionCurrentToEntity(entityID, controllerName, trackerID, startedAt, msg, expiry)
			}

			if ent == nil {
				continue
			}

			if _, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{ent},
			}); err != nil {
				logger.Error("Failed to push entity", "entityID", entityID, "error", err)
			} else {
				entitiesPushed++
				_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
					Changes: []*pb.Entity{{
						Id: entity.Id,
						Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
							{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("messages received"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: messagesReceived}},
							{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("entities pushed"), Id: proto.Uint32(2), Val: &pb.Metric_Uint64{Uint64: entitiesPushed}},
						}},
					}},
				})
			}
		}
	}
}

func baseEntity(entityID, controllerName, trackerID string, startedAt *timestamppb.Timestamp, expiry time.Duration) *pb.Entity {
	return &pb.Entity{
		Id: entityID,
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Track: &pb.TrackComponent{
			Tracker: &trackerID,
		},
		Lifetime: &pb.Lifetime{
			From:  startedAt,
			Until: timestamppb.New(time.Now().Add(expiry)),
			Fresh: timestamppb.Now(),
		},
	}
}

func heartbeatToEntity(entityID, controllerName, trackerID string, startedAt *timestamppb.Timestamp, msg *common.MessageHeartbeat, cfg *endpointConfig, expiry time.Duration) *pb.Entity {
	// Skip non-vehicle heartbeats (GCS, etc.)
	if msg.Type == common.MAV_TYPE_GCS || msg.Type == common.MAV_TYPE_ANTENNA_TRACKER {
		return nil
	}

	ent := baseEntity(entityID, controllerName, trackerID, startedAt, expiry)

	sidc := cfg.SIDC
	if sidc == "" {
		sidc = mavTypeToSIDC(msg.Type)
	}
	ent.Symbol = &pb.SymbolComponent{
		MilStd2525C: sidc,
	}

	armed := msg.BaseMode&common.MAV_MODE_FLAG_SAFETY_ARMED != 0
	emergency := msg.SystemStatus == common.MAV_STATE_EMERGENCY || msg.SystemStatus == common.MAV_STATE_CRITICAL
	navMode := mavModeToNavMode(msg.BaseMode, msg.CustomMode)

	ent.Navigation = &pb.NavigationComponent{
		Mode:      &navMode,
		Armed:     &armed,
		Emergency: &emergency,
	}

	label := mavTypeLabel(msg.Type)
	ent.Label = &label

	return ent
}

func globalPositionToEntity(entityID, controllerName, trackerID string, startedAt *timestamppb.Timestamp, msg *common.MessageGlobalPositionInt, expiry time.Duration) *pb.Entity {
	lat := float64(msg.Lat) / 1e7
	lon := float64(msg.Lon) / 1e7
	alt := float64(msg.Alt) / 1000.0

	if lat == 0 && lon == 0 {
		return nil
	}

	ent := baseEntity(entityID, controllerName, trackerID, startedAt, expiry)
	ent.Geo = &pb.GeoSpatialComponent{
		Latitude:  lat,
		Longitude: lon,
		Altitude:  &alt,
	}

	// MAVLink velocity: Vx=North (cm/s), Vy=East (cm/s), Vz=Down (cm/s)
	// Convert to ENU m/s
	east := float64(msg.Vy) / 100.0
	north := float64(msg.Vx) / 100.0
	up := float64(-msg.Vz) / 100.0

	if east != 0 || north != 0 || up != 0 {
		ent.Kinematics = &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				East:  &east,
				North: &north,
				Up:    &up,
			},
		}
	}

	// Heading from velocity or hdg field
	if msg.Hdg != 65535 {
		hdgRad := float64(msg.Hdg) / 100.0 * math.Pi / 180.0
		halfRad := hdgRad / 2.0
		ent.Orientation = &pb.OrientationComponent{
			Orientation: &pb.Quaternion{
				X: 0,
				Y: 0,
				Z: math.Sin(halfRad),
				W: math.Cos(halfRad),
			},
		}
	}

	return ent
}

func attitudeToEntity(entityID, controllerName, trackerID string, startedAt *timestamppb.Timestamp, msg *common.MessageAttitude, expiry time.Duration) *pb.Entity {
	ent := baseEntity(entityID, controllerName, trackerID, startedAt, expiry)

	// Convert Euler angles (roll, pitch, yaw) to quaternion
	// MAVLink uses aerospace convention: ZYX intrinsic
	cr := math.Cos(float64(msg.Roll) / 2)
	sr := math.Sin(float64(msg.Roll) / 2)
	cp := math.Cos(float64(msg.Pitch) / 2)
	sp := math.Sin(float64(msg.Pitch) / 2)
	cy := math.Cos(float64(msg.Yaw) / 2)
	sy := math.Sin(float64(msg.Yaw) / 2)

	rollRate := float64(msg.Rollspeed)
	pitchRate := float64(msg.Pitchspeed)
	yawRate := float64(msg.Yawspeed)

	ent.Orientation = &pb.OrientationComponent{
		Orientation: &pb.Quaternion{
			W: cr*cp*cy + sr*sp*sy,
			X: sr*cp*cy - cr*sp*sy,
			Y: cr*sp*cy + sr*cp*sy,
			Z: cr*cp*sy - sr*sp*cy,
		},
	}

	ent.Kinematics = &pb.KinematicsComponent{
		AngularVelocityBody: &pb.AngularVelocity{
			RollRate:  rollRate,
			PitchRate: pitchRate,
			YawRate:   yawRate,
		},
	}

	return ent
}

func sysStatusToEntity(entityID, controllerName, trackerID string, startedAt *timestamppb.Timestamp, msg *common.MessageSysStatus, expiry time.Duration) *pb.Entity {
	ent := baseEntity(entityID, controllerName, trackerID, startedAt, expiry)

	power := &pb.PowerComponent{}
	hasPower := false

	if msg.BatteryRemaining >= 0 && msg.BatteryRemaining <= 100 {
		remaining := float32(msg.BatteryRemaining) / 100.0
		power.BatteryChargeRemaining = &remaining
		hasPower = true
	}

	if msg.VoltageBattery != 65535 {
		voltage := float32(msg.VoltageBattery) / 1000.0
		power.Voltage = &voltage
		hasPower = true
	}

	if hasPower {
		ent.Power = power
	}

	return ent
}

func batteryStatusToEntity(entityID, controllerName, trackerID string, startedAt *timestamppb.Timestamp, msg *common.MessageBatteryStatus, expiry time.Duration) *pb.Entity {
	ent := baseEntity(entityID, controllerName, trackerID, startedAt, expiry)

	power := &pb.PowerComponent{}
	hasPower := false

	if msg.BatteryRemaining >= 0 && msg.BatteryRemaining <= 100 {
		remaining := float32(msg.BatteryRemaining) / 100.0
		power.BatteryChargeRemaining = &remaining
		hasPower = true
	}

	if msg.TimeRemaining > 0 {
		remaining := uint32(msg.TimeRemaining)
		power.RemainingSeconds = &remaining
		hasPower = true
	}

	// Sum cell voltages for total voltage
	var totalMv uint32
	for _, v := range msg.Voltages {
		if v != 65535 {
			totalMv += uint32(v)
		}
	}
	if totalMv > 0 {
		voltage := float32(totalMv) / 1000.0
		power.Voltage = &voltage
		hasPower = true
	}

	if hasPower {
		ent.Power = power
	}

	return ent
}

func vfrHudToEntity(entityID, controllerName, trackerID string, startedAt *timestamppb.Timestamp, msg *common.MessageVfrHud, expiry time.Duration) *pb.Entity {
	ent := baseEntity(entityID, controllerName, trackerID, startedAt, expiry)

	// Use groundspeed + heading to produce ENU velocity
	if msg.Groundspeed > 0 && msg.Heading >= 0 && msg.Heading < 360 {
		hdgRad := float64(msg.Heading) * math.Pi / 180.0
		east := float64(msg.Groundspeed) * math.Sin(hdgRad)
		north := float64(msg.Groundspeed) * math.Cos(hdgRad)
		up := float64(msg.Climb)

		ent.Kinematics = &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				East:  &east,
				North: &north,
				Up:    &up,
			},
		}
	}

	return ent
}

func gpsRawToEntity(entityID, controllerName, trackerID string, startedAt *timestamppb.Timestamp, msg *common.MessageGpsRawInt, expiry time.Duration) *pb.Entity {
	if msg.FixType == common.GPS_FIX_TYPE_NO_GPS || msg.FixType == common.GPS_FIX_TYPE_NO_FIX {
		return nil
	}

	lat := float64(msg.Lat) / 1e7
	lon := float64(msg.Lon) / 1e7

	if lat == 0 && lon == 0 {
		return nil
	}

	ent := baseEntity(entityID, controllerName, trackerID, startedAt, expiry)

	geo := &pb.GeoSpatialComponent{
		Latitude:  lat,
		Longitude: lon,
	}

	if msg.Alt != 0 {
		alt := float64(msg.Alt) / 1000.0
		geo.Altitude = &alt
	}

	// HDOP/VDOP to covariance approximation
	// EPE ≈ HDOP * 5m (typical UERE), variance = EPE²
	if msg.Eph != 65535 {
		hdop := float64(msg.Eph) / 100.0
		posVar := math.Pow(hdop*5.0, 2)
		geo.Covariance = &pb.CovarianceMatrix{
			Mxx: &posVar,
			Myy: &posVar,
		}
		if msg.Epv != 65535 {
			vdop := float64(msg.Epv) / 100.0
			altVar := math.Pow(vdop*5.0, 2)
			geo.Covariance.Mzz = &altVar
		}
	}

	ent.Geo = geo
	return ent
}

func missionCurrentToEntity(entityID, controllerName, trackerID string, startedAt *timestamppb.Timestamp, msg *common.MessageMissionCurrent, expiry time.Duration) *pb.Entity {
	ent := baseEntity(entityID, controllerName, trackerID, startedAt, expiry)

	wpCurrent := uint32(msg.Seq)
	nav := &pb.NavigationComponent{
		WaypointCurrent: &wpCurrent,
	}

	if msg.Total != 65535 {
		wpTotal := uint32(msg.Total)
		nav.WaypointTotal = &wpTotal
	}

	ent.Navigation = nav
	return ent
}

// mavTypeToSIDC returns a MIL-STD-2525C symbol code for a MAVLink vehicle type.
func mavTypeToSIDC(t common.MAV_TYPE) string {
	switch t {
	case common.MAV_TYPE_FIXED_WING:
		return "SFAPMF----*****" // friendly air fixed wing
	case common.MAV_TYPE_QUADROTOR, common.MAV_TYPE_HEXAROTOR, common.MAV_TYPE_OCTOROTOR,
		common.MAV_TYPE_TRICOPTER, common.MAV_TYPE_COAXIAL:
		return "SFAPMFR---*****" // friendly air rotary wing
	case common.MAV_TYPE_HELICOPTER:
		return "SFAPMFR---*****" // friendly air rotary wing
	case common.MAV_TYPE_GROUND_ROVER:
		return "SFGPUC----*****" // friendly ground vehicle
	case common.MAV_TYPE_SURFACE_BOAT:
		return "SFSPXM----*****" // friendly sea surface
	case common.MAV_TYPE_SUBMARINE:
		return "SFUPXM----*****" // friendly subsurface
	default:
		return "SFAPMF----*****" // default to air
	}
}

// mavModeToNavMode maps MAVLink base mode flags to our NavigationMode.
func mavModeToNavMode(baseMode common.MAV_MODE_FLAG, _ uint32) pb.NavigationMode {
	if baseMode&common.MAV_MODE_FLAG_AUTO_ENABLED != 0 {
		return pb.NavigationMode_NavigationModeAutonomous
	}
	if baseMode&common.MAV_MODE_FLAG_GUIDED_ENABLED != 0 {
		return pb.NavigationMode_NavigationModeGuided
	}
	if baseMode&common.MAV_MODE_FLAG_STABILIZE_ENABLED != 0 || baseMode&common.MAV_MODE_FLAG_MANUAL_INPUT_ENABLED != 0 {
		return pb.NavigationMode_NavigationModeUnderway
	}
	return pb.NavigationMode_NavigationModeUnspecified
}

// mavTypeLabel returns a human-readable label for the MAV_TYPE.
func mavTypeLabel(t common.MAV_TYPE) string {
	switch t {
	case common.MAV_TYPE_FIXED_WING:
		return "Fixed Wing"
	case common.MAV_TYPE_QUADROTOR:
		return "Quadrotor"
	case common.MAV_TYPE_HEXAROTOR:
		return "Hexarotor"
	case common.MAV_TYPE_OCTOROTOR:
		return "Octorotor"
	case common.MAV_TYPE_TRICOPTER:
		return "Tricopter"
	case common.MAV_TYPE_HELICOPTER:
		return "Helicopter"
	case common.MAV_TYPE_COAXIAL:
		return "Coaxial"
	case common.MAV_TYPE_GROUND_ROVER:
		return "Rover"
	case common.MAV_TYPE_SURFACE_BOAT:
		return "Boat"
	case common.MAV_TYPE_SUBMARINE:
		return "Submarine"
	case common.MAV_TYPE_AIRSHIP:
		return "Airship"
	case common.MAV_TYPE_ROCKET:
		return "Rocket"
	default:
		return "UAV"
	}
}

func init() {
	builtin.Register("mavlink", Run)
}
