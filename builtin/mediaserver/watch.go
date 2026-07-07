package mediaserver

import (
	"context"
	"log/slog"
	"slices"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/goclient"
	"github.com/projectqai/hydris/pkg/media"
	pb "github.com/projectqai/proto/go"
)

func WatchCameraStreams(ctx context.Context, bridges *media.BridgeManager) {
	conn, err := builtin.BuiltinClientConn("mediaserver")
	if err != nil {
		slog.Error("mediaserver: failed to connect for camera watch", "error", err)
		return
	}
	defer func() { _ = conn.Close() }()

	client := pb.NewWorldServiceClient(conn)
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentCamera)},
		},
	})
	if err != nil {
		slog.Error("mediaserver: failed to watch cameras", "error", err)
		return
	}

	streamURLs := make(map[string][]string)

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Error("mediaserver: camera watch error", "error", err)
			return
		}
		if event.Entity == nil {
			continue
		}

		entityID := event.Entity.Id

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			if event.Entity.Camera == nil {
				continue
			}
			var urls []string
			for _, s := range event.Entity.Camera.Streams {
				urls = append(urls, s.Url)
			}

			old, existed := streamURLs[entityID]
			streamURLs[entityID] = urls

			if existed && !slices.Equal(old, urls) {
				slog.Info("mediaserver: camera streams changed, invalidating bridges", "entity", entityID)
				bridges.InvalidateEntity(entityID)
			}

		case pb.EntityChange_EntityChangeExpired:
			delete(streamURLs, entityID)
			bridges.InvalidateEntity(entityID)
		}
	}
}
