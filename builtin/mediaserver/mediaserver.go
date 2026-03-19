package mediaserver

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

var (
	mu            sync.RWMutex
	remoteSharing bool
)

// IsRemoteSharingEnabled returns true if the mediaserver is configured to
// allow remote (non-localhost) access to camera streams.
func IsRemoteSharingEnabled() bool {
	mu.RLock()
	defer mu.RUnlock()
	return remoteSharing
}

func setRemoteSharing(v bool) {
	mu.Lock()
	remoteSharing = v
	mu.Unlock()
}

func init() {
	builtin.Register("mediaserver", Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "mediaserver"

	schema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"share_remote": map[string]any{
				"type":        "boolean",
				"title":       "Share Remotely",
				"description": "Allow camera streams to be accessed by remote / federated nodes",
				"ui:order":    0,
			},
		},
	})

	if err := controller.Push(ctx, &pb.Entity{
		Id:    "mediaserver.service",
		Label: proto.String("Media Server"),
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Media"),
		},
		Configurable: &pb.ConfigurableComponent{
			Label:  proto.String("Media Server"),
			Schema: schema,
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("camera"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	return controller.Run(ctx, "mediaserver.service", func(ctx context.Context, entity *pb.Entity, ready func()) error {
		share := false
		if entity.Config != nil && entity.Config.Value != nil {
			if v, ok := entity.Config.Value.Fields["share_remote"]; ok {
				share = v.GetBoolValue()
			}
		}

		setRemoteSharing(share)
		logger.Info("mediaserver configured", "share_remote", share)
		ready()

		<-ctx.Done()
		setRemoteSharing(false)
		return ctx.Err()
	})
}
