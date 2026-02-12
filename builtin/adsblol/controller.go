package adsblol

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
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

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "adsblol"

	locationSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"latitude":         map[string]any{"type": "number"},
			"longitude":        map[string]any{"type": "number"},
			"radius_nm":        map[string]any{"type": "number"},
			"interval_seconds": map[string]any{"type": "number"},
		},
		"required": []any{"latitude", "longitude"},
	})
	militarySchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"interval_seconds": map[string]any{"type": "number"},
		},
	})
	callsignSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"callsign":         map[string]any{"type": "string"},
			"interval_seconds": map[string]any{"type": "number"},
		},
		"required": []any{"callsign"},
	})
	icaoSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"icao":             map[string]any{"type": "string"},
			"interval_seconds": map[string]any{"type": "number"},
		},
		"required": []any{"icao"},
	})

	if err := controller.PublishDevice(ctx, controllerName+".service", controllerName, []*pb.Configurable{
		{Key: "adsblol.location.v0", Schema: locationSchema},
		{Key: "adsblol.military.v0", Schema: militarySchema},
		{Key: "adsblol.callsign.v0", Schema: callsignSchema},
		{Key: "adsblol.icao.v0", Schema: icaoSchema},
	}, nil, nil); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	return controller.Run1to1(ctx, controllerName, func(ctx context.Context, config *pb.Entity, _ *pb.Entity) error {
		return runPoller(ctx, logger, config)
	})
}

func runPoller(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	config := entity.Config
	if config == nil {
		return fmt.Errorf("entity %s has no config", entity.Id)
	}
	pollerConfig, err := parsePollerConfig(config)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	if pollerConfig.IntervalSeconds <= 0 {
		pollerConfig.IntervalSeconds = 5
	}

	logger.Info("Starting poller", "entityID", entity.Id, "configKey", pollerConfig.ConfigKey, "interval", pollerConfig.IntervalSeconds)

	adsbClient := NewADSBClient()

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	ticker := time.NewTicker(time.Duration(pollerConfig.IntervalSeconds) * time.Second)
	defer ticker.Stop()

	// Initial poll
	pollAndPush(ctx, logger, entity.Id, pollerConfig, adsbClient, worldClient)

	for {
		select {
		case <-ctx.Done():
			logger.Info("Poller shutting down", "entityID", entity.Id)
			return ctx.Err()
		case <-ticker.C:
			pollAndPush(ctx, logger, entity.Id, pollerConfig, adsbClient, worldClient)
		}
	}
}

func pollAndPush(ctx context.Context, logger *slog.Logger, entityID string, config *PollerConfig, adsbClient *ADSBClient, worldClient pb.WorldServiceClient) {
	select {
	case <-ctx.Done():
		return
	default:
	}

	var aircraft []ADSBAircraft
	var err error

	requestCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	switch config.ConfigKey {
	case "adsblol.location.v0":
		if config.RadiusNM <= 0 {
			config.RadiusNM = 50
		}
		aircraft, err = adsbClient.FetchByLocation(requestCtx, config.Latitude, config.Longitude, config.RadiusNM)

	case "adsblol.military.v0":
		aircraft, err = adsbClient.FetchMilitary(requestCtx)

	case "adsblol.callsign.v0":
		if config.Callsign == "" {
			logger.Error("Callsign query requires callsign field", "entityID", entityID)
			return
		}
		aircraft, err = adsbClient.FetchByCallsign(requestCtx, config.Callsign)

	case "adsblol.icao.v0":
		if config.ICAO == "" {
			logger.Error("ICAO query requires icao field", "entityID", entityID)
			return
		}
		aircraft, err = adsbClient.FetchByICAO(requestCtx, config.ICAO)

	default:
		logger.Error("Unknown config key", "entityID", entityID, "configKey", config.ConfigKey)
		return
	}

	if err != nil {
		logger.Error("Failed to fetch aircraft data", "entityID", entityID, "error", err)
		return
	}

	var entities []*pb.Entity
	for _, ac := range aircraft {
		entity := ADSBAircraftToEntity(ac, "adsblol", entityID, time.Duration(config.IntervalSeconds))
		if entity != nil {
			entities = append(entities, entity)
		}
	}

	if len(entities) == 0 {
		return
	}

	_, err = worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: entities,
	})
	if err != nil {
		logger.Error("Failed to push entities", "entityID", entityID, "error", err)
		return
	}
}

func parsePollerConfig(config *pb.ConfigurationComponent) (*PollerConfig, error) {
	if config.Value == nil || config.Value.Fields == nil {
		return nil, fmt.Errorf("empty config value")
	}

	fields := config.Value.Fields
	pollerConfig := &PollerConfig{
		ConfigKey: config.Key,
	}

	if v, ok := fields["latitude"]; ok {
		pollerConfig.Latitude = v.GetNumberValue()
	}
	if v, ok := fields["longitude"]; ok {
		pollerConfig.Longitude = v.GetNumberValue()
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
