package asterix

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/structpb"
)

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "asterix"

	receiverSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"listen":        map[string]any{"type": "string", "description": "UDP listen address (e.g. :8600)"},
			"category":      map[string]any{"type": "number", "description": "ASTERIX category (e.g. 62)"},
			"source_prefix": map[string]any{"type": "string"},
		},
	})
	senderSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"address":  map[string]any{"type": "string", "description": "UDP destination address"},
			"category": map[string]any{"type": "number", "description": "ASTERIX category (e.g. 62)"},
			"sac":      map[string]any{"type": "number"},
			"sic":      map[string]any{"type": "number"},
		},
	})

	if err := controller.PublishDevice(ctx, controllerName+".service", controllerName, []*pb.Configurable{
		{Key: "asterix.receiver.v0", Schema: receiverSchema},
		{Key: "asterix.sender.v0", Schema: senderSchema},
	}, nil, nil); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	return controller.Run1to1(ctx, controllerName, func(ctx context.Context, config *pb.Entity, _ *pb.Entity) error {
		if config.Config == nil {
			return fmt.Errorf("entity %s has no config", config.Id)
		}
		switch config.Config.Key {
		case "asterix.receiver.v0":
			return runReceiver(ctx, logger, config)
		case "asterix.sender.v0":
			return runSender(ctx, logger, config)
		default:
			return fmt.Errorf("unknown config key: %s", config.Config.Key)
		}
	})
}

func init() {
	builtin.Register("asterix", Run)
}
