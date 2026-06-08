package nmea

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
	"golang.org/x/sync/errgroup"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type MessageFragment struct {
	fragments map[int64][]byte
	numParts  int64
	timestamp time.Time
}

type StreamState struct {
	fragments   map[int64]*MessageFragment
	fragmentMu  sync.Mutex
	lastGoodGGA time.Time

	lastVelocityEast  *float64
	lastVelocityNorth *float64
	lastYawRate       *float64

	lastPosGGA     time.Time
	lastPosRMC     time.Time
	lastPosAIS     time.Time
	lastHeadingHDT time.Time
	lastHeadingOSD time.Time
	lastVelVTG     time.Time
	lastVelOSD     time.Time
	lastVelRMC     time.Time

	linesTotal   uint64
	linesInvalid uint64
	linesRMC     uint64
	linesGGA     uint64
	linesHDT     uint64
	linesROT     uint64
	linesVTG     uint64
	linesMWV     uint64
	linesDPT     uint64
	linesAIS     uint64
	linesOSD     uint64
	linesRSD     uint64
	linesOther   uint64
	lastMetrics  time.Time
}

type StreamConfig struct {
	Address             string   `json:"address"`
	EntityExpirySeconds int      `json:"entity_expiry_seconds"`
	Latitude            *float64 `json:"latitude"`
	Longitude           *float64 `json:"longitude"`
	RadiusKM            *float64 `json:"radius_km"`

	SelfClass          string `json:"self_class"`
	SelfPositionSource string `json:"self_position_source"`
	SelfHeadingSource  string `json:"self_heading_source"`
	SelfVelocitySource string `json:"self_velocity_source"`
	SelfMMSI           uint32 `json:"self_mmsi"`
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
	controllerName := "nmea"

	sharedProps := func() map[string]any {
		return map[string]any{
			"entity_expiry_seconds": map[string]any{
				"type":        "number",
				"title":       "Entity Expiry",
				"description": "How long to keep tracks without updates",
				"default":     300,
				"minimum":     10,
				"ui:unit":     "s",
				"ui:group":    "connection",
				"ui:order":    10,
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
				"description": "Only emit tracks within this radius",
				"ui:unit":     "km",
				"ui:group":    "filter",
				"ui:order":    2,
			},
			"self_class": map[string]any{
				"type":        "string",
				"title":       "Standalone",
				"description": "Emit the receiver itself as standalone vehicle",
				"default":     "none",
				"enum":        []any{"none", "vehicle_sea", "vehicle_land", "vehicle_air", "equipment_sensor", "person"},
				"ui:group":    "self",
				"ui:order":    0,
			},
			"self_position_source": map[string]any{
				"type":        "string",
				"title":       "Position Source",
				"description": "Which NMEA sentence to use for self position (best = GGA > RMC > AIS, desperate = same but also accepts void RMC)",
				"default":     "best",
				"enum":        []any{"best", "desperate", "gga", "rmc", "ais"},
				"ui:group":    "self",
				"ui:order":    1,
			},
			"self_heading_source": map[string]any{
				"type":        "string",
				"title":       "Heading Source",
				"description": "Which NMEA sentence to use for heading (best = HDT > OSD > AIS)",
				"default":     "best",
				"enum":        []any{"best", "hdt", "osd", "ais"},
				"ui:group":    "self",
				"ui:order":    2,
			},
			"self_velocity_source": map[string]any{
				"type":        "string",
				"title":       "Velocity Source",
				"description": "Which NMEA sentence to use for speed/course (best = VTG > OSD > RMC > AIS)",
				"default":     "best",
				"enum":        []any{"best", "vtg", "osd", "rmc", "ais"},
				"ui:group":    "self",
				"ui:order":    3,
			},
			"self_mmsi": map[string]any{
				"type":        "number",
				"title":       "Own MMSI",
				"description": "Treat this MMSI from AIS as own ship position",
				"minimum":     0,
				"ui:group":    "self",
				"ui:order":    5,
			},
		}
	}

	uiGroups := []any{
		map[string]any{"key": "connection", "title": "Connection"},
		map[string]any{"key": "self", "title": "Self Position", "collapsed": false},
		map[string]any{"key": "filter", "title": "Geo Filter", "collapsed": true},
	}

	makeSchema := func(addressField map[string]any) *structpb.Struct {
		props := sharedProps()
		props["address"] = addressField
		s, _ := structpb.NewStruct(map[string]any{
			"type":       "object",
			"ui:groups":  uiGroups,
			"properties": props,
			"required":   []any{"address"},
		})
		return s
	}

	tcpClientSchema := makeSchema(map[string]any{
		"type":           "string",
		"title":          "Address",
		"description":    "Remote NMEA sources, comma-separated (host:port)",
		"ui:placeholder": "e.g. 10.0.0.1:8000,10.0.0.1:8001",
		"ui:group":       "connection",
		"ui:order":       0,
	})

	tcpServerSchema := makeSchema(map[string]any{
		"type":           "string",
		"title":          "Listen Address",
		"description":    "TCP listen address (host:port, host empty = all interfaces)",
		"default":        ":10110",
		"ui:placeholder": "e.g. :10110",
		"ui:group":       "connection",
		"ui:order":       0,
	})

	udpServerSchema := makeSchema(map[string]any{
		"type":           "string",
		"title":          "Listen Address",
		"description":    "UDP listen address (host:port, host empty = all interfaces)",
		"default":        ":10110",
		"ui:placeholder": "e.g. :10110",
		"ui:group":       "connection",
		"ui:order":       0,
	})

	serviceEntityID := controllerName + ".service"

	if err := controller.Push(ctx, controllerName,
		&pb.Entity{
			Id:    serviceEntityID,
			Label: proto.String("NMEA"),
			Controller: &pb.Controller{
				Id: &controllerName,
			},
			Device: &pb.DeviceComponent{
				Category: proto.String("Feeds"),
			},
			Configurable: &pb.ConfigurableComponent{
				SupportedDeviceClasses: []*pb.DeviceClassOption{
					{
						Class:       "tcp_client",
						Label:       "NMEA TCP Client",
						Description: "Connect to a remote NMEA 0183 TCP source. Use this when an upstream server publishes NMEA sentences (AIS feeds, GPS aggregators, marine traffic). Parses AIS reports and GPS RMC self-position.",
					},
					{
						Class:       "tcp_server",
						Label:       "NMEA TCP Server",
						Description: "Listen for inbound TCP connections that send NMEA 0183 sentences. Use this when devices dial in to publish their NMEA data. Each client gets its own AIS fragment reassembly state.",
					},
					{
						Class:       "udp_server",
						Label:       "NMEA UDP Server",
						Description: "Listen for inbound UDP packets containing NMEA 0183 sentences. Use this for GPS receivers or NMEA devices that broadcast over UDP (default port 10110).",
					},
				},
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String("satellite-dish"),
			},
		},
	); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "tcp_client", Label: "NMEA TCP Client", Schema: tcpClientSchema},
		{Class: "tcp_server", Label: "NMEA TCP Server", Schema: tcpServerSchema},
		{Class: "udp_server", Label: "NMEA UDP Server", Schema: udpServerSchema},
	}

	return controller.WatchChildren(ctx, controllerName, serviceEntityID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, controllerName, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			switch entity.Device.GetClass() {
			case "tcp_client":
				return runTCPClient(ctx, logger, entity, ready)
			case "tcp_server":
				return runTCPServer(ctx, logger, entity, ready)
			case "udp_server":
				return runUDPServer(ctx, logger, entity, ready)
			default:
				return fmt.Errorf("unknown device class: %s", entity.Device.GetClass())
			}
		})
	})
}

