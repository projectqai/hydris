package onvif

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

const controllerName = "onvif"

func init() {
	builtin.Register(controllerName, Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	serviceEntityID := controllerName + ".service"

	if err := controller.Push(ctx, controllerName, &pb.Entity{
		Id:    serviceEntityID,
		Label: proto.String("ONVIF Discovery"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("radar"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	go runWSDiscovery(ctx, logger)

	<-ctx.Done()
	return nil
}
