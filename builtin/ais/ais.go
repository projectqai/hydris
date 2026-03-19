package ais

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"math"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/BertoldVdb/go-ais"
	"github.com/adrianmo/go-nmea"
	"github.com/paulmach/orb"
	"github.com/paulmach/orb/geo"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type MessageFragment struct {
	fragments map[int64][]byte
	numParts  int64
	timestamp time.Time
}

type StreamConfig struct {
	Host                string   `json:"host"`
	Port                int      `json:"port"`
	EntityExpirySeconds int      `json:"entity_expiry_seconds"`
	Latitude            *float64 `json:"latitude"`
	Longitude           *float64 `json:"longitude"`
	RadiusKM            *float64 `json:"radius_km"`

	// Self position (receiver position from GPS RMC sentences)
	SelfEntityID     string `json:"self_entity_id"`
	SelfLabel        string `json:"self_label"`
	SelfSIDC         string `json:"self_sidc"`
	SelfAllowInvalid bool   `json:"self_allow_invalid"`
}

type AISVessel struct {
	MMSI               uint32
	Latitude           float64
	Longitude          float64
	Speed              float64
	Course             float64
	Heading            int
	Name               string
	Callsign           string
	Type               uint8
	PositionAccuracy   bool
	NavigationalStatus uint8
	LastSeen           time.Time
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "ais"

	streamSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"ui:groups": []any{
			map[string]any{"key": "connection", "title": "Connection"},
			map[string]any{"key": "filter", "title": "Geo Filter", "collapsed": true},
			map[string]any{"key": "self", "title": "Self Position", "collapsed": true},
		},
		"properties": map[string]any{
			"host": map[string]any{
				"type":           "string",
				"title":          "Host",
				"description":    "AIS data source hostname or IP",
				"ui:placeholder": "e.g. ais.example.com",
				"ui:group":       "connection",
				"ui:order":       0,
			},
			"port": map[string]any{
				"type":           "number",
				"title":          "Port",
				"description":    "AIS data source port",
				"minimum":        1,
				"maximum":        65535,
				"ui:placeholder": "e.g. 5631",
				"ui:group":       "connection",
				"ui:order":       1,
			},
			"entity_expiry_seconds": map[string]any{
				"type":        "number",
				"title":       "Entity Expiry",
				"description": "How long to keep vessels without updates",
				"default":     300,
				"minimum":     10,
				"ui:unit":     "s",
				"ui:group":    "connection",
				"ui:order":    2,
			},
			"latitude": map[string]any{
				"type":           "number",
				"title":          "Latitude",
				"description":    "Center latitude for geo filter",
				"ui:placeholder": "e.g. 48.8566",
				"ui:group":       "filter",
				"ui:order":       0,
			},
			"longitude": map[string]any{
				"type":           "number",
				"title":          "Longitude",
				"description":    "Center longitude for geo filter",
				"ui:placeholder": "e.g. 2.3522",
				"ui:group":       "filter",
				"ui:order":       1,
			},
			"radius_km": map[string]any{
				"type":        "number",
				"title":       "Radius",
				"description": "Only show vessels within this radius",
				"minimum":     0.1,
				"ui:unit":     "km",
				"ui:group":    "filter",
				"ui:order":    2,
			},
			"self_entity_id": map[string]any{
				"type":           "string",
				"title":          "Entity ID",
				"description":    "Custom entity ID for self position from GPS",
				"ui:placeholder": "e.g. ais.self.myboat",
				"ui:group":       "self",
				"ui:order":       0,
			},
			"self_label": map[string]any{
				"type":           "string",
				"title":          "Label",
				"description":    "Display label for self position",
				"ui:placeholder": "e.g. My Boat",
				"ui:group":       "self",
				"ui:order":       1,
			},
			"self_sidc": map[string]any{
				"type":           "string",
				"title":          "Symbol",
				"description":    "MIL-STD-2525C symbol code for self",
				"ui:placeholder": "e.g. SFSPXM----*****",
				"ui:group":       "self",
				"ui:order":       2,
			},
			"self_allow_invalid": map[string]any{
				"type":        "boolean",
				"title":       "Allow Invalid GPS",
				"description": "Accept GPS positions marked as void (no fix)",
				"default":     false,
				"ui:group":    "self",
				"ui:order":    3,
			},
		},
		"required": []any{"host", "port"},
	})

	serviceEntityID := controllerName + ".service"

	if err := controller.Push(ctx,
		&pb.Entity{
			Id:    serviceEntityID,
			Label: proto.String("AIS"),
			Controller: &pb.Controller{
				Id: &controllerName,
			},
			Device: &pb.DeviceComponent{
				Category: proto.String("Feeds"),
			},
			Configurable: &pb.ConfigurableComponent{
				SupportedDeviceClasses: []*pb.DeviceClassOption{
					{Class: "stream", Label: "AIS Stream"},
				},
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String("ship"),
			},
		},
	); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "stream", Label: "AIS Stream", Schema: streamSchema},
	}

	return controller.WatchChildren(ctx, serviceEntityID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			return runStream(ctx, logger, entity, ready)
		})
	})
}