func splitAddresses(s string) []string {
	var addrs []string
	for _, a := range strings.Split(s, ",") {
		a = strings.TrimSpace(a)
		if a != "" {
			addrs = append(addrs, a)
		}
	}
	return addrs
}

func setupStream(entity *pb.Entity) (*StreamConfig, pb.WorldServiceClient, *ais.Codec, func(), error) {
	if entity.Config == nil {
		return nil, nil, nil, nil, fmt.Errorf("entity %s has no config", entity.Id)
	}
	cfg, err := parseStreamConfig(entity.Config)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("parse config: %w", err)
	}
	if cfg.Address == "" {
		return nil, nil, nil, nil, fmt.Errorf("address is required")
	}
	if cfg.EntityExpirySeconds <= 0 {
		cfg.EntityExpirySeconds = 300
	}
	if cfg.SelfPositionSource == "" {
		cfg.SelfPositionSource = "best"
	}
	if cfg.SelfHeadingSource == "" {
		cfg.SelfHeadingSource = "best"
	}
	if cfg.SelfVelocitySource == "" {
		cfg.SelfVelocitySource = "best"
	}

	grpcConn, err := builtin.BuiltinClientConn("nmea")
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("gRPC connection: %w", err)
	}
	worldClient := pb.NewWorldServiceClient(grpcConn)
	decoder := ais.CodecNew(false, false)
	decoder.DropSpace = true

	return cfg, worldClient, decoder, func() { _ = grpcConn.Close() }, nil
}

func runTCPClient(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg, worldClient, decoder, cleanup, err := setupStream(entity)
	if err != nil {
		return err
	}
	defer cleanup()

	addrs := splitAddresses(cfg.Address)
	state := &StreamState{fragments: make(map[int64]*MessageFragment)}

	ready()

	g, ctx := errgroup.WithContext(ctx)
	for _, addr := range addrs {
		g.Go(func() error {
			return runTCPClientConn(ctx, logger, addr, entity.Id, decoder, worldClient, cfg, state)
		})
	}
	return g.Wait()
}

