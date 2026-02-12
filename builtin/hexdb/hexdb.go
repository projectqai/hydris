package hexdb

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/structpb"
)

const defaultBaseURL = "https://hexdb.io"

type AircraftResponse struct {
	ICAOTypeCode     string `json:"ICAOTypeCode"`
	Manufacturer     string `json:"Manufacturer"`
	ModeS            string `json:"ModeS"`
	OperatorFlagCode string `json:"OperatorFlagCode"`
	RegisteredOwners string `json:"RegisteredOwners"`
	Registration     string `json:"Registration"`
	Type             string `json:"Type"`
}

func resolveImageURL(ctx context.Context, client *http.Client, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	imageURL := strings.TrimSpace(string(body))
	if imageURL == "" || !strings.HasPrefix(imageURL, "http") {
		return "", fmt.Errorf("no image")
	}
	return imageURL, nil
}

func lookupAircraft(ctx context.Context, client *http.Client, baseURL string, icaoHex string) (*AircraftResponse, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", baseURL+"/api/v1/aircraft/"+icaoHex, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var ac AircraftResponse
	if err := json.NewDecoder(resp.Body).Decode(&ac); err != nil {
		return nil, err
	}
	return &ac, nil
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "hexdb"

	schema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"url":            map[string]any{"type": "string", "description": "Base URL for hexdb.io"},
			"administrative": map[string]any{"type": "boolean", "description": "Also enrich AdministrativeComponent from aircraft API"},
		},
	})

	if err := controller.PublishDevice(ctx, controllerName+".service", controllerName, []*pb.Configurable{
		{Key: "hexdb.enrich.v0", Schema: schema},
	}, nil, nil); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	return controller.Run1to1(ctx, controllerName, func(ctx context.Context, config *pb.Entity, _ *pb.Entity) error {
		baseURL := defaultBaseURL
		enrichAdmin := false
		if config.Config != nil && config.Config.Value != nil && config.Config.Value.Fields != nil {
			if v, ok := config.Config.Value.Fields["url"]; ok && v.GetStringValue() != "" {
				baseURL = v.GetStringValue()
			}
			if v, ok := config.Config.Value.Fields["administrative"]; ok {
				enrichAdmin = v.GetBoolValue()
			}
		}
		return runEnricher(ctx, logger, baseURL, enrichAdmin)
	})
}

func runEnricher(ctx context.Context, logger *slog.Logger, baseURL string, enrichAdmin bool) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	maxRate := float32(3)
	stream, err := goclient.WatchEntitiesWithRetry(ctx, worldClient, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{27}, // TransponderComponent
			Not: &pb.EntityFilter{
				Component: []uint32{15}, // exclude entities that already have CameraComponent
			},
		},
		Behaviour: &pb.WatchBehavior{
			MaxRateHz: &maxRate,
		},
	})
	if err != nil {
		return fmt.Errorf("watch: %w", err)
	}

	httpClient := &http.Client{Timeout: 10 * time.Second}

	logger.Info("watching for transponder entities", "baseURL", baseURL, "administrative", enrichAdmin)

	for {
		event, err := stream.Recv()
		if err != nil {
			return fmt.Errorf("recv: %w", err)
		}

		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}

		entity := event.Entity
		if entity.Transponder == nil || entity.Transponder.Adsb == nil || entity.Transponder.Adsb.IcaoAddress == nil {
			continue
		}

		icaoHex := fmt.Sprintf("%06x", *entity.Transponder.Adsb.IcaoAddress)

		enriched := &pb.Entity{Id: entity.Id}
		changed := false

		imageURL, err := resolveImageURL(ctx, httpClient, baseURL+"/hex-image?hex="+icaoHex)
		if err == nil {
			enriched.Camera = &pb.CameraComponent{
				Cameras: []*pb.Camera{{
					Label:    icaoHex,
					Url:      imageURL,
					Protocol: pb.CameraProtocol_CameraProtocolImage,
				}},
			}
			changed = true
		}

		if enrichAdmin {
			ac, err := lookupAircraft(ctx, httpClient, baseURL, icaoHex)
			if err == nil {
				admin := &pb.AdministrativeComponent{}
				if ac.Registration != "" {
					admin.Id = &ac.Registration
				}
				if ac.RegisteredOwners != "" {
					admin.Owner = &ac.RegisteredOwners
				}
				if ac.Manufacturer != "" {
					admin.Manufacturer = &ac.Manufacturer
				}
				if ac.Type != "" {
					admin.Model = &ac.Type
				}
				if ac.ICAOTypeCode != "" {
					admin.Flag = &ac.ICAOTypeCode
				}
				enriched.Administrative = admin
				changed = true
			}
		}

		if !changed {
			continue
		}

		_, err = worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{enriched},
		})
		if err != nil {
			logger.Error("failed to push enrichment", "entityID", entity.Id, "error", err)
			continue
		}

		logger.Debug("enriched entity", "entityID", entity.Id, "icao", icaoHex)
	}
}

func init() {
	builtin.Register("hexdb", Run)
}
