package artifacts

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

const controllerName = "artifacts"

// Server is set during engine startup so the controller can swap its backend.
var Server *ArtifactServer

func init() {
	builtin.Register(controllerName, Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	serviceID := controllerName + ".service"

	pushSchema := func() {
		_ = controller.Push(ctx, &pb.Entity{
			Id:    serviceID,
			Label: proto.String("Artifact Storage"),
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Category: proto.String("Storage"),
			},
			Configurable: &pb.ConfigurableComponent{
				Label:  proto.String("Artifact Storage"),
				Schema: backendSchema(),
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String("archive"),
			},
		})
	}

	pushSchema()

	// Re-push schema when plugin stores register/unregister so the
	// backend enum stays up to date in the UI.
	OnStoresChanged(pushSchema)

	return controller.Run(ctx, serviceID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
		if Server == nil {
			return nil
		}

		backend := configString(entity, "backend")
		switch backend {
		case "auto", "":
			Server.SetAutoMode()
			logger.Info("artifact storage configured", "backend", "auto")
		case "local":
			Server.SetStore(Server.local)
			logger.Info("artifact storage configured", "backend", "local")
		default:
			if s, ok := GetPluginStore(backend); ok {
				Server.SetStore(s)
				logger.Info("artifact storage configured", "backend", backend)
			} else {
				return fmt.Errorf("storage backend %q not found", backend)
			}
		}

		ready()
		<-ctx.Done()
		return ctx.Err()
	})
}

func backendSchema() *structpb.Struct {
	enums := []any{"auto", "local"}
	for _, ns := range PluginStores() {
		enums = append(enums, ns.Name)
	}
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"backend": map[string]any{
				"type":        "string",
				"title":       "Storage Backend",
				"description": "Which storage backend to use. 'auto' prefers the last registered plugin store.",
				"enum":        enums,
				"default":     "auto",
				"ui:order":    0,
			},
		},
	})
	return s
}

func configString(entity *pb.Entity, key string) string {
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return ""
	}
	v, ok := entity.Config.Value.Fields[key]
	if !ok {
		return ""
	}
	return v.GetStringValue()
}