func runTCPClientConn(ctx context.Context, logger *slog.Logger, addr string, entityID string, decoder *ais.Codec, worldClient pb.WorldServiceClient, cfg *StreamConfig, state *StreamState) error {
	logger.Info("Starting NMEA TCP client", "entityID", entityID, "address", addr)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
		if err != nil {
			logger.Error("Failed to connect", "address", addr, "error", err)
			time.Sleep(5 * time.Second)
			continue
		}

		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		scanner := bufio.NewScanner(conn)

		for scanner.Scan() {
			_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
			select {
			case <-ctx.Done():
				_ = conn.Close()
				return ctx.Err()
			default:
			}
			processAISLine(ctx, logger, scanner.Text(), decoder, worldClient, "nmea", entityID, cfg, state)
		}

		if err := scanner.Err(); err != nil {
			logger.Error("Stream read error", "address", addr, "error", err)
		}

		_ = conn.Close()
		logger.Warn("Connection closed, reconnecting...", "entityID", entityID, "address", addr)
		time.Sleep(2 * time.Second)
	}
}

func runTCPServer(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg, worldClient, decoder, cleanup, err := setupStream(entity)
	if err != nil {
		return err
	}
	defer cleanup()

	lc := net.ListenConfig{}
	listener, err := lc.Listen(ctx, "tcp", cfg.Address)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	defer func() { _ = listener.Close() }()

	state := &StreamState{fragments: make(map[int64]*MessageFragment)}

	ready()

	logger.Info("Starting NMEA TCP server", "entityID", entity.Id, "address", listener.Addr().String())

	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()

	var wg sync.WaitGroup
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				wg.Wait()
				return ctx.Err()
			}
			logger.Error("Accept failed", "error", err)
			time.Sleep(time.Second)
			continue
		}
		wg.Add(1)
		go func(c net.Conn) {
			defer wg.Done()
			defer func() { _ = c.Close() }()
			remote := c.RemoteAddr().String()
			logger.Info("Client connected", "entityID", entity.Id, "remote", remote)

			scanner := bufio.NewScanner(c)
			for scanner.Scan() {
				select {
				case <-ctx.Done():
					return
				default:
				}
				processAISLine(ctx, logger, scanner.Text(), decoder, worldClient, "nmea", entity.Id, cfg, state)
			}
			if err := scanner.Err(); err != nil {
				logger.Warn("Client read error", "remote", remote, "error", err)
			}
			logger.Info("Client disconnected", "entityID", entity.Id, "remote", remote)
		}(conn)
	}
}

func runUDPServer(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg, worldClient, decoder, cleanup, err := setupStream(entity)
	if err != nil {
		return err
	}
	defer cleanup()

	lc := net.ListenConfig{}
	pc, err := lc.ListenPacket(ctx, "udp", cfg.Address)
	if err != nil {
		return fmt.Errorf("listen udp: %w", err)
	}
	defer func() { _ = pc.Close() }()

	state := &StreamState{fragments: make(map[int64]*MessageFragment)}

	ready()

	logger.Info("Starting NMEA UDP server", "entityID", entity.Id, "address", pc.LocalAddr().String())

	go func() {
		<-ctx.Done()
		_ = pc.Close()
	}()

	buf := make([]byte, 65536)
	for {
		n, _, err := pc.ReadFrom(buf)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			logger.Error("UDP read error", "error", err)
			continue
		}
		for _, line := range strings.Split(string(buf[:n]), "\n") {
			line = strings.TrimRight(line, "\r")
			if line == "" {
				continue
			}
			processAISLine(ctx, logger, line, decoder, worldClient, "nmea", entity.Id, cfg, state)
		}
	}
}

func pushStreamMetrics(ctx context.Context, worldClient pb.WorldServiceClient, controllerName string, trackerID string, state *StreamState) {
	now := time.Now()
	if now.Sub(state.lastMetrics) < time.Second {
		return
	}
	state.lastMetrics = now

	kind := pb.MetricKind_MetricKindCount
	unit := pb.MetricUnit_MetricUnitCount
	m := func(id uint32, label string, val uint64) *pb.Metric {
		return &pb.Metric{
			Id:    &id,
			Kind:  &kind,
			Unit:  unit,
			Label: &label,
			Val:   &pb.Metric_Uint64{Uint64: val},
		}
	}

	entity := &pb.Entity{
		Id:         trackerID,
		Controller: &pb.Controller{Id: &controllerName},
		Metric: &pb.MetricComponent{
			Metrics: []*pb.Metric{
				m(100, "Lines Total", state.linesTotal),
				m(101, "Lines Invalid", state.linesInvalid),
				m(102, "RMC", state.linesRMC),
				m(103, "GGA", state.linesGGA),
				m(104, "HDT", state.linesHDT),
				m(105, "ROT", state.linesROT),
				m(106, "VTG", state.linesVTG),
				m(107, "MWV", state.linesMWV),
				m(108, "DPT", state.linesDPT),
				m(109, "AIS", state.linesAIS),
				m(110, "OSD", state.linesOSD),
				m(111, "RSD", state.linesRSD),
				m(112, "Other", state.linesOther),
			},
		},
	}

	_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{entity},
	})
}

