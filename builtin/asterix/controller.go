package asterix

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

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "asterix"

	receiverSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"listen": map[string]any{
				"type":           "string",
				"title":          "Listen Address",
				"description":    "UDP address to receive ASTERIX data",
				"ui:placeholder": "e.g. :8600",
				"ui:order":       0,
			},
			"category": map[string]any{
				"type":        "integer",
				"title":       "Category",
				"description": "ASTERIX category number",
				"default":     62,
				"oneOf": []any{
					map[string]any{"const": 62, "title": "CAT 062 — System Track Data"},
				},
				"ui:order": 1,
			},
			"source_prefix": map[string]any{
				"type":           "string",
				"title":          "Source Prefix",
				"description":    "Prefix for entity IDs from this receiver",
				"ui:placeholder": "e.g. radar1",
				"ui:order":       2,
			},
		},
	})
	senderSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"address": map[string]any{
				"type":           "string",
				"title":          "Destination Address",
				"description":    "UDP address to send ASTERIX data",
				"ui:placeholder": "e.g. 192.168.1.100:8600",
				"ui:order":       0,
			},
			"category": map[string]any{
				"type":        "integer",
				"title":       "Category",
				"description": "ASTERIX category number",
				"default":     62,
				"oneOf": []any{
					map[string]any{"const": 62, "title": "CAT 062 — System Track Data"},
				},
				"ui:order": 1,
			},
			"sac": map[string]any{
				"type":        "integer",
				"title":       "SAC",
				"description": "System Area Code",
				"ui:order":    2,
			},
			"sic": map[string]any{
				"type":        "integer",
				"title":       "SIC",
				"description": "System Identification Code",
				"ui:order":    3,
			},
		},
	})

	serviceID := controllerName + ".service"

	if err := controller.Push(ctx, &pb.Entity{
		Id:    serviceID,
		Label: proto.String("ASTERIX"),
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Feeds"),
		},
		Configurable: &pb.ConfigurableComponent{
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{Class: "receiver", Label: "Receiver"},
				{Class: "sender", Label: "Sender"},
			},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("radar"),
		},
	}); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "receiver", Label: "Receiver", Schema: receiverSchema},
		{Class: "sender", Label: "Sender", Schema: senderSchema},
	}

	return controller.WatchChildren(ctx, serviceID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			switch entity.Device.GetClass() {
			case "receiver":
				return runReceiver(ctx, logger, entity, ready)
			case "sender":
				return runSender(ctx, logger, entity, ready)
			}
			return fmt.Errorf("unknown device class: %s", entity.Device.GetClass())
		})
	})
}

func init() {
	builtin.Register("asterix", Run)
}