func runStream(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	config := entity.Config
	if config == nil {
		return fmt.Errorf("entity %s has no config", entity.Id)
	}

	streamConfig, err := parseStreamConfig(config)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	if streamConfig.Host == "" || streamConfig.Port == 0 {
		return fmt.Errorf("host and port are required")
	}
	ready()

	if streamConfig.EntityExpirySeconds <= 0 {
		streamConfig.EntityExpirySeconds = 300
	}

	addr := net.JoinHostPort(streamConfig.Host, fmt.Sprintf("%d", streamConfig.Port))
	logger.Info("Starting AIS stream", "entityID", entity.Id, "address", addr)

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)
	aisDecoder := ais.CodecNew(false, false)
	aisDecoder.DropSpace = true

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
		if err != nil {
			logger.Error("Failed to connect", "error", err)
			time.Sleep(5 * time.Second)
			continue
		}

		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		scanner := bufio.NewScanner(conn)
		fragmentStore := make(map[int64]*MessageFragment)
		fragmentMu := sync.Mutex{}

		for scanner.Scan() {
			_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
			select {
			case <-ctx.Done():
				_ = conn.Close()
				return ctx.Err()
			default:
			}
			processAISLine(ctx, logger, scanner.Text(), aisDecoder, worldClient, "ais", entity.Id, streamConfig, fragmentStore, &fragmentMu)
		}

		if err := scanner.Err(); err != nil {
			logger.Error("Stream read error", "error", err)
		}

		_ = conn.Close()
		logger.Warn("Connection closed, reconnecting...", "entityID", entity.Id)
		time.Sleep(2 * time.Second)
	}
}

func processAISLine(ctx context.Context, logger *slog.Logger, line string, aisDecoder *ais.Codec, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, fragmentStore map[int64]*MessageFragment, fragmentMu *sync.Mutex) bool {
	if idx := strings.Index(line, "!"); idx >= 0 {
		line = line[idx:]
	} else if idx := strings.Index(line, "$"); idx >= 0 {
		line = line[idx:]
	} else {
		return false
	}

	s, err := nmea.Parse(line)
	if err != nil {
		return false
	}

	// Handle GPS RMC sentences (GPRMC)
	if rmc, ok := s.(nmea.RMC); ok {
		return processRMC(ctx, logger, rmc, worldClient, controllerName, trackerID, config)
	}

	vdm, ok := s.(nmea.VDMVDO)
	if !ok {
		return false
	}

	if vdm.NumFragments > 1 {
		fragmentMu.Lock()
		defer fragmentMu.Unlock()

		msgFrag, exists := fragmentStore[vdm.MessageID]
		if !exists {
			msgFrag = &MessageFragment{
				fragments: make(map[int64][]byte),
				numParts:  vdm.NumFragments,
				timestamp: time.Now(),
			}
			fragmentStore[vdm.MessageID] = msgFrag
		}

		msgFrag.fragments[vdm.FragmentNumber] = vdm.Payload

		if int64(len(msgFrag.fragments)) < vdm.NumFragments {
			return false
		}

		var completePayload []byte
		for i := int64(1); i <= vdm.NumFragments; i++ {
			fragment, ok := msgFrag.fragments[i]
			if !ok {
				return false
			}
			completePayload = append(completePayload, fragment...)
		}

		delete(fragmentStore, vdm.MessageID)

		packet := aisDecoder.DecodePacket(completePayload)
		if packet == nil {
			return false
		}

		return processAISPacket(ctx, logger, packet, worldClient, controllerName, trackerID, config)
	}

	packet := aisDecoder.DecodePacket(vdm.Payload)
	if packet == nil {
		return false
	}

	return processAISPacket(ctx, logger, packet, worldClient, controllerName, trackerID, config)
}