func processAISLine(ctx context.Context, logger *slog.Logger, line string, aisDecoder *ais.Codec, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, state *StreamState) bool {
	if idx := strings.Index(line, "!"); idx >= 0 {
		line = line[idx:]
	} else if idx := strings.Index(line, "$"); idx >= 0 {
		line = line[idx:]
	} else {
		state.linesTotal++
		state.linesInvalid++
		pushStreamMetrics(ctx, worldClient, controllerName, trackerID, state)
		return false
	}

	state.linesTotal++

	s, err := nmea.Parse(line)
	if err != nil {
		state.linesInvalid++
		pushStreamMetrics(ctx, worldClient, controllerName, trackerID, state)
		return false
	}

	defer pushStreamMetrics(ctx, worldClient, controllerName, trackerID, state)

	if rmc, ok := s.(nmea.RMC); ok {
		state.linesRMC++
		return processRMC(ctx, logger, rmc, worldClient, controllerName, trackerID, config, state)
	}

	if gga, ok := s.(nmea.GGA); ok {
		state.linesGGA++
		return processGGA(ctx, logger, gga, worldClient, controllerName, trackerID, config, state)
	}

	if hdt, ok := s.(nmea.HDT); ok {
		state.linesHDT++
		return processHDT(ctx, logger, hdt, worldClient, controllerName, trackerID, config, state)
	}

	if rot, ok := s.(nmea.ROT); ok {
		state.linesROT++
		return processROT(ctx, logger, rot, worldClient, controllerName, trackerID, config, state)
	}

	if vtg, ok := s.(nmea.VTG); ok {
		state.linesVTG++
		return processVTG(ctx, logger, vtg, worldClient, controllerName, trackerID, config, state)
	}

	if mwv, ok := s.(nmea.MWV); ok {
		state.linesMWV++
		return processMWV(ctx, logger, mwv, worldClient, controllerName, trackerID, config)
	}

	if dpt, ok := s.(nmea.DPT); ok {
		state.linesDPT++
		return processDPT(ctx, logger, dpt, worldClient, controllerName, trackerID, config)
	}

	if osd, ok := s.(nmea.OSD); ok {
		state.linesOSD++
		return processOSD(ctx, logger, osd, worldClient, controllerName, trackerID, config, state)
	}

	if rsd, ok := s.(nmea.RSD); ok {
		state.linesRSD++
		return processRSD(ctx, logger, rsd, worldClient, controllerName, trackerID, config)
	}

	vdm, ok := s.(nmea.VDMVDO)
	if !ok {
		state.linesOther++
		return false
	}

	state.linesAIS++

	if vdm.NumFragments > 1 {
		state.fragmentMu.Lock()
		defer state.fragmentMu.Unlock()

		msgFrag, exists := state.fragments[vdm.MessageID]
		if !exists {
			msgFrag = &MessageFragment{
				fragments: make(map[int64][]byte),
				numParts:  vdm.NumFragments,
				timestamp: time.Now(),
			}
			state.fragments[vdm.MessageID] = msgFrag
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

		delete(state.fragments, vdm.MessageID)

		packet := aisDecoder.DecodePacket(completePayload)
		if packet == nil {
			logger.Debug("Failed to decode AIS")
			return false
		}

		return processAISPacket(ctx, logger, packet, worldClient, controllerName, trackerID, config, state)
	}

	packet := aisDecoder.DecodePacket(vdm.Payload)
	if packet == nil {
		logger.Debug("Failed to decode AIS")
		return false
	}

	return processAISPacket(ctx, logger, packet, worldClient, controllerName, trackerID, config, state)
}

func processRMC(ctx context.Context, logger *slog.Logger, rmc nmea.RMC, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, state *StreamState) bool {
	if !acceptSource(config.SelfPositionSource, "rmc", []time.Time{state.lastPosGGA}, config.EntityExpirySeconds) {
		return false
	}

	if rmc.Validity != "A" && config.SelfPositionSource != "desperate" {
		return false
	}

	state.lastPosRMC = time.Now()

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

	altitude := 0.0
	entity := selfBaseEntity(controllerName, trackerID, config)
	entity.Geo = &pb.GeoSpatialComponent{
		Latitude:  rmc.Latitude,
		Longitude: rmc.Longitude,
		Altitude:  &altitude,
	}

	if rmc.Course >= 0 && rmc.Course < 360 {
		acceptVel := acceptSource(config.SelfVelocitySource, "rmc", []time.Time{state.lastVelVTG, state.lastVelOSD}, config.EntityExpirySeconds)
		if acceptVel && rmc.Speed > 0 {
			state.lastVelRMC = time.Now()
			rad := rmc.Course * math.Pi / 180.0
			speedMs := rmc.Speed * 0.514444
			east := speedMs * math.Sin(rad)
			north := speedMs * math.Cos(rad)
			state.lastVelocityEast = &east
			state.lastVelocityNorth = &north
		}
	}

	entity.Kinematics = selfKinematics(state)

	return pushSelfUpdate(ctx, logger, entity, worldClient, "RMC position")
}

func acceptSource(selected string, source string, betterSeen []time.Time, expiry int) bool {
	if selected != "best" && selected != "desperate" && selected != source {
		return false
	}
	if selected == "best" || selected == "desperate" {
		window := time.Duration(expiry) * time.Second
		for _, t := range betterSeen {
			if time.Since(t) < window {
				return false
			}
		}
	}
	return true
}

func selfKinematics(state *StreamState) *pb.KinematicsComponent {
	k := &pb.KinematicsComponent{}
	if state.lastVelocityEast != nil && state.lastVelocityNorth != nil {
		k.VelocityEnu = &pb.KinematicsEnu{
			East:  state.lastVelocityEast,
			North: state.lastVelocityNorth,
		}
	}
	if state.lastYawRate != nil {
		k.AngularVelocityBody = &pb.AngularVelocity{
			YawRate: *state.lastYawRate,
		}
	}
	return k
}

func selfBaseEntity(controllerName string, trackerID string, config *StreamConfig) *pb.Entity {
	entity := &pb.Entity{
		Id: trackerID,
		Controller: &pb.Controller{
			Id: &controllerName,
		},
	}
	if t := selfClassToTaxonomy(config.SelfClass); t != nil {
		entity.Classification = &pb.ClassificationComponent{
			Taxonomy: []*pb.ClassificationTaxonomy{t},
		}
	}
	return entity
}

func selfClassToTaxonomy(class string) *pb.ClassificationTaxonomy {
	switch class {
	case "vehicle_sea":
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
			Domain: &pb.VehicleTaxonomy_Sea{Sea: &pb.VehicleTaxonomySea{}},
		}}}
	case "vehicle_land":
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
			Domain: &pb.VehicleTaxonomy_Land{Land: &pb.VehicleTaxonomyLand{}},
		}}}
	case "vehicle_air":
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
			Domain: &pb.VehicleTaxonomy_Air{Air: &pb.VehicleTaxonomyAir{}},
		}}}
	case "equipment_sensor":
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
			Sensor: &pb.EquipmentTaxonomySensor{},
		}}}
	case "person":
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Person{Person: &pb.PersonTaxonomy{}}}
	default:
		return nil
	}
}

