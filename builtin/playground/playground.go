// Package playground is a builtin designed for frontend developers to test
// configuration UIs. It provides a root device with an "Enable Discovery"
// boolean. When enabled, it spawns several subdevices exercising different
// configuration scenarios:
//
//   - "configured":  has a configurable schema + default config values (continuous controller)
//   - "unconfigured": has a configurable schema but no default config (polling controller)
//   - "broken":      has neither a config nor a configurable (always fails)
//
// A fourth device class ("manual") can be added by the frontend. The backend
// attaches a configurable schema to it once it appears. It includes a "crash"
// option that makes the controller return an error on purpose.
package playground

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const controllerName = "playground"

func init() {
	builtin.Register(controllerName, Run)
}

// -------------------------------------------------------------------
// Schemas
// -------------------------------------------------------------------

func serviceSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"enable_discovery": map[string]any{
				"type":        "boolean",
				"title":       "Enable Discovery",
				"description": "When enabled, automatically creates several subdevices for testing",
			},
			"enable_cameras": map[string]any{
				"type":        "boolean",
				"title":       "Enable Cameras",
				"description": "When enabled, creates demo camera entities with live streams",
			},
			"enable_kuiper": map[string]any{
				"type":        "boolean",
				"title":       "Enable Kuiper Constellation",
				"description": "When enabled, tracks Kuiper satellite constellation",
			},
			"enable_iss": map[string]any{
				"type":        "boolean",
				"title":       "Enable ISS Tracker",
				"description": "When enabled, tracks the International Space Station",
			},
			"enable_adsb": map[string]any{
				"type":        "boolean",
				"title":       "Enable ADS-B",
				"description": "When enabled, creates an ADS-B receiver tracking aircraft",
			},
			"enable_ais": map[string]any{
				"type":        "boolean",
				"title":       "Enable AIS",
				"description": "When enabled, creates an AIS stream tracking vessels",
			},
			"enable_radar": map[string]any{
				"type":        "boolean",
				"title":       "Enable Simulated Radar",
				"description": "When enabled, creates a simulated drone detection radar",
			},
			"enable_sensors": map[string]any{
				"type":        "boolean",
				"title":       "Enable Sensor Network",
				"description": "When enabled, creates 32 weather stations around Lake Geneva with hazard sensors",
			},
		},
	})
	return s
}

func configuredSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"ui:groups": []any{
			map[string]any{"key": "general", "title": "General"},
			map[string]any{"key": "advanced", "title": "Advanced"},
		},
		"properties": map[string]any{
			"label": map[string]any{
				"type":           "string",
				"title":          "Label",
				"description":    "A human-readable label for this device",
				"default":        "My Device",
				"ui:placeholder": "e.g. Living Room Sensor",
				"ui:group":       "general",
				"ui:order":       0,
			},
			"interval_seconds": map[string]any{
				"type":        "integer",
				"title":       "Update Interval",
				"description": "How often the device reports (continuous mode, informational only)",
				"default":     10,
				"minimum":     1,
				"maximum":     3600,
				"ui:unit":     "s",
				"ui:widget":   "stepper",
				"ui:step":     1,
				"ui:group":    "general",
				"ui:order":    1,
			},
			"enabled": map[string]any{
				"type":        "boolean",
				"title":       "Enabled",
				"description": "Whether this device is actively reporting",
				"default":     true,
				"ui:group":    "general",
				"ui:order":    2,
			},
			"mode": map[string]any{
				"type":        "string",
				"title":       "Operating Mode",
				"description": "Select the device operating mode",
				"default":     "normal",
				"oneOf": []any{
					map[string]any{"const": "normal", "title": "Normal"},
					map[string]any{"const": "verbose", "title": "Verbose"},
					map[string]any{"const": "silent", "title": "Silent"},
				},
				"ui:group": "advanced",
				"ui:order": 0,
			},
			"crash": map[string]any{
				"type":        "boolean",
				"title":       "Crash",
				"description": "If enabled, the controller will crash with an error on next restart",
				"default":     false,
				"ui:group":    "advanced",
				"ui:order":    1,
			},
			"discover_subdevices": map[string]any{
				"type":        "boolean",
				"title":       "Discover Subdevices",
				"description": "When enabled, discovers further nested subdevices under this device",
				"default":     false,
				"ui:group":    "advanced",
				"ui:order":    2,
			},
		},
	})
	return s
}

func subdeviceSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tag": map[string]any{
				"type":           "string",
				"title":          "Tag",
				"description":    "An arbitrary tag for this subdevice",
				"ui:placeholder": "e.g. sensor-1",
				"ui:order":       0,
			},
			"crash": map[string]any{
				"type":        "boolean",
				"title":       "Crash",
				"description": "If enabled, the controller will crash with an error",
				"default":     false,
				"ui:order":    1,
			},
		},
	})
	return s
}

func unconfiguredSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"poll_interval_seconds": map[string]any{
				"type":        "integer",
				"title":       "Poll Interval",
				"description": "How often the poller runs",
				"default":     5,
				"minimum":     1,
				"maximum":     300,
				"ui:unit":     "s",
				"ui:order":    0,
			},
			"query": map[string]any{
				"type":           "string",
				"title":          "Query",
				"description":    "An arbitrary query string for the poller",
				"ui:placeholder": "e.g. status",
				"ui:order":       1,
			},
			"crash": map[string]any{
				"type":        "boolean",
				"title":       "Crash",
				"description": "If enabled, the poller will crash with an error",
				"default":     false,
				"ui:order":    2,
			},
		},
	})
	return s
}

func manualSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name": map[string]any{
				"type":           "string",
				"title":          "Name",
				"description":    "A name for the manually-added device",
				"ui:placeholder": "e.g. Test Device",
				"ui:order":       0,
			},
			"value": map[string]any{
				"type":        "integer",
				"title":       "Value",
				"description": "An arbitrary numeric value",
				"default":     42,
				"ui:order":    1,
			},
			"crash": map[string]any{
				"type":        "boolean",
				"title":       "Crash",
				"description": "If enabled, the controller will crash with an error",
				"default":     false,
				"ui:order":    2,
			},
		},
	})
	return s
}

// -------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	serviceEntityID := controllerName + ".service"

	if err := controller.Push(ctx, &pb.Entity{
		Id:    serviceEntityID,
		Label: proto.String("Playground"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Missions"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Configurable: &pb.ConfigurableComponent{
			Schema: serviceSchema(),
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{Class: "configured", Label: "Configured Device"},
				{Class: "unconfigured", Label: "Unconfigured Device"},
				{Class: "manual", Label: "Manual Device"},
				{Class: "drone_radar", Label: "Simulated Drone Radar"},
				{Class: "sensor_network", Label: "Sensor Network"},
			},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("flask-conical"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	// Watch the service entity's own config for toggles (discovery, cameras).
	go controller.Run(ctx, serviceEntityID, func(ctx context.Context, entity *pb.Entity, ready func()) error { //nolint:errcheck // fire-and-forget goroutine
		ready()
		return runServiceConfig(ctx, logger, entity)
	})

	// Watch for child devices (manual class added by frontend + discovered classes).
	classes := []controller.DeviceClass{
		{Class: "configured", Label: "Configured Device", Schema: configuredSchema()},
		{Class: "unconfigured", Label: "Unconfigured Device", Schema: unconfiguredSchema()},
		{Class: "manual", Label: "Manual Device", Schema: manualSchema()},
		{Class: "drone_radar", Label: "Simulated Drone Radar", Schema: radarSchema()},
		{Class: "sensor_network", Label: "Sensor Network", Schema: sensorNetworkSchema()},
		// "broken" is deliberately NOT in the class list — WatchChildren
		// will not push a Configurable onto it, so it stays schema-less.
	}

	return controller.WatchChildren(ctx, serviceEntityID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return runChild(ctx, logger, entityID)
	})
}

// -------------------------------------------------------------------
// Discovery
// -------------------------------------------------------------------

// discoveredDevices tracks which synthetic subdevices we've created so
// we can expire them when discovery is turned off.
var (
	discoveredMu      sync.Mutex
	discoveredDevices []string
	cameraDevices     []string
	kuiperDevices     []string
	issDevices        []string
	adsbDevices       []string
	aisDevices        []string
	radarDevices      []string
	sensorDevices     []string
)

type serviceConfig struct {
	EnableDiscovery bool
	EnableCameras   bool
	EnableKuiper    bool
	EnableISS       bool
	EnableADSB      bool
	EnableAIS       bool
	EnableRadar     bool
	EnableSensors   bool
}

func parseServiceConfig(entity *pb.Entity) serviceConfig {
	var cfg serviceConfig
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return cfg
	}
	if v, ok := entity.Config.Value.Fields["enable_discovery"]; ok {
		cfg.EnableDiscovery = v.GetBoolValue()
	}
	if v, ok := entity.Config.Value.Fields["enable_cameras"]; ok {
		cfg.EnableCameras = v.GetBoolValue()
	}
	if v, ok := entity.Config.Value.Fields["enable_kuiper"]; ok {
		cfg.EnableKuiper = v.GetBoolValue()
	}
	if v, ok := entity.Config.Value.Fields["enable_iss"]; ok {
		cfg.EnableISS = v.GetBoolValue()
	}
	if v, ok := entity.Config.Value.Fields["enable_adsb"]; ok {
		cfg.EnableADSB = v.GetBoolValue()
	}
	if v, ok := entity.Config.Value.Fields["enable_ais"]; ok {
		cfg.EnableAIS = v.GetBoolValue()
	}
	if v, ok := entity.Config.Value.Fields["enable_radar"]; ok {
		cfg.EnableRadar = v.GetBoolValue()
	}
	if v, ok := entity.Config.Value.Fields["enable_sensors"]; ok {
		cfg.EnableSensors = v.GetBoolValue()
	}
	return cfg
}

