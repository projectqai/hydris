package adsbdb

import (
	"bufio"
	"compress/gzip"
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

const defaultDBURL = "https://downloads.adsbexchange.com/downloads/basic-ac-db.json.gz"

type AircraftRecord struct {
	ICAO         string  `json:"icao"`
	Registration string  `json:"reg"`
	ICAOType     *string `json:"icaotype"`
	Year         *string `json:"year"`
	Manufacturer *string `json:"manufacturer"`
	Model        *string `json:"model"`
	OwnerOp      *string `json:"ownop"`
	Mil          bool    `json:"mil"`
}

func downloadDB(ctx context.Context, logger *slog.Logger, url string) (map[string]*AircraftRecord, error) {
	logger.Info("downloading ADS-B Exchange aircraft database", "url", url)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("download: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	gz, err := gzip.NewReader(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("gzip reader: %w", err)
	}
	defer func() { _ = gz.Close() }()

	db := make(map[string]*AircraftRecord)
	scanner := bufio.NewScanner(gz)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var rec AircraftRecord
		if err := json.Unmarshal(line, &rec); err != nil {
			continue
		}
		if rec.ICAO != "" {
			db[strings.ToLower(rec.ICAO)] = &rec
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan: %w", err)
	}

	logger.Info("loaded ADS-B Exchange database", "records", len(db))
	return db, nil
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "adsbdb"

	schema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"url": map[string]any{"type": "string", "description": "URL to basic-ac-db.json.gz"},
		},
	})

	if err := controller.PublishDevice(ctx, controllerName+".service", controllerName, []*pb.Configurable{
		{Key: "adsbdb.enrich.v0", Schema: schema},
	}, nil, nil); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	return controller.Run1to1(ctx, controllerName, func(ctx context.Context, config *pb.Entity, _ *pb.Entity) error {
		url := defaultDBURL
		if config.Config != nil && config.Config.Value != nil && config.Config.Value.Fields != nil {
			if v, ok := config.Config.Value.Fields["url"]; ok && v.GetStringValue() != "" {
				url = v.GetStringValue()
			}
		}
		return runEnricher(ctx, logger, url)
	})
}

func runEnricher(ctx context.Context, logger *slog.Logger, url string) error {
	db, err := downloadDB(ctx, logger, url)
	if err != nil {
		return fmt.Errorf("download database: %w", err)
	}

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, worldClient, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{27}, // TransponderComponent
			Not: &pb.EntityFilter{
				Component: []uint32{28}, // exclude already-enriched (AdministrativeComponent)
			},
		},
	})
	if err != nil {
		return fmt.Errorf("watch: %w", err)
	}

	logger.Info("watching for transponder entities")

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
		rec, ok := db[icaoHex]
		if !ok {
			continue
		}

		admin := &pb.AdministrativeComponent{}
		hasData := false

		if rec.Registration != "" {
			admin.Id = &rec.Registration
			hasData = true
		}
		if rec.OwnerOp != nil && *rec.OwnerOp != "" {
			admin.Owner = rec.OwnerOp
			hasData = true
		}
		if rec.Manufacturer != nil && *rec.Manufacturer != "" {
			admin.Manufacturer = rec.Manufacturer
			hasData = true
		}
		if rec.Model != nil && *rec.Model != "" {
			admin.Model = rec.Model
			hasData = true
		}
		if rec.ICAOType != nil && *rec.ICAOType != "" {
			flag := *rec.ICAOType
			admin.Flag = &flag
			hasData = true
		}

		if !hasData {
			continue
		}

		_, err = worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id:             entity.Id,
				Administrative: admin,
			}},
		})
		if err != nil {
			logger.Error("failed to push administrative data", "entityID", entity.Id, "error", err)
			continue
		}

		logger.Debug("enriched entity", "entityID", entity.Id, "icao", icaoHex, "reg", rec.Registration)
	}
}

func init() {
	builtin.Register("adsbdb", Run)
}