func pushSelfUpdate(ctx context.Context, logger *slog.Logger, entity *pb.Entity, worldClient pb.WorldServiceClient, what string) bool {
	_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{entity},
	})
	if err != nil {
		logger.Error("Failed to push "+what, "error", err)
		return false
	}
	return true
}

func processGGA(ctx context.Context, logger *slog.Logger, gga nmea.GGA, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, state *StreamState) bool {
	if gga.FixQuality == nmea.Invalid {
		return false
	}

	if gga.NumSatellites > 0 {
		state.lastGoodGGA = time.Now()
	} else if time.Since(state.lastGoodGGA) < time.Duration(config.EntityExpirySeconds)*time.Second {
		return false
	}

	entity := selfBaseEntity(controllerName, trackerID, config)

	if acceptSource(config.SelfPositionSource, "gga", nil, config.EntityExpirySeconds) {
		state.lastPosGGA = time.Now()
		entity.Geo = &pb.GeoSpatialComponent{
			Latitude:  gga.Latitude,
			Longitude: gga.Longitude,
		}
		if gga.Altitude != 0 {
			entity.Geo.Altitude = &gga.Altitude
		}
	}

	var fixType pb.GnssFixType
	switch gga.FixQuality {
	case nmea.GPS:
		fixType = pb.GnssFixType_GnssFixType3D
	case nmea.DGPS:
		fixType = pb.GnssFixType_GnssFixTypeDGPS
	case nmea.RTK:
		fixType = pb.GnssFixType_GnssFixTypeRtkFixed
	case nmea.FRTK:
		fixType = pb.GnssFixType_GnssFixTypeRtkFloat
	default:
		fixType = pb.GnssFixType_GnssFixType3D
	}

	gnss := &pb.GnssComponent{
		FixType: &fixType,
	}
	if gga.NumSatellites > 0 {
		sat := uint32(gga.NumSatellites)
		gnss.SatellitesUsed = &sat
	}
	if gga.HDOP > 0 {
		hdop := float32(gga.HDOP)
		gnss.Hdop = &hdop
	}
	entity.Gnss = gnss

	return pushSelfUpdate(ctx, logger, entity, worldClient, "GGA fix")
}

