package reolink

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

const controllerName = "reolink"

var (
	svcCfgMu sync.RWMutex
	svcCfg   serviceConfig
)

func getServiceConfig() serviceConfig {
	svcCfgMu.RLock()
	defer svcCfgMu.RUnlock()
	return svcCfg
}

func init() {
	builtin.Register(controllerName, Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	serviceEntityID := controllerName + ".service"

	if err := controller.Push(ctx, &pb.Entity{
		Id:    serviceEntityID,
		Label: proto.String("Reolink Cameras"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Cameras"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Configurable: &pb.ConfigurableComponent{
			Schema: serviceSchema(),
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{Class: "camera", Label: "Reolink Camera"},
			},
		},
		Config: &pb.ConfigurationComponent{},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("camera"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	// Watch netscan for Reolink devices.
	go watchNetscanForCameras(ctx, logger)

	// Run WS-Discovery for direct ONVIF device probing.
	go runWSDiscovery(ctx, logger)

	// Watch service config for credentials.
	go controller.Run(ctx, serviceEntityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
		cfg := parseServiceConfig(entity)
		svcCfgMu.Lock()
		svcCfg = cfg
		svcCfgMu.Unlock()

		logger.Info("service config updated",
			"username", cfg.Username,
			"autoProbe", cfg.AutoProbe,
		)
		ready()

		if cfg.AutoProbe {
			return runAutoProbe(ctx, logger)
		}
		<-ctx.Done()
		return nil
	})

	classes := []controller.DeviceClass{
		{Class: "camera", Label: "Reolink Camera", Schema: cameraSchema()},
	}

	return controller.WatchChildren(ctx, serviceEntityID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			return runCamera(ctx, logger, entity, ready, getServiceConfig())
		})
	})
}

func runAutoProbe(ctx context.Context, logger *slog.Logger) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("auto-probe: grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	serviceEntityID := controllerName + ".service"
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50}, // DeviceComponent
			Device: &pb.DeviceFilter{
				Parent: &serviceEntityID,
			},
			Controller: &pb.ControllerFilter{
				Id: proto.String(controllerName),
			},
		},
	})
	if err != nil {
		return fmt.Errorf("auto-probe: watch: %w", err)
	}

	autoConfigured := make(map[string]struct{})

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("auto-probe: stream error: %w", err)
		}

		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}

		entity := event.Entity

		if _, done := autoConfigured[entity.Id]; done {
			continue
		}

		if entity.Config != nil && entity.Config.Value != nil {
			autoConfigured[entity.Id] = struct{}{}
			continue
		}

		logger.Info("auto-probing camera", "entityID", entity.Id)

		if _, err := client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id:     entity.Id,
				Config: &pb.ConfigurationComponent{},
			}},
		}); err != nil {
			logger.Error("auto-probe: push config", "entityID", entity.Id, "error", err)
		} else {
			autoConfigured[entity.Id] = struct{}{}
		}
	}
}
