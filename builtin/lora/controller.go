package lora

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

const controllerName = "lora"

func init() {
	builtin.Register(controllerName, Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	schema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"listen_address": map[string]any{
				"type":        "string",
				"title":       "Listen address",
				"description": "UDP address for receiving GWMP uplinks from the packet forwarder.",
				"default":     defaultListenAddress,
			},
		},
	})

	if err := controller.Push(ctx, controllerName, &pb.Entity{
		Id:    "lora.service",
		Label: proto.String("LoRa"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
		},
		Configurable: &pb.ConfigurableComponent{
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{Class: "gateway", Label: "LoRa Packet Forwarder"},
			},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("radio"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "gateway", Label: "LoRa Packet Forwarder", Schema: schema},
	}

	return controller.WatchChildren(ctx, controllerName, "lora.service", controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, controllerName, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			switch entity.Device.GetClass() {
			case "gateway":
				return runInstance(ctx, logger, entity, ready)
			default:
				logger.Warn("unknown device class, waiting", "entity", entity.Id, "class", entity.Device.GetClass())
				<-ctx.Done()
				return nil
			}
		})
	})
}