func processHDT(ctx context.Context, logger *slog.Logger, hdt nmea.HDT, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, state *StreamState) bool {
	if !hdt.True || hdt.Heading < 0 || hdt.Heading >= 360 {
		return false
	}
	if !acceptSource(config.SelfHeadingSource, "hdt", nil, config.EntityExpirySeconds) {
		return false
	}

	state.lastHeadingHDT = time.Now()

	rad := hdt.Heading * math.Pi / 180.0
	halfRad := rad / 2.0

	entity := selfBaseEntity(controllerName, trackerID, config)
	entity.Orientation = &pb.OrientationComponent{
		Orientation: &pb.Quaternion{
			X: 0,
			Y: 0,
			Z: math.Sin(halfRad),
			W: math.Cos(halfRad),
		},
	}

	return pushSelfUpdate(ctx, logger, entity, worldClient, "HDT heading")
}

func processROT(ctx context.Context, logger *slog.Logger, rot nmea.ROT, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, state *StreamState) bool {
	if !rot.Valid {
		return false
	}

	yawRate := rot.RateOfTurn * math.Pi / 180.0 / 60.0
	state.lastYawRate = &yawRate

	entity := selfBaseEntity(controllerName, trackerID, config)
	entity.Kinematics = selfKinematics(state)

	return pushSelfUpdate(ctx, logger, entity, worldClient, "ROT")
}

func processVTG(ctx context.Context, logger *slog.Logger, vtg nmea.VTG, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, state *StreamState) bool {
	if vtg.GroundSpeedKnots <= 0 || vtg.TrueTrack < 0 || vtg.TrueTrack >= 360 {
		return false
	}
	if !acceptSource(config.SelfVelocitySource, "vtg", nil, config.EntityExpirySeconds) {
		return false
	}

	state.lastVelVTG = time.Now()

	courseRad := vtg.TrueTrack * math.Pi / 180.0
	speedMs := vtg.GroundSpeedKnots * 0.514444
	east := speedMs * math.Sin(courseRad)
	north := speedMs * math.Cos(courseRad)
	state.lastVelocityEast = &east
	state.lastVelocityNorth = &north

	entity := selfBaseEntity(controllerName, trackerID, config)
	entity.Kinematics = selfKinematics(state)

	return pushSelfUpdate(ctx, logger, entity, worldClient, "VTG velocity")
}

func processMWV(ctx context.Context, logger *slog.Logger, mwv nmea.MWV, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig) bool {
	if !mwv.StatusValid {
		return false
	}

	var speedKnots float64
	switch mwv.WindSpeedUnit {
	case nmea.UnitKnotsMWV:
		speedKnots = mwv.WindSpeed
	case nmea.UnitMSMWV:
		speedKnots = mwv.WindSpeed / 0.514444
	case nmea.UnitKMHMWV:
		speedKnots = mwv.WindSpeed / 1.852
	case nmea.UnitSMilesHMWV:
		speedKnots = mwv.WindSpeed / 1.15078
	default:
		return false
	}

	speedKind := pb.MetricKind_MetricKindWindSpeed
	speedUnit := pb.MetricUnit_MetricUnitKnot
	dirKind := pb.MetricKind_MetricKindWindDirection
	dirUnit := pb.MetricUnit_MetricUnitDegree

	speedLabel := "Wind Speed"
	dirLabel := "Wind Direction"
	if mwv.Reference == nmea.RelativeMWV {
		speedLabel = "Apparent Wind Speed"
		dirLabel = "Apparent Wind Angle"
	}

	speedID := uint32(10)
	dirID := uint32(11)

	entity := selfBaseEntity(controllerName, trackerID, config)
	entity.Metric = &pb.MetricComponent{
		Metrics: []*pb.Metric{
			{
				Id:    &speedID,
				Kind:  &speedKind,
				Unit:  speedUnit,
				Label: &speedLabel,
				Val:   &pb.Metric_Double{Double: speedKnots},
			},
			{
				Id:    &dirID,
				Kind:  &dirKind,
				Unit:  dirUnit,
				Label: &dirLabel,
				Val:   &pb.Metric_Double{Double: mwv.WindAngle},
			},
		},
	}

	return pushSelfUpdate(ctx, logger, entity, worldClient, "MWV wind")
}

func processDPT(ctx context.Context, logger *slog.Logger, dpt nmea.DPT, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig) bool {
	if dpt.Depth <= 0 {
		return false
	}

	depthM := dpt.Depth + dpt.Offset
	if depthM <= 0 {
		return false
	}

	kind := pb.MetricKind_MetricKindDepth
	unit := pb.MetricUnit_MetricUnitMeter
	label := "Water Depth"
	id := uint32(20)

	entity := selfBaseEntity(controllerName, trackerID, config)
	entity.Metric = &pb.MetricComponent{
		Metrics: []*pb.Metric{
			{
				Id:    &id,
				Kind:  &kind,
				Unit:  unit,
				Label: &label,
				Val:   &pb.Metric_Double{Double: depthM},
			},
		},
	}

	return pushSelfUpdate(ctx, logger, entity, worldClient, "DPT depth")
}