func runServiceConfig(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	cfg := parseServiceConfig(entity)

	if cfg.EnableDiscovery {
		logger.Info("playground: discovery enabled, creating subdevices")
		pushDiscoveredDevices(ctx, logger)
	} else {
		logger.Info("playground: discovery disabled, cleaning up")
		expireDiscoveredDevices(ctx, logger)
	}

	if cfg.EnableCameras {
		logger.Info("playground: cameras enabled, creating camera entities")
		pushCameraDevices(ctx, logger)
	} else {
		logger.Info("playground: cameras disabled, cleaning up")
		expireCameraDevices(ctx, logger)
	}

	if cfg.EnableKuiper {
		logger.Info("playground: kuiper enabled, creating constellation tracker")
		pushTrackedEntities(ctx, logger, &kuiperDevices, "kuiper", []*pb.Entity{
			spacetrackEntity("spacetrack.kuiper.constellation-config", "Kuiper Constellation Tracker",
				"https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=kuiper&FORMAT=tle"),
		})
	} else {
		logger.Info("playground: kuiper disabled, cleaning up")
		expireTrackedEntities(ctx, logger, &kuiperDevices, "kuiper")
	}

	if cfg.EnableISS {
		logger.Info("playground: ISS enabled, creating ISS tracker")
		pushTrackedEntities(ctx, logger, &issDevices, "iss", []*pb.Entity{
			spacetrackEntity("spacetrack.iss", "ISS Tracker",
				"https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle"),
			{
				Id: "spacetrack.spacetrack.iss.iss-zarya",
				Camera: &pb.CameraComponent{
					Streams: []*pb.MediaStream{{
						Label:    "ISS Live Stream",
						Protocol: pb.MediaStreamProtocol_MediaStreamProtocolIframe,
						Url:      "https://www.youtube.com/live/aB1yRz0HhdY?si=u0yFKf_iUD7In-yb",
					}},
				},
			},
		})
	} else {
		logger.Info("playground: ISS disabled, cleaning up")
		expireTrackedEntities(ctx, logger, &issDevices, "iss")
	}

	if cfg.EnableADSB {
		logger.Info("playground: ADS-B enabled, creating receiver")
		adsbCfg, _ := structpb.NewStruct(map[string]any{
			"interval_seconds": float64(5),
			"latitude":         float64(51),
			"longitude":        float64(10),
			"radius_nm":        float64(50),
		})
		adsbdbCfg, _ := structpb.NewStruct(map[string]any{})
		pushTrackedEntities(ctx, logger, &adsbDevices, "adsb", []*pb.Entity{
			{
				Id: "adsb.example",
				Device: &pb.DeviceComponent{
					Parent: proto.String("adsblol.service"),
					Class:  proto.String("location"),
				},
				Config: &pb.ConfigurationComponent{Value: adsbCfg, Version: 1},
			},
			{
				Id:     "adsbdb.service",
				Config: &pb.ConfigurationComponent{Value: adsbdbCfg, Version: 1},
			},
		})
	} else {
		logger.Info("playground: ADS-B disabled, cleaning up")
		expireTrackedEntities(ctx, logger, &adsbDevices, "adsb")
	}

	if cfg.EnableAIS {
		logger.Info("playground: AIS enabled, creating stream")
		aisCfg, _ := structpb.NewStruct(map[string]any{
			"entity_expiry_seconds": float64(300),
			"host":                  "153.44.253.27",
			"latitude":              53.55,
			"longitude":             9.93,
			"port":                  float64(5631),
		})
		pushTrackedEntities(ctx, logger, &aisDevices, "ais", []*pb.Entity{
			{
				Id:    "ais.stream.norway",
				Label: proto.String("AIS Stream Norway"),
				Device: &pb.DeviceComponent{
					Parent: proto.String("ais.service"),
					Class:  proto.String("stream"),
				},
				Config: &pb.ConfigurationComponent{Value: aisCfg, Version: 1},
			},
		})
	} else {
		logger.Info("playground: AIS disabled, cleaning up")
		expireTrackedEntities(ctx, logger, &aisDevices, "ais")
	}

	if cfg.EnableRadar {
		logger.Info("playground: radar enabled, creating simulated radar")
		radarEntityID := controllerName + ".discovered.drone_radar"
		serviceEntityID := controllerName + ".service"
		radarCfg, _ := structpb.NewStruct(map[string]any{
			"latitude":           51.9555,
			"longitude":          4.1694,
			"altitude":           16.0,
			"ground_level":       5.0,
			"range_km":           5.0,
			"track_count":        float64(8),
			"update_interval_ms": float64(1000),
			"track_history":      true,
			"show_drone":         true,
			"show_suspected":     true,
			"show_fixed_wing":    true,
			"show_bird":          true,
			"show_vehicle":       true,
		})
		pushTrackedEntities(ctx, logger, &radarDevices, "radar", []*pb.Entity{
			{
				Id:      radarEntityID,
				Label:   proto.String("Simulated Drone Radar"),
				Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
				Controller: &pb.Controller{
					Id: proto.String(controllerName),
				},
				Device: &pb.DeviceComponent{
					Parent:   proto.String(serviceEntityID),
					Class:    proto.String("drone_radar"),
					Category: proto.String("Missions"),
				},
				Configurable: &pb.ConfigurableComponent{
					Schema: radarSchema(),
				},
				Config: &pb.ConfigurationComponent{Value: radarCfg, Version: 1},
			},
		})
	} else {
		logger.Info("playground: radar disabled, cleaning up")
		expireTrackedEntities(ctx, logger, &radarDevices, "radar")
	}

	if cfg.EnableSensors {
		logger.Info("playground: sensors enabled, creating sensor network")
		sensorEntityID := controllerName + ".discovered.sensor_network"
		serviceEntityID := controllerName + ".service"
		sensorCfg, _ := structpb.NewStruct(map[string]any{
			"update_interval_ms": float64(5000),
		})
		pushTrackedEntities(ctx, logger, &sensorDevices, "sensors", []*pb.Entity{
			{
				Id:      sensorEntityID,
				Label:   proto.String("Lake Geneva Sensor Network"),
				Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
				Controller: &pb.Controller{
					Id: proto.String(controllerName),
				},
				Device: &pb.DeviceComponent{
					Parent:   proto.String(serviceEntityID),
					Class:    proto.String("sensor_network"),
					Category: proto.String("Missions"),
				},
				Configurable: &pb.ConfigurableComponent{
					Schema: sensorNetworkSchema(),
				},
				Config: &pb.ConfigurationComponent{Value: sensorCfg, Version: 1},
			},
		})
	} else {
		logger.Info("playground: sensors disabled, cleaning up")
		expireTrackedEntities(ctx, logger, &sensorDevices, "sensors")
	}

	<-ctx.Done()
	return nil
}