func processRMC(ctx context.Context, logger *slog.Logger, rmc nmea.RMC, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig) bool {
	// Skip invalid GPS fixes (V = void) unless configured to allow
	if rmc.Validity != "A" && !config.SelfAllowInvalid {
		return false
	}

	vessel := &AISVessel{
		MMSI:      0,
		Latitude:  rmc.Latitude,
		Longitude: rmc.Longitude,
		Speed:     rmc.Speed,
		Course:    rmc.Course,
		LastSeen:  time.Now(),
	}

	if !checkGeoFilter(vessel, config) {
		return false
	}

	entity := SelfToEntity(rmc, controllerName, trackerID, config)
	if entity == nil {
		return false
	}

	_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{entity},
	})
	if err != nil {
		logger.Error("Failed to push GPS position", "error", err)
		return false
	}

	return true
}

func processAISPacket(ctx context.Context, logger *slog.Logger, packet ais.Packet, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig) bool {
	switch msg := packet.(type) {
	case ais.PositionReport:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		vessel := &AISVessel{
			MMSI:               mmsi,
			Latitude:           float64(msg.Latitude),
			Longitude:          float64(msg.Longitude),
			Speed:              float64(msg.Sog),
			Course:             float64(msg.Cog),
			Heading:            int(msg.TrueHeading),
			PositionAccuracy:   msg.PositionAccuracy,
			NavigationalStatus: msg.NavigationalStatus,
			LastSeen:           time.Now(),
		}

		if !checkGeoFilter(vessel, config) {
			return false
		}

		entity := VesselToEntity(vessel, controllerName, trackerID, time.Duration(config.EntityExpirySeconds))
		if entity == nil {
			return false
		}

		_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		if err != nil {
			logger.Error("Failed to push vessel", "error", err)
			return false
		}

		return true

	case ais.StandardClassBPositionReport:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		vessel := &AISVessel{
			MMSI:             mmsi,
			Latitude:         float64(msg.Latitude),
			Longitude:        float64(msg.Longitude),
			Speed:            float64(msg.Sog),
			Course:           float64(msg.Cog),
			Heading:          int(msg.TrueHeading),
			PositionAccuracy: msg.PositionAccuracy,
			LastSeen:         time.Now(),
		}

		if !checkGeoFilter(vessel, config) {
			return false
		}

		entity := VesselToEntity(vessel, controllerName, trackerID, time.Duration(config.EntityExpirySeconds))
		if entity == nil {
			return false
		}

		_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		if err != nil {
			logger.Error("Failed to push vessel", "error", err)
			return false
		}

		return true

	case ais.ExtendedClassBPositionReport:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		vessel := &AISVessel{
			MMSI:             mmsi,
			Latitude:         float64(msg.Latitude),
			Longitude:        float64(msg.Longitude),
			Speed:            float64(msg.Sog),
			Course:           float64(msg.Cog),
			Heading:          int(msg.TrueHeading),
			Name:             msg.Name,
			Type:             msg.Type,
			PositionAccuracy: msg.PositionAccuracy,
			LastSeen:         time.Now(),
		}

		if !checkGeoFilter(vessel, config) {
			return false
		}

		entity := VesselToEntity(vessel, controllerName, trackerID, time.Duration(config.EntityExpirySeconds))
		if entity == nil {
			return false
		}

		_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		if err != nil {
			logger.Error("Failed to push vessel", "error", err)
			return false
		}

		return true

	case ais.ShipStaticData:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		entityID := fmt.Sprintf("mmsi:%d", mmsi)
		controllerID := controllerName

		mission := &pb.MissionComponent{}
		hasMission := false

		dest := strings.TrimSpace(msg.Destination)
		if dest != "" && dest != "@@@@@@@@@@@@@@@@@@@@" {
			mission.Destination = &dest
			hasMission = true
		}

		if msg.Eta.Month > 0 && msg.Eta.Day > 0 {
			now := time.Now()
			year := now.Year()
			eta := time.Date(year, time.Month(msg.Eta.Month), int(msg.Eta.Day),
				int(msg.Eta.Hour), int(msg.Eta.Minute), 0, 0, time.UTC)
			if eta.Before(now) {
				eta = eta.AddDate(1, 0, 0)
			}
			mission.Eta = timestamppb.New(eta)
			hasMission = true
		}

		transponderAIS := &pb.TransponderAIS{
			Mmsi: &mmsi,
		}
		if msg.ImoNumber > 0 {
			imo := msg.ImoNumber
			transponderAIS.Imo = &imo
		}
		cs := strings.TrimSpace(msg.CallSign)
		if cs != "" && cs != "@@@@@@" && cs != "@@@@@@@" {
			transponderAIS.Callsign = &cs
		}
		vn := strings.TrimSpace(msg.Name)
		if vn != "" && vn != "@@@@@@@@@@@@@@@@@@@@" {
			transponderAIS.VesselName = &vn
		}

		entity := &pb.Entity{
			Id: entityID,
			Controller: &pb.Controller{
				Id: &controllerID,
			},
			Track: &pb.TrackComponent{
				Tracker: &trackerID,
			},
			Transponder: &pb.TransponderComponent{
				Ais: transponderAIS,
			},
			Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		}

		name := strings.TrimSpace(msg.Name)
		if name != "" && name != "@@@@@@@@@@@@@@@@@@@@" {
			entity.Label = &name
		}

		if hasMission {
			entity.Mission = mission
		}

		_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		if err != nil {
			logger.Error("Failed to push vessel static data", "error", err)
			return false
		}

		return true
	}
	return false
}