func processOSD(ctx context.Context, logger *slog.Logger, osd nmea.OSD, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, state *StreamState) bool {
	if osd.HeadingStatus != "A" {
		return false
	}

	entity := selfBaseEntity(controllerName, trackerID, config)

	acceptHeading := acceptSource(config.SelfHeadingSource, "osd", []time.Time{state.lastHeadingHDT}, config.EntityExpirySeconds)
	if acceptHeading && osd.Heading >= 0 && osd.Heading < 360 {
		state.lastHeadingOSD = time.Now()
		rad := osd.Heading * math.Pi / 180.0
		halfRad := rad / 2.0
		entity.Orientation = &pb.OrientationComponent{
			Orientation: &pb.Quaternion{
				X: 0,
				Y: 0,
				Z: math.Sin(halfRad),
				W: math.Cos(halfRad),
			},
		}
	}

	acceptVel := acceptSource(config.SelfVelocitySource, "osd", []time.Time{state.lastVelVTG}, config.EntityExpirySeconds)
	if acceptVel && osd.VesselSpeed > 0 && osd.VesselTrueCourse >= 0 && osd.VesselTrueCourse < 360 {
		state.lastVelOSD = time.Now()
		var speedKnots float64
		switch osd.SpeedUnits {
		case "N":
			speedKnots = osd.VesselSpeed
		case "K":
			speedKnots = osd.VesselSpeed / 1.852
		case "S":
			speedKnots = osd.VesselSpeed / 1.15078
		default:
			speedKnots = osd.VesselSpeed
		}
		courseRad := osd.VesselTrueCourse * math.Pi / 180.0
		speedMs := speedKnots * 0.514444
		east := speedMs * math.Sin(courseRad)
		north := speedMs * math.Cos(courseRad)
		state.lastVelocityEast = &east
		state.lastVelocityNorth = &north
	}

	if !acceptHeading && !acceptVel {
		return false
	}

	entity.Kinematics = selfKinematics(state)

	return pushSelfUpdate(ctx, logger, entity, worldClient, "OSD")
}

func processRSD(ctx context.Context, logger *slog.Logger, rsd nmea.RSD, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig) bool {
	if rsd.RangeScale <= 0 {
		return false
	}

	var rangeM float64
	switch rsd.RangeUnit {
	case "N":
		rangeM = rsd.RangeScale * 1852
	case "K":
		rangeM = rsd.RangeScale * 1000
	case "S":
		rangeM = rsd.RangeScale * 1609.344
	default:
		rangeM = rsd.RangeScale * 1852
	}

	coverageID := trackerID + ".radar.coverage"

	_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{
				Id: coverageID,
				LocalShape: &pb.LocalShapeComponent{
					RelativeTo: trackerID,
					Geometry: &pb.LocalGeometry{
						Shape: &pb.LocalGeometry_Circle{
							Circle: &pb.LocalCircle{
								Center:  &pb.LocalPoint{},
								RadiusM: rangeM,
							},
						},
					},
				},
			},
			{
				Id:         trackerID,
				Controller: &pb.Controller{Id: &controllerName},
				Sensor: &pb.SensorComponent{
					Coverage: []string{coverageID},
				},
			},
		},
	})
	if err != nil {
		logger.Error("Failed to push RSD coverage", "error", err)
		return false
	}
	return true
}

