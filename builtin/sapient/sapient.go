package sapient

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const controllerName = "sapient"

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	peerSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"address": map[string]any{
				"type":        "string",
				"title":       "Address",
				"description": "Apex middleware address (host:port)",
				"default":     "localhost:5001",
			},
		},
		"required": []any{"address"},
	})

	serverSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"address": map[string]any{
				"type":        "string",
				"title":       "Listen Address",
				"description": "TCP listen address (host:port)",
				"default":     ":5020",
			},
		},
		"required": []any{"address"},
	})

	clientSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"address": map[string]any{
				"type":        "string",
				"title":       "Server Address",
				"description": "Remote SAPIENT server address (host:port)",
			},
		},
		"required": []any{"address"},
	})

	serviceEntityID := controllerName + ".service"

	if err := controller.Push(ctx,
		&pb.Entity{
			Id:    serviceEntityID,
			Label: proto.String("SAPIENT"),
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Category: proto.String("Network"),
			},
			Configurable: &pb.ConfigurableComponent{
				SupportedDeviceClasses: []*pb.DeviceClassOption{
					{Class: "peer", Label: "SAPIENT Peer (Apex)"},
					{Class: "server", Label: "SAPIENT Server"},
					{Class: "client", Label: "SAPIENT Client"},
				},
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String("radar"),
			},
		},
	); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "peer", Label: "SAPIENT Peer (Apex)", Schema: peerSchema},
		{Class: "server", Label: "SAPIENT Server", Schema: serverSchema},
		{Class: "client", Label: "SAPIENT Client", Schema: clientSchema},
	}

	return controller.WatchChildren(ctx, serviceEntityID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			deviceClass := entity.Device.GetClass()
			switch deviceClass {
			case "peer":
				return runPeer(ctx, logger, entity, ready)
			case "server":
				return runServer(ctx, logger, entity, ready)
			case "client":
				return runClient(ctx, logger, entity, ready)
			default:
				return fmt.Errorf("unknown device class: %s", deviceClass)
			}
		})
	})
}

func getConfigString(entity *pb.Entity, key string) string {
	if entity.Config == nil || entity.Config.Value == nil {
		return ""
	}
	if v, ok := entity.Config.Value.Fields[key]; ok {
		return v.GetStringValue()
	}
	return ""
}

func init() {
	builtin.Register("sapient", Run)
}