func pushDiscoveredDevices(ctx context.Context, logger *slog.Logger) {
	serviceEntityID := controllerName + ".service"
	subdevices := []*pb.Entity{
		{
			Id:    controllerName + ".discovered.configured",
			Label: proto.String("Configured Device"),
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Parent:   proto.String(serviceEntityID),
				Class:    proto.String("configured"),
				Category: proto.String("Missions"),
			},
			Configurable: &pb.ConfigurableComponent{
				Schema: configuredSchema(),
			},
		},
		{
			Id:    controllerName + ".discovered.unconfigured",
			Label: proto.String("Unconfigured Device"),
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Parent:   proto.String(serviceEntityID),
				Class:    proto.String("unconfigured"),
				Category: proto.String("Missions"),
			},
		},
		{
			Id:    controllerName + ".discovered.broken",
			Label: proto.String("Broken Device"),
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Parent:   proto.String(serviceEntityID),
				Class:    proto.String("broken"),
				Category: proto.String("Missions"),
				State:    pb.DeviceState_DeviceStateFailed,
			},
		},
	}

	discoveredMu.Lock()
	discoveredDevices = nil
	for _, e := range subdevices {
		discoveredDevices = append(discoveredDevices, e.Id)
	}
	discoveredMu.Unlock()

	if err := controller.Push(ctx, subdevices...); err != nil {
		logger.Error("playground: failed to push discovered subdevices", "error", err)
		return
	}

	defaultCfg, _ := structpb.NewStruct(map[string]any{
		"label":            "My Device",
		"interval_seconds": float64(10),
		"enabled":          true,
		"mode":             "normal",
		"crash":            false,
	})
	if err := controller.Push(ctx, &pb.Entity{
		Id:     controllerName + ".discovered.configured",
		Config: &pb.ConfigurationComponent{Value: defaultCfg, Version: 1},
	}); err != nil {
		logger.Error("playground: failed to push default config for configured device", "error", err)
	}
}

