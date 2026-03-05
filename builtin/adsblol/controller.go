package adsblol

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type PollerConfig struct {
	ConfigKey       string
	Latitude        float64
	Longitude       float64
	RadiusNM        int
	Callsign        string
	ICAO            string
	IntervalSeconds int
}

func (c *PollerConfig) Interval() time.Duration {
	if c.IntervalSeconds <= 0 {
		return 5 * time.Second
	}
	return time.Duration(c.IntervalSeconds) * time.Second
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "adsblol"

	locationSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"latitude": map[string]any{
				"type":           "number",
				"title":          "Latitude",
				"description":    "Center latitude for area search",
				"ui:placeholder": "e.g. 48.8566",
				"ui:order":       0,
			},
			"longitude": map[string]any{
				"type":           "number",
				"title":          "Longitude",
				"description":    "Center longitude for area search",
				"ui:placeholder": "e.g. 2.3522",
				"ui:order":       1,
			},
			"radius_nm": map[string]any{
				"type":        "number",
				"title":       "Radius",
				"description": "Search radius around the center point",
				"default":     50,
				"minimum":     1,
				"ui:unit":     "NM",
				"ui:order":    2,
			},
			"interval_seconds": map[string]any{
				"type":        "number",
				"title":       "Poll Interval",
				"description": "How often to fetch aircraft data",
				"default":     5,
				"minimum":     1,
				"ui:unit":     "s",
				"ui:order":    3,
			},
		},
		"required": []any{"latitude", "longitude"},
	})
	militarySchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"interval_seconds": map[string]any{
				"type":        "number",
				"title":       "Poll Interval",
				"description": "How often to fetch military aircraft data",
				"default":     5,
				"minimum":     1,
				"ui:unit":     "s",
			},
		},
	})
	callsignSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"callsign": map[string]any{
				"type":           "string",
				"title":          "Callsign",
				"description":    "Aircraft callsign to track",
				"ui:placeholder": "e.g. BAW123",
				"ui:order":       0,
			},
			"interval_seconds": map[string]any{
				"type":        "number",
				"title":       "Poll Interval",
				"description": "How often to fetch aircraft data",
				"default":     5,
				"minimum":     1,
				"ui:unit":     "s",
				"ui:order":    1,
			},
		},
		"required": []any{"callsign"},
	})
	icaoSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"icao": map[string]any{
				"type":           "string",
				"title":          "ICAO Address",
				"description":    "Aircraft ICAO hex address to track",
				"ui:placeholder": "e.g. A0B1C2",
				"ui:order":       0,
			},
			"interval_seconds": map[string]any{
				"type":        "number",
				"title":       "Poll Interval",
				"description": "How often to fetch aircraft data",
				"default":     5,
				"minimum":     1,
				"ui:unit":     "s",
				"ui:order":    1,
			},
		},
		"required": []any{"icao"},
	})

	serviceEntityID := controllerName + ".service"
	if err := controller.Push(ctx, &pb.Entity{
		Id:    serviceEntityID,
		Label: proto.String("ADS-B"),
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Feeds"),
		},
		Configurable: &pb.ConfigurableComponent{
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{Class: "location", Label: "Location Poller"},
				{Class: "military", Label: "Military Poller"},
				{Class: "callsign", Label: "Callsign Poller"},
				{Class: "icao", Label: "ICAO Poller"},
			},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("plane"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "location", Label: "Location Poller", Schema: locationSchema},
		{Class: "military", Label: "Military Poller", Schema: militarySchema},
		{Class: "callsign", Label: "Callsign Poller", Schema: callsignSchema},
		{Class: "icao", Label: "ICAO Poller", Schema: icaoSchema},
	}

	return controller.WatchChildren(ctx, serviceEntityID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.RunPolled(ctx, entityID, func(ctx context.Context, entity *pb.Entity) (time.Duration, error) {
			return pollOnce(ctx, logger, entity)
		})
	})
}