func checkGeoFilter(vessel *AISVessel, config *StreamConfig) bool {
	if config.Latitude == nil || config.Longitude == nil || config.RadiusKM == nil {
		return true
	}

	center := orb.Point{*config.Longitude, *config.Latitude}
	vesselPoint := orb.Point{vessel.Longitude, vessel.Latitude}
	distanceKM := geo.Distance(center, vesselPoint) / 1000.0
	return distanceKM <= *config.RadiusKM
}

func VesselToEntity(vessel *AISVessel, controllerName string, trackerID string, expires time.Duration) *pb.Entity {
	entityID := fmt.Sprintf("mmsi:%d", vessel.MMSI)

	altitude := 0.0
	sidc := vesselTypeToSIDC(vessel.Type)

	// AIS position accuracy: true = DGPS (<10m), false = autonomous GNSS
	// Convert to variance (σ²) assuming EPU ≈ 2σ
	var posVar float64
	if vessel.PositionAccuracy {
		posVar = 25 // ~5m σ (DGPS)
	} else {
		posVar = 2500 // ~50m σ (autonomous GNSS)
	}

	var label *string
	if vessel.Name != "" {
		label = &vessel.Name
	} else if vessel.Callsign != "" {
		label = &vessel.Callsign
	}

	entity := &pb.Entity{
		Id:    entityID,
		Label: label,
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(expires * time.Second)),
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  vessel.Latitude,
			Longitude: vessel.Longitude,
			Altitude:  &altitude,
			Covariance: &pb.CovarianceMatrix{
				Mxx: &posVar,
				Myy: &posVar,
			},
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: sidc,
		},
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Track: &pb.TrackComponent{
			Tracker: &trackerID,
		},
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
	}

	entity.Transponder = &pb.TransponderComponent{
		Ais: &pb.TransponderAIS{
			Mmsi: &vessel.MMSI,
		},
	}
	if vessel.Callsign != "" {
		entity.Transponder.Ais.Callsign = &vessel.Callsign
	}
	if vessel.Name != "" {
		entity.Transponder.Ais.VesselName = &vessel.Name
	}

	navMode := aisNavStatusToNavMode(vessel.NavigationalStatus)
	entity.Navigation = &pb.NavigationComponent{
		Mode: &navMode,
	}

	if vessel.Course >= 0 && vessel.Course < 360 {
		rad := vessel.Course * math.Pi / 180.0
		halfRad := rad / 2.0
		sz := math.Sin(halfRad)
		cz := math.Cos(halfRad)
		entity.Orientation = &pb.OrientationComponent{
			Orientation: &pb.Quaternion{
				X: 0,
				Y: 0,
				Z: sz,
				W: cz,
			},
		}

		if vessel.Speed > 0 && vessel.Speed < 102.3 {
			speedMs := vessel.Speed * 0.514444
			east := speedMs * math.Sin(rad)
			north := speedMs * math.Cos(rad)
			entity.Kinematics = &pb.KinematicsComponent{
				VelocityEnu: &pb.KinematicsEnu{
					East:  &east,
					North: &north,
				},
			}
		}
	}

	return entity
}