func pushCameraDevices(ctx context.Context, logger *slog.Logger) {
	pushTrackedEntities(ctx, logger, &cameraDevices, "cameras", demoCameras())
}

func expireCameraDevices(ctx context.Context, logger *slog.Logger) {
	expireTrackedEntities(ctx, logger, &cameraDevices, "cameras")
}

func spacetrackEntity(id, label, tleURL string) *pb.Entity {
	cfg, _ := structpb.NewStruct(map[string]any{"tle": tleURL})
	return &pb.Entity{
		Id:    id,
		Label: proto.String(label),
		Device: &pb.DeviceComponent{
			Parent: proto.String("spacetrack.service"),
			Class:  proto.String("orbits"),
		},
		Config: &pb.ConfigurationComponent{Value: cfg, Version: 1},
	}
}

func pushTrackedEntities(ctx context.Context, logger *slog.Logger, tracked *[]string, name string, entities []*pb.Entity) {
	discoveredMu.Lock()
	*tracked = nil
	for _, e := range entities {
		*tracked = append(*tracked, e.Id)
	}
	discoveredMu.Unlock()

	if err := controller.Push(ctx, entities...); err != nil {
		logger.Error("playground: failed to push "+name+" entities", "error", err)
	}
}

func expireTrackedEntities(ctx context.Context, logger *slog.Logger, tracked *[]string, name string) {
	discoveredMu.Lock()
	ids := *tracked
	*tracked = nil
	discoveredMu.Unlock()

	if len(ids) == 0 {
		return
	}

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		logger.Error("playground: expire "+name+" connect error", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)
	for _, id := range ids {
		if _, err := client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id}); err != nil {
			logger.Error("playground: failed to expire "+name, "id", id, "error", err)
		}
	}
}