func pollOnce(ctx context.Context, logger *slog.Logger, entity *pb.Entity) (time.Duration, error) {
	pollerConfig, err := parsePollerConfig(entity)
	if err != nil {
		return 0, fmt.Errorf("parse config: %w", err)
	}

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return 0, fmt.Errorf("gRPC connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)
	if err := pollAndPush(ctx, logger, entity.Id, pollerConfig, NewADSBClient(), worldClient); err != nil {
		return 0, err
	}
	return pollerConfig.Interval(), nil
}

func pollAndPush(ctx context.Context, _ *slog.Logger, entityID string, config *PollerConfig, adsbClient *ADSBClient, worldClient pb.WorldServiceClient) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	var aircraft []ADSBAircraft
	var err error

	requestCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	fetchStart := time.Now()

	switch config.ConfigKey {
	case "location":
		if config.RadiusNM <= 0 {
			config.RadiusNM = 50
		}
		aircraft, err = adsbClient.FetchByLocation(requestCtx, config.Latitude, config.Longitude, config.RadiusNM)

	case "military":
		aircraft, err = adsbClient.FetchMilitary(requestCtx)

	case "callsign":
		if config.Callsign == "" {
			return fmt.Errorf("callsign query requires callsign field")
		}
		aircraft, err = adsbClient.FetchByCallsign(requestCtx, config.Callsign)

	case "icao":
		if config.ICAO == "" {
			return fmt.Errorf("ICAO query requires icao field")
		}
		aircraft, err = adsbClient.FetchByICAO(requestCtx, config.ICAO)

	default:
		return fmt.Errorf("unknown device class %q", config.ConfigKey)
	}

	fetchLatencyMs := float32(time.Since(fetchStart).Milliseconds())

	if err != nil {
		return fmt.Errorf("fetch aircraft data: %w", err)
	}

	var entities []*pb.Entity
	for _, ac := range aircraft {
		entity := ADSBAircraftToEntity(ac, "adsblol", entityID, time.Duration(config.IntervalSeconds))
		if entity != nil {
			entities = append(entities, entity)
		}
	}

	// Push metrics for this poller.
	_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: entityID,
			Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
				{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("aircraft tracked"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: uint64(len(aircraft))}},
				{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("entities pushed"), Id: proto.Uint32(2), Val: &pb.Metric_Uint64{Uint64: uint64(len(entities))}},
				{Kind: pb.MetricKind_MetricKindLatency.Enum(), Unit: pb.MetricUnit_MetricUnitMillisecond, Label: proto.String("API latency"), Id: proto.Uint32(3), Val: &pb.Metric_Float{Float: fetchLatencyMs}},
			}},
		}},
	})

	if len(entities) == 0 {
		return nil
	}

	_, err = worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: entities,
	})
	if err != nil {
		return fmt.Errorf("push entities: %w", err)
	}
	return nil
}

func parsePollerConfig(entity *pb.Entity) (*PollerConfig, error) {
	config := entity.Config
	if config == nil {
		return nil, fmt.Errorf("entity %s has no config", entity.Id)
	}
	if config.Value == nil || config.Value.Fields == nil {
		return nil, fmt.Errorf("empty config value")
	}

	fields := config.Value.Fields
	pollerConfig := &PollerConfig{
		ConfigKey: entity.Device.GetClass(),
	}

	if v, ok := fields["latitude"]; ok {
		pollerConfig.Latitude = v.GetNumberValue()
		if pollerConfig.Latitude < -90 || pollerConfig.Latitude > 90 {
			return nil, fmt.Errorf("latitude %g is out of range [-90, 90]", pollerConfig.Latitude)
		}
	}
	if v, ok := fields["longitude"]; ok {
		pollerConfig.Longitude = v.GetNumberValue()
		if pollerConfig.Longitude < -180 || pollerConfig.Longitude > 180 {
			return nil, fmt.Errorf("longitude %g is out of range [-180, 180]", pollerConfig.Longitude)
		}
	}
	if v, ok := fields["radius_nm"]; ok {
		pollerConfig.RadiusNM = int(v.GetNumberValue())
	}
	if v, ok := fields["callsign"]; ok {
		pollerConfig.Callsign = v.GetStringValue()
	}
	if v, ok := fields["icao"]; ok {
		pollerConfig.ICAO = v.GetStringValue()
	}
	if v, ok := fields["interval_seconds"]; ok {
		pollerConfig.IntervalSeconds = int(v.GetNumberValue())
	}

	return pollerConfig, nil
}

func init() {
	builtin.Register("adsblol", Run)
}
