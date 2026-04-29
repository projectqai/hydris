package mission

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"path"
	"strings"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/engine"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func init() {
	builtin.Register("mission", Run)
}

type indexFile struct {
	MissionKit *pb.MissionKit `json:"missionkit"`
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	resp, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: "mission"})
	if err != nil {
		logger.Info("no active mission")
		<-ctx.Done()
		return ctx.Err()
	}

	entity := resp.Entity
	if entity == nil || entity.Artifact == nil {
		logger.Info("mission entity has no artifact")
		<-ctx.Done()
		return ctx.Err()
	}

	if err := applyMission(ctx, logger, client, entity); err != nil {
		return fmt.Errorf("apply mission: %w", err)
	}

	<-ctx.Done()
	return ctx.Err()
}

func applyMission(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, entity *pb.Entity) error {
	store := artifacts.Server.Local()
	if store == nil {
		return fmt.Errorf("local artifact store not available")
	}

	rc, err := store.Get(ctx, entity.Artifact.Id)
	if err != nil {
		return fmt.Errorf("open mission artifact %s: %w", entity.Artifact.Id, err)
	}
	defer rc.Close()

	gz, err := gzip.NewReader(rc)
	if err != nil {
		return fmt.Errorf("gzip open: %w", err)
	}
	defer func() { _ = gz.Close() }()

	tr := tar.NewReader(gz)

	var worldYAML []byte
	var indexJSON []byte

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar read: %w", err)
		}

		if hdr.Typeflag != tar.TypeReg {
			continue
		}

		name := path.Clean(hdr.Name)
		if strings.Contains(name, "..") {
			continue
		}

		switch {
		case name == "world.yaml":
			worldYAML, err = io.ReadAll(tr)
			if err != nil {
				return fmt.Errorf("read world.yaml: %w", err)
			}

		case name == "index.json":
			indexJSON, err = io.ReadAll(tr)
			if err != nil {
				return fmt.Errorf("read index.json: %w", err)
			}

		case strings.HasPrefix(name, "artifacts/"):
			blobID := strings.TrimPrefix(name, "artifacts/")
			if blobID == "" {
				continue
			}
			if err := store.Put(ctx, blobID, tr); err != nil {
				return fmt.Errorf("store artifact %s: %w", blobID, err)
			}
			logger.Info("extracted mission artifact", "id", blobID)
		}
	}

	if worldYAML == nil {
		return fmt.Errorf("mission package has no world.yaml")
	}

	entities, err := engine.ParseEntities(worldYAML)
	if err != nil {
		return fmt.Errorf("parse world.yaml: %w", err)
	}

	now := timestamppb.Now()
	for _, e := range entities {
		if e.Lifetime == nil {
			e.Lifetime = &pb.Lifetime{}
		}
		if !e.Lifetime.From.IsValid() {
			e.Lifetime.From = now
		}
		if e.Lifetime.Fresh == nil || !e.Lifetime.Fresh.IsValid() {
			e.Lifetime.Fresh = now
		}
	}

	if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: entities}); err != nil {
		return fmt.Errorf("push mission entities: %w", err)
	}
	logger.Info("applied mission entities", "count", len(entities))

	if len(indexJSON) > 0 {
		if err := applyMissionKit(ctx, logger, client, indexJSON); err != nil {
			logger.Warn("failed to apply mission kit", "error", err)
		}
	}

	return nil
}

func applyMissionKit(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return nil
	}

	var idx indexFile
	if err := json.Unmarshal(data, &idx); err != nil {
		return fmt.Errorf("parse index.json: %w", err)
	}

	if idx.MissionKit == nil {
		return nil
	}

	nodeResp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return fmt.Errorf("get local node: %w", err)
	}

	nodeID := nodeResp.Entity.Id
	if _, err := client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: nodeID,
			Device: &pb.DeviceComponent{
				Node: &pb.NodeDevice{
					MissionKit: idx.MissionKit,
				},
			},
		}},
	}); err != nil {
		return fmt.Errorf("push mission kit: %w", err)
	}

	logger.Info("applied mission kit to node", "node", nodeID, "layouts", len(idx.MissionKit.Layouts))
	return nil
}