func demoCameras() []*pb.Entity {
	type cam struct {
		id                      string
		label                   string
		lat, lon                float64
		cameras                 []*pb.MediaStream
		fov, rangeMin, rangeMax *float64
		orientation             *pb.OrientationComponent // camera heading
	}
	defs := []cam{
		{
			id: "camera.Grimstad-Gjestehavn", label: "Grimstad Gjestehavn",
			lat: 58.33961934330259, lon: 8.596022037449746,
			cameras: []*pb.MediaStream{{
				Label: "Grimstad Gjestehavn", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolMjpeg,
				Url: "http://213.236.250.78/mjpg/video.mjpg",
			}},
			fov: proto.Float64(45), rangeMin: proto.Float64(20), rangeMax: proto.Float64(300),
			orientation: &pb.OrientationComponent{
				Orientation: &pb.Quaternion{X: 0, Y: 0, Z: 0.0218, W: 0.9998}, // 2.5° yaw = ~north
			},
		},
		{
			id: "camera.Hamburg-Strandweg-Port", label: "Hamburg - Strandweg - Port",
			lat: 53.557779405425684, lon: 9.795713307927747, cameras: []*pb.MediaStream{{
				Label: "Hamburg - Strandweg - Port", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolImage,
				Url: "https://www.hafen-hamburg.de/assets/files/wcpath_uuGl4KkwyCyXd39jVZyN4J6jiKQLVz1u/blankenese.jpg",
			}},
		},
		{
			id: "camera.Hirtshals-Harbour", label: "Hirtshals - Harbour",
			lat: 57.590181767096595, lon: 9.971230030059814, cameras: []*pb.MediaStream{
				{Label: "Nordlig retning", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolImage, Url: "https://data.portofhirtshals.dk/webcam/webcam.aspx?imgno=2&v=2617"},
				{Label: "Østlig retning", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolImage, Url: "https://data.portofhirtshals.dk/webcam/webcam.aspx?imgno=1&v=2620"},
			},
		},
		{
			id: "camera.Kristiansand-Korsvikfjorden", label: "Kristiansand Korsvikfjorden",
			lat: 58.148118763061156, lon: 8.0724835395813, cameras: []*pb.MediaStream{{
				Label: "Kristiansand - Korsvikfjorden", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolHls,
				Url: "https://lon.rtsp.me/ar6PyjiqV9w0wBXoI1cV2A/1767980259/hls/Be5inzdy.m3u8",
			}},
		},
		{
			id: "camera.Kristiansand-Port", label: "Kristiansand Port",
			lat: 58.14666929312107, lon: 8.00609350204468, cameras: []*pb.MediaStream{{
				Label: "Kristiansand Port", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolHls,
				Url: "https://polarislive-lh.akamaized.net/hls/live/2039438/fvn/jqGugHSmKzQwRw5pMerRL/source.m3u8",
			}},
		},
		{
			id: "camera.Vest-Agder-Lindesnes-Lighthouse", label: "Vest-Agder - Lindesnes Lighthouse",
			lat: 57.98463738395755, lon: 7.04800844192505, cameras: []*pb.MediaStream{{
				Label: "Vest-Agder - Lindesnes Lighthouse", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolHls,
				Url: "https://polarislive-lh.akamaized.net/hls/live/2039440/fvn/9wOObU20Nmtsqt8WRITUL/source.m3u8",
			}},
		},
		{
			id: "camera.elbwarte", label: "Hamburg Elbwarte Camera",
			lat: 53.54390832338853, lon: 9.91691900456634, cameras: []*pb.MediaStream{{
				Label: "Altona Ost", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolHls,
				Url: "https://webcam.solutionshosted.de/memfs/152a3e27-17e0-4a83-8552-50fa329f3adf.m3u8",
			}},
		},
		{
			id: "camera.rathausmarkt-hamburg", label: "Rathausmarkt Hamburg",
			lat: 53.5502801744295, lon: 9.994284328189677, cameras: []*pb.MediaStream{{
				Label: "Rathausmarkt Hamburg", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolHls,
				Url: "https://webcam.solutionshosted.de/memfs/f49beef4-ac34-49c2-ae20-ff696814f8c5_output_0.m3u8",
			}},
		},
		{
			id: "camera.wasserturm-wedel", label: "Wasserturm Wedel",
			lat: 53.579862183520746, lon: 9.706512664891015, cameras: []*pb.MediaStream{{
				Label: "Wasserturm Wedel", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolHls,
				Url: "https://webcam.solutionshosted.de/memfs/b423783c-7975-4f18-8351-4f6a0a357e19_output_0.m3u8",
			}},
		},
	}

	entities := make([]*pb.Entity, 0, len(defs))
	for _, d := range defs {
		camEntity := &pb.Entity{
			Id:      d.id,
			Label:   proto.String(d.label),
			Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
			Symbol: &pb.SymbolComponent{
				MilStd2525C: "SFGPE-----",
			},
			Geo: &pb.GeoSpatialComponent{
				Latitude:  d.lat,
				Longitude: d.lon,
			},
			Camera: &pb.CameraComponent{
				Streams:  d.cameras,
				Fov:      d.fov,
				RangeMin: d.rangeMin,
				RangeMax: d.rangeMax,
			},
		}
		if d.orientation != nil {
			camEntity.Orientation = d.orientation
		}
		entities = append(entities, camEntity)
	}
	return entities
}

func expireDiscoveredDevices(ctx context.Context, logger *slog.Logger) {
	discoveredMu.Lock()
	ids := discoveredDevices
	discoveredDevices = nil
	discoveredMu.Unlock()

	if len(ids) == 0 {
		return
	}

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		logger.Error("playground: expire connect error", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)
	for _, id := range ids {
		if _, err := client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id}); err != nil {
			logger.Error("playground: failed to expire subdevice", "id", id, "error", err)
		}
	}
}

// -------------------------------------------------------------------
// Child handlers
// -------------------------------------------------------------------

func runChild(ctx context.Context, logger *slog.Logger, entityID string) error {
	// Determine the device class by reading the entity.
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	resp, err := pb.NewWorldServiceClient(grpcConn).GetEntity(ctx, &pb.GetEntityRequest{Id: entityID})
	_ = grpcConn.Close()
	if err != nil {
		return fmt.Errorf("get entity %s: %w", entityID, err)
	}

	deviceClass := resp.Entity.Device.GetClass()

	switch deviceClass {
	case "configured":
		// Watch for subdevice children of this configured device.
		subClasses := []controller.DeviceClass{
			{Class: "subdevice", Label: "Subdevice", Schema: subdeviceSchema()},
		}
		go controller.WatchChildren(ctx, entityID, controllerName, subClasses, func(ctx context.Context, subEntityID string) error { //nolint:errcheck // fire-and-forget goroutine
			return controller.Run(ctx, subEntityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
				return runSubdevice(ctx, logger, entity, ready)
			})
		})

		// Continuous controller — blocks until context cancelled.
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			return runConfigured(ctx, logger, entity, ready)
		})

	case "unconfigured":
		// Polling controller — runs periodically.
		return controller.RunPolled(ctx, entityID, func(ctx context.Context, entity *pb.Entity) (time.Duration, error) {
			return pollUnconfigured(ctx, logger, entity)
		})

	case "manual":
		// Continuous controller — blocks until context cancelled.
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			return runManual(ctx, logger, entity, ready)
		})

	case "drone_radar":
		// Simulated drone detection radar.
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			return runRadar(ctx, logger, entity, ready)
		})

	case "sensor_network":
		// Simulated weather + hazard sensor network around Lake Geneva.
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			return runSensorNetwork(ctx, logger, entity, ready)
		})

	default:
		return fmt.Errorf("unknown device class: %s", deviceClass)
	}
}

