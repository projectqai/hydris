package simcam

import (
	"context"
	"log/slog"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
)

func runFocalpointSymbols(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn("simcam")
	if err != nil {
		logger.Error("simcam focalpoint-symbols: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{15}, // CameraComponent
		},
	})
	if err != nil {
		logger.Error("simcam focalpoint-symbols: watch cameras", "error", err)
		return
	}

	seen := make(map[string]struct{})
	for {
		event, err := stream.Recv()
		if err != nil {
			return
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		cam := event.Entity.Camera
		if cam == nil || cam.FocalPoint == nil || *cam.FocalPoint == "" {
			continue
		}
		fpID := *cam.FocalPoint
		if _, ok := seen[fpID]; ok {
			continue
		}
		seen[fpID] = struct{}{}

		if _, err := client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: fpID,
				Symbol: &pb.SymbolComponent{
					MilStd2525C: "SF--------",
				},
			}},
		}); err != nil {
			logger.Warn("simcam focalpoint-symbols: push symbol", "focalpoint", fpID, "error", err)
		}
	}
}