func processAISVessel(ctx context.Context, logger *slog.Logger, vessel *AISVessel, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, state *StreamState) bool {
	if config.SelfMMSI > 0 && vessel.MMSI == config.SelfMMSI {
		entity := selfBaseEntity(controllerName, trackerID, config)

		if acceptSource(config.SelfPositionSource, "ais", []time.Time{state.lastPosGGA, state.lastPosRMC}, config.EntityExpirySeconds) {
			state.lastPosAIS = time.Now()
			entity.Geo = &pb.GeoSpatialComponent{
				Latitude:  vessel.Latitude,
				Longitude: vessel.Longitude,
			}
		}

		if vessel.Heading >= 0 && vessel.Heading < 360 &&
			acceptSource(config.SelfHeadingSource, "ais", []time.Time{state.lastHeadingHDT, state.lastHeadingOSD}, config.EntityExpirySeconds) {
			rad := float64(vessel.Heading) * math.Pi / 180.0
			halfRad := rad / 2.0
			entity.Orientation = &pb.OrientationComponent{
				Orientation: &pb.Quaternion{
					X: 0,
					Y: 0,
					Z: math.Sin(halfRad),
					W: math.Cos(halfRad),
				},
			}
		}
		if vessel.Speed > 0 && vessel.Course >= 0 && vessel.Course < 360 &&
			acceptSource(config.SelfVelocitySource, "ais", []time.Time{state.lastVelVTG, state.lastVelOSD, state.lastVelRMC}, config.EntityExpirySeconds) {
			courseRad := vessel.Course * math.Pi / 180.0
			speedMs := vessel.Speed * 0.514444
			east := speedMs * math.Sin(courseRad)
			north := speedMs * math.Cos(courseRad)
			state.lastVelocityEast = &east
			state.lastVelocityNorth = &north
		}
		entity.Kinematics = selfKinematics(state)
		mmsi := vessel.MMSI
		entity.Transponder = &pb.TransponderComponent{
			Ais: &pb.TransponderAIS{Mmsi: &mmsi},
		}
		return pushSelfUpdate(ctx, logger, entity, worldClient, "AIS self")
	}

	if !checkGeoFilter(vessel, config) {
		logger.Debug("Dropped vessel: outside geo filter", "mmsi", vessel.MMSI)
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
}

func processAISPacket(ctx context.Context, logger *slog.Logger, packet ais.Packet, worldClient pb.WorldServiceClient, controllerName string, trackerID string, config *StreamConfig, state *StreamState) bool {
	switch msg := packet.(type) {
	case ais.PositionReport:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		return processAISVessel(ctx, logger, &AISVessel{
			MMSI:               mmsi,
			Latitude:           float64(msg.Latitude),
			Longitude:          float64(msg.Longitude),
			Speed:              float64(msg.Sog),
			Course:             float64(msg.Cog),
			Heading:            int(msg.TrueHeading),
			PositionAccuracy:   msg.PositionAccuracy,
			NavigationalStatus: msg.NavigationalStatus,
			LastSeen:           time.Now(),
		}, worldClient, controllerName, trackerID, config, state)

	case ais.StandardClassBPositionReport:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		return processAISVessel(ctx, logger, &AISVessel{
			MMSI:             mmsi,
			Latitude:         float64(msg.Latitude),
			Longitude:        float64(msg.Longitude),
			Speed:            float64(msg.Sog),
			Course:           float64(msg.Cog),
			Heading:          int(msg.TrueHeading),
			PositionAccuracy: msg.PositionAccuracy,
			LastSeen:         time.Now(),
		}, worldClient, controllerName, trackerID, config, state)

	case ais.ExtendedClassBPositionReport:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		return processAISVessel(ctx, logger, &AISVessel{
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
		}, worldClient, controllerName, trackerID, config, state)

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
	if config.Latitude == nil || config.Longitude == nil || config.RadiusKM == nil || *config.RadiusKM == 0 {
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

	fixType := pb.GnssFixType_GnssFixType3D
	if vessel.PositionAccuracy {
		fixType = pb.GnssFixType_GnssFixTypeDGPS
	}
	entity.Gnss = &pb.GnssComponent{
		FixType: &fixType,
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

	if vessel.Heading >= 0 && vessel.Heading < 360 {
		rad := float64(vessel.Heading) * math.Pi / 180.0
		halfRad := rad / 2.0
		entity.Orientation = &pb.OrientationComponent{
			Orientation: &pb.Quaternion{
				X: 0,
				Y: 0,
				Z: math.Sin(halfRad),
				W: math.Cos(halfRad),
			},
		}
	}

	if vessel.Course >= 0 && vessel.Course < 360 && vessel.Speed > 0 && vessel.Speed < 102.3 {
		courseRad := vessel.Course * math.Pi / 180.0
		speedMs := vessel.Speed * 0.514444
		east := speedMs * math.Sin(courseRad)
		north := speedMs * math.Cos(courseRad)
		entity.Kinematics = &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				East:  &east,
				North: &north,
			},
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

	if v, ok := fields["address"]; ok {
		streamConfig.Address = v.GetStringValue()
	}
	if v, ok := fields["entity_expiry_seconds"]; ok {
		streamConfig.EntityExpirySeconds = int(v.GetNumberValue())
	}
	if v, ok := fields["latitude"]; ok {
		if _, isNum := v.Kind.(*structpb.Value_NumberValue); isNum {
			lat := v.GetNumberValue()
			streamConfig.Latitude = &lat
		}
	}
	if v, ok := fields["longitude"]; ok {
		if _, isNum := v.Kind.(*structpb.Value_NumberValue); isNum {
			lon := v.GetNumberValue()
			streamConfig.Longitude = &lon
		}
	}
	if v, ok := fields["radius_km"]; ok {
		if _, isNum := v.Kind.(*structpb.Value_NumberValue); isNum {
			radius := v.GetNumberValue()
			streamConfig.RadiusKM = &radius
		}
	}
	if v, ok := fields["self_class"]; ok {
		streamConfig.SelfClass = v.GetStringValue()
	}
	if v, ok := fields["self_position_source"]; ok {
		streamConfig.SelfPositionSource = v.GetStringValue()
	}
	if v, ok := fields["self_heading_source"]; ok {
		streamConfig.SelfHeadingSource = v.GetStringValue()
	}
	if v, ok := fields["self_velocity_source"]; ok {
		streamConfig.SelfVelocitySource = v.GetStringValue()
	}
	if v, ok := fields["self_mmsi"]; ok {
		streamConfig.SelfMMSI = uint32(v.GetNumberValue())
	}

	return streamConfig, nil
}

func init() {
	builtin.Register("nmea", Run)
}