func SelfToEntity(rmc nmea.RMC, controllerName string, trackerID string, config *StreamConfig) *pb.Entity {
	entityID := config.SelfEntityID
	if entityID == "" {
		entityID = fmt.Sprintf("ais.self.%s", trackerID)
	}

	label := config.SelfLabel
	if label == "" {
		label = "Self"
	}

	sidc := config.SelfSIDC
	if sidc == "" {
		sidc = "SFSPXM----*****"
	}

	altitude := 0.0

	entity := &pb.Entity{
		Id:    entityID,
		Label: &label,
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(time.Duration(config.EntityExpirySeconds) * time.Second)),
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  rmc.Latitude,
			Longitude: rmc.Longitude,
			Altitude:  &altitude,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: sidc,
		},
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Track: &pb.TrackComponent{
			Tracker: &trackerID,
		},
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
	}

	if rmc.Course >= 0 && rmc.Course < 360 {
		rad := rmc.Course * math.Pi / 180.0
		halfRad := rad / 2.0
		sz := math.Sin(halfRad)
		cz := math.Cos(halfRad)
		entity.Orientation = &pb.OrientationComponent{
			Orientation: &pb.Quaternion{
				X: 0,
				Y: 0,
				Z: sz,
				W: cz,
			},
		}

		if rmc.Speed > 0 {
			speedMs := rmc.Speed * 0.514444
			east := speedMs * math.Sin(rad)
			north := speedMs * math.Cos(rad)
			entity.Kinematics = &pb.KinematicsComponent{
				VelocityEnu: &pb.KinematicsEnu{
					East:  &east,
					North: &north,
				},
			}
		}
	}

	return entity
}

func aisNavStatusToNavMode(navStatus uint8) pb.NavigationMode {
	switch navStatus {
	case 1, 5, 6: // at anchor, moored, aground
		return pb.NavigationMode_NavigationModeStationary
	case 0, 2, 3, 4, 7, 8: // under way, not under command, restricted, constrained, fishing, sailing
		return pb.NavigationMode_NavigationModeUnderway
	default:
		return pb.NavigationMode_NavigationModeUnspecified
	}
}

func vesselTypeToSIDC(shipType uint8) string {
	return "SFSPXM----*****"
}

func parseStreamConfig(config *pb.ConfigurationComponent) (*StreamConfig, error) {
	if config.Value == nil || config.Value.Fields == nil {
		return nil, fmt.Errorf("empty config value")
	}

	fields := config.Value.Fields
	streamConfig := &StreamConfig{}

	if v, ok := fields["host"]; ok {
		streamConfig.Host = v.GetStringValue()
	}
	if v, ok := fields["port"]; ok {
		streamConfig.Port = int(v.GetNumberValue())
	}
	if v, ok := fields["entity_expiry_seconds"]; ok {
		streamConfig.EntityExpirySeconds = int(v.GetNumberValue())
	}
	if v, ok := fields["latitude"]; ok {
		lat := v.GetNumberValue()
		streamConfig.Latitude = &lat
	}
	if v, ok := fields["longitude"]; ok {
		lon := v.GetNumberValue()
		streamConfig.Longitude = &lon
	}
	if v, ok := fields["radius_km"]; ok {
		radius := v.GetNumberValue()
		streamConfig.RadiusKM = &radius
	}
	if v, ok := fields["self_entity_id"]; ok {
		streamConfig.SelfEntityID = v.GetStringValue()
	}
	if v, ok := fields["self_label"]; ok {
		streamConfig.SelfLabel = v.GetStringValue()
	}
	if v, ok := fields["self_sidc"]; ok {
		streamConfig.SelfSIDC = v.GetStringValue()
	}
	if v, ok := fields["self_allow_invalid"]; ok {
		streamConfig.SelfAllowInvalid = v.GetBoolValue()
	}

	return streamConfig, nil
}

func init() {
	builtin.Register("ais", Run)
}