// -------------------------------------------------------------------
// Continuous controller: "configured" device
// -------------------------------------------------------------------

func runConfigured(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg := parseConfiguredConfig(entity)

	if cfg.Crash {
		return fmt.Errorf("crash requested via configuration")
	}

	logger.Info("playground: configured device running",
		"entityID", entity.Id,
		"label", cfg.Label,
		"interval", cfg.IntervalSeconds,
		"enabled", cfg.Enabled,
		"mode", cfg.Mode,
		"discoverSubdevices", cfg.DiscoverSubdevices,
	)

	ready()

	// Push current values back as configurable value so the UI shows them.
	pushConfigurableValue(ctx, entity)

	// Manage nested subdevices based on the discover_subdevices toggle.
	subIDs := []string{
		entity.Id + ".sub.alpha",
		entity.Id + ".sub.beta",
	}
	if cfg.DiscoverSubdevices {
		logger.Info("playground: creating nested subdevices", "parent", entity.Id)
		var subs []*pb.Entity
		for _, id := range subIDs {
			subs = append(subs, &pb.Entity{
				Id:    id,
				Label: proto.String("Subdevice " + id[len(entity.Id)+5:]),
				Controller: &pb.Controller{
					Id: proto.String(controllerName),
				},
				Device: &pb.DeviceComponent{
					Parent:   proto.String(entity.Id),
					Class:    proto.String("subdevice"),
					Category: proto.String("Missions"),
				},
				Configurable: &pb.ConfigurableComponent{
					Schema: subdeviceSchema(),
				},
			})
		}
		if err := controller.Push(ctx, subs...); err != nil {
			logger.Error("playground: failed to push subdevices", "error", err)
		}
	}
	defer func() {
		if !cfg.DiscoverSubdevices {
			return
		}
		expCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		grpcConn, err := builtin.BuiltinClientConn()
		if err != nil {
			return
		}
		defer func() { _ = grpcConn.Close() }()
		client := pb.NewWorldServiceClient(grpcConn)
		for _, id := range subIDs {
			_, _ = client.ExpireEntity(expCtx, &pb.ExpireEntityRequest{Id: id})
		}
	}()

	if !cfg.Enabled {
		logger.Info("playground: configured device disabled, waiting")
		<-ctx.Done()
		return nil
	}

	// Simulate continuous work with periodic logging.
	ticker := time.NewTicker(time.Duration(cfg.IntervalSeconds) * time.Second)
	defer ticker.Stop()

	count := 0
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			count++
			logger.Info("playground: configured device tick",
				"entityID", entity.Id,
				"count", count,
				"mode", cfg.Mode,
			)

			// Push a metric so the frontend can see activity.
			pushMetric(ctx, entity.Id, "ticks", uint64(count))
		}
	}
}

type configuredConfig struct {
	Label              string
	IntervalSeconds    int
	Enabled            bool
	Mode               string
	Crash              bool
	DiscoverSubdevices bool
}

func parseConfiguredConfig(entity *pb.Entity) configuredConfig {
	cfg := configuredConfig{
		Label:           "My Device",
		IntervalSeconds: 10,
		Enabled:         true,
		Mode:            "normal",
	}
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return cfg
	}
	fields := entity.Config.Value.Fields
	if v, ok := fields["label"]; ok {
		cfg.Label = v.GetStringValue()
	}
	if v, ok := fields["interval_seconds"]; ok {
		cfg.IntervalSeconds = int(v.GetNumberValue())
		if cfg.IntervalSeconds < 1 {
			cfg.IntervalSeconds = 1
		}
	}
	if v, ok := fields["enabled"]; ok {
		cfg.Enabled = v.GetBoolValue()
	}
	if v, ok := fields["mode"]; ok {
		cfg.Mode = v.GetStringValue()
	}
	if v, ok := fields["crash"]; ok {
		cfg.Crash = v.GetBoolValue()
	}
	if v, ok := fields["discover_subdevices"]; ok {
		cfg.DiscoverSubdevices = v.GetBoolValue()
	}
	return cfg
}

