package sapient

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/aep/gosapient/pkg/sapient"
	sapientpb "github.com/aep/gosapient/pkg/sapientpb"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"

	"google.golang.org/protobuf/proto"
)

// runClient connects to a remote SAPIENT server and:
// - watches hydris entities with SensorComponent, sends Registration for each
// - forwards detection entities as DetectionReports
// - sends periodic StatusReports
// - no tasking support
func runClient(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	addr := getConfigString(entity, "address")
	if addr == "" {
		return fmt.Errorf("address is required")
	}

	ready()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		logger.Info("connecting to SAPIENT server", "address", addr)
		conn, err := sapient.Dial(addr)
		if err != nil {
			logger.Error("failed to connect", "error", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(5 * time.Second):
				continue
			}
		}

		err = clientLoop(ctx, logger, conn, entity.Id)
		_ = conn.Close()

		if ctx.Err() != nil {
			return ctx.Err()
		}
		logger.Warn("SAPIENT server connection lost, reconnecting", "error", err)
		time.Sleep(2 * time.Second)
	}
}

func clientLoop(ctx context.Context, logger *slog.Logger, conn *sapient.Conn, parentEntityID string) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()
	worldClient := pb.NewWorldServiceClient(grpcConn)

	// Register ourselves as a fusion node
	reg := &sapientpb.Registration{
		IcdVersion: proto.String(sapient.ICDVersion),
		NodeDefinition: []*sapientpb.Registration_NodeDefinition{{
			NodeType:    sapientpb.Registration_NODE_TYPE_FUSION_NODE.Enum(),
			NodeSubType: []string{"Hydris"},
		}},
		Name:      proto.String("Hydris"),
		ShortName: proto.String("hydris"),
		StatusDefinition: &sapientpb.Registration_StatusDefinition{
			StatusInterval: &sapientpb.Registration_Duration{
				Units: sapientpb.Registration_TIME_UNITS_SECONDS.Enum(),
				Value: proto.Float32(10),
			},
		},
	}

	nodeID, err := sapient.Register(conn, reg)
	if err != nil {
		return fmt.Errorf("registration failed: %w", err)
	}
	logger.Info("registered with SAPIENT server", "node_id", nodeID)

	// Start status report ticker
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sr := sapient.NewStatusReport(
					sapientpb.StatusReport_SYSTEM_OK,
					sapientpb.StatusReport_INFO_UNCHANGED,
					"Default",
				).Build()
				if err := conn.SendStatus(nodeID, sr); err != nil {
					logger.Error("failed to send status report", "error", err)
					return
				}
			}
		}
	}()

	// Watch for entities with SensorComponent and forward detections from their trackers
	stream, err := goclient.WatchEntitiesWithRetry(ctx, worldClient, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentDetection)},
		},
	})
	if err != nil {
		return fmt.Errorf("watch entities: %w", err)
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			return fmt.Errorf("stream recv: %w", err)
		}

		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}

		e := event.Entity
		if e.Geo == nil {
			continue
		}

		det := entityToDetection(e)
		if err := conn.SendDetection(nodeID, det); err != nil {
			return fmt.Errorf("send detection: %w", err)
		}
	}
}
