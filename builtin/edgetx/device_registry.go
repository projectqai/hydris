package edgetx

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type usbDeviceID struct {
	VendorID     uint32
	ProductID    uint32
	Manufacturer string // prefix match
}

// Known OpenTX/EdgeTX radio USB identifiers.
// All use the STM32 CDC Virtual COM Port (0x0483:0x5740).
var knownDevices = []usbDeviceID{
	{0x0483, 0x5740, "OpenTX"},
	{0x0483, 0x5740, "EdgeTX"},
}

func isEdgeTXDevice(entity *pb.Entity) bool {
	if entity.Device == nil || entity.Device.Usb == nil {
		return false
	}
	usb := entity.Device.Usb
	for _, d := range knownDevices {
		if d.VendorID == usb.GetVendorId() &&
			d.ProductID == usb.GetProductId() &&
			strings.HasPrefix(usb.GetManufacturerName(), d.Manufacturer) {
			return true
		}
	}
	return false
}

func watchDevicesAndPublish(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		logger.Error("device watch: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50}, // DeviceComponent
		},
	})
	if err != nil {
		logger.Error("device watch: failed to watch", "error", err)
		return
	}

	type childInfo struct {
		cancel context.CancelFunc
	}
	children := make(map[string]*childInfo)

	defer func() {
		for _, info := range children {
			info.cancel()
		}
	}()

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Error("device watch: stream error", "error", err)
			return
		}

		if event.Entity == nil {
			continue
		}

		entity := event.Entity

		if entity.Controller != nil && entity.Controller.GetId() == controllerName {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			if entity.Lifetime != nil && entity.Lifetime.Until != nil &&
				!entity.Lifetime.Until.AsTime().After(time.Now()) {
				continue
			}

			if !isEdgeTXDevice(entity) {
				continue
			}

			if _, exists := children[entity.Id]; exists {
				continue
			}

			logger.Info("EdgeTX device found", "entityID", entity.Id,
				"product", entity.Device.Usb.GetProductName(),
				"manufacturer", entity.Device.Usb.GetManufacturerName())

			childEntity := edgeTXDeviceForParent(entity)
			childEntityID := childEntity.Id

			// Push entity + config together so controller.Run picks it up immediately.
			// The user can remove the config via UI to disable the device.
			configValue, _ := structpb.NewStruct(map[string]interface{}{
				"enabled": true,
			})
			childEntity.Config = &pb.ConfigurationComponent{Value: configValue}

			if _, err := client.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{childEntity},
			}); err != nil {
				logger.Error("failed to push edgetx device", "entityID", entity.Id, "error", err)
				continue
			}

			childCtx, childCancel := context.WithCancel(ctx)
			children[entity.Id] = &childInfo{cancel: childCancel}
			go func() {
				if err := controller.Run(childCtx, childEntityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
					ready()
					return runInstance(ctx, logger, entity)
				}); err != nil && childCtx.Err() == nil {
					logger.Error("edgetx instance error", "entityID", childEntityID, "error", err)
				}
			}()

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			if info, exists := children[entity.Id]; exists {
				info.cancel()
				delete(children, entity.Id)
			}
			if !isEdgeTXDevice(entity) {
				continue
			}
			childID := "edgetx.device." + entity.Id
			if _, err := client.ExpireEntity(ctx, &pb.ExpireEntityRequest{
				Id: childID,
			}); err != nil && status.Code(err) != codes.NotFound {
				logger.Error("failed to expire edgetx device", "entityID", entity.Id, "error", err)
			}
		}
	}
}

func edgeTXDeviceForParent(parent *pb.Entity) *pb.Entity {
	schema, _ := structpb.NewStruct(map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"enabled": map[string]interface{}{
				"type":    "boolean",
				"title":   "Enabled",
				"default": true,
			},
		},
	})

	label := "EdgeTX Radio"
	if parent.Device != nil && parent.Device.Usb != nil {
		if name := parent.Device.Usb.GetProductName(); name != "" {
			label = name
		}
	}

	return &pb.Entity{
		Id:    "edgetx.device." + parent.Id,
		Label: proto.String(label),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category:    proto.String("Vehicles"),
			Parent:      proto.String("edgetx.service"),
			Composition: []string{parent.Id},
		},
		Configurable: &pb.ConfigurableComponent{
			Schema: schema,
		},
	}
}