// -------------------------------------------------------------------
// Polling controller: "unconfigured" device
// -------------------------------------------------------------------

func pollUnconfigured(ctx context.Context, logger *slog.Logger, entity *pb.Entity) (time.Duration, error) {
	cfg := parseUnconfiguredConfig(entity)

	if cfg.Crash {
		return 0, fmt.Errorf("crash requested via configuration")
	}

	logger.Info("playground: unconfigured device polled",
		"entityID", entity.Id,
		"query", cfg.Query,
		"interval", cfg.PollIntervalSeconds,
	)

	pushMetric(ctx, entity.Id, "polls", 1)

	return time.Duration(cfg.PollIntervalSeconds) * time.Second, nil
}

type unconfiguredConfig struct {
	PollIntervalSeconds int
	Query               string
	Crash               bool
}

func parseUnconfiguredConfig(entity *pb.Entity) unconfiguredConfig {
	cfg := unconfiguredConfig{
		PollIntervalSeconds: 5,
	}
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return cfg
	}
	fields := entity.Config.Value.Fields
	if v, ok := fields["poll_interval_seconds"]; ok {
		cfg.PollIntervalSeconds = int(v.GetNumberValue())
		if cfg.PollIntervalSeconds < 1 {
			cfg.PollIntervalSeconds = 1
		}
	}
	if v, ok := fields["query"]; ok {
		cfg.Query = v.GetStringValue()
	}
	if v, ok := fields["crash"]; ok {
		cfg.Crash = v.GetBoolValue()
	}
	return cfg
}

// -------------------------------------------------------------------
// Continuous controller: "manual" device
// -------------------------------------------------------------------

func runManual(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg := parseManualConfig(entity)

	if cfg.Crash {
		return fmt.Errorf("crash requested via configuration")
	}

	logger.Info("playground: manual device running",
		"entityID", entity.Id,
		"name", cfg.Name,
		"value", cfg.Value,
	)

	ready()

	pushConfigurableValue(ctx, entity)

	<-ctx.Done()
	return nil
}

type manualConfig struct {
	Name  string
	Value int
	Crash bool
}

func parseManualConfig(entity *pb.Entity) manualConfig {
	cfg := manualConfig{
		Value: 42,
	}
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return cfg
	}
	fields := entity.Config.Value.Fields
	if v, ok := fields["name"]; ok {
		cfg.Name = v.GetStringValue()
	}
	if v, ok := fields["value"]; ok {
		cfg.Value = int(v.GetNumberValue())
	}
	if v, ok := fields["crash"]; ok {
		cfg.Crash = v.GetBoolValue()
	}
	return cfg
}

// -------------------------------------------------------------------
// Continuous controller: "subdevice" (nested under configured device)
// -------------------------------------------------------------------

func runSubdevice(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	var tag string
	var crash bool
	if entity.Config != nil && entity.Config.Value != nil && entity.Config.Value.Fields != nil {
		if v, ok := entity.Config.Value.Fields["tag"]; ok {
			tag = v.GetStringValue()
		}
		if v, ok := entity.Config.Value.Fields["crash"]; ok {
			crash = v.GetBoolValue()
		}
	}

	if crash {
		return fmt.Errorf("crash requested via configuration")
	}

	logger.Info("playground: subdevice running",
		"entityID", entity.Id,
		"tag", tag,
	)

	ready()

	pushConfigurableValue(ctx, entity)

	<-ctx.Done()
	return nil
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

func pushConfigurableValue(ctx context.Context, entity *pb.Entity) {
	if entity.Config == nil || entity.Config.Value == nil {
		return
	}
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return
	}
	defer func() { _ = grpcConn.Close() }()

	var cfg *pb.ConfigurableComponent
	if entity.Configurable != nil {
		cfg = proto.Clone(entity.Configurable).(*pb.ConfigurableComponent)
	} else {
		cfg = &pb.ConfigurableComponent{}
	}
	cfg.Value = entity.Config.Value

	client := pb.NewWorldServiceClient(grpcConn)
	_, _ = client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:           entity.Id,
			Configurable: cfg,
		}},
	})
}

func pushMetric(ctx context.Context, entityID, label string, val uint64) {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)
	_, _ = client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: entityID,
			Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
				{
					Kind:  pb.MetricKind_MetricKindCount.Enum(),
					Unit:  pb.MetricUnit_MetricUnitCount,
					Label: proto.String(label),
					Id:    proto.Uint32(1),
					Val:   &pb.Metric_Uint64{Uint64: val},
				},
			}},
		}},
	})
}
