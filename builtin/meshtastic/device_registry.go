package meshtastic

import (
	"context"
	"fmt"
	"log/slog"
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

// usbDeviceID identifies a known meshtastic device by VID, PID, and manufacturer.
type usbDeviceID struct {
	VendorID         uint32
	ProductID        uint32
	ManufacturerName string
}

// autolistDevices are known meshtastic devices matched by VID, PID, and manufacturer.
// Devices matching these are auto-configured when auto mode is enabled.
var autolistDevices = []usbDeviceID{
	{0x239A, 0x4405, "LILYGO"}, // LILYGO TTGO_eink (nRF52-based)
}

// banlistVIDs are USB Vendor IDs known to NOT be meshtastic devices.
var banlistVIDs = map[uint32]bool{
	0x1366: true, // SEGGER J-Link
	0x0483: true, // STMicroelectronics ST-LINK/V2
	0x1915: true, // Nordic Semiconductor PPK2
	0x0925: true, // Saleae Logic analyzer
	0x04b4: true, // Cypress / Hantek oscilloscope
	0x067B: true, // Prolific PL2303 USB-to-serial converter
}

// isMeshtasticCandidate checks whether a device entity with a USB descriptor
// could be a meshtastic device. Stage 1: autolist VID:PID pairs are high confidence.
// Stage 2 fallback: any USB device not in the banlist.
func isMeshtasticCandidate(entity *pb.Entity) bool {
	if entity.Device == nil || entity.Device.Usb == nil {
		return false
	}
	if isAutolistDevice(entity) {
		return true
	}
	vid := entity.Device.Usb.GetVendorId()
	if banlistVIDs[vid] {
		return false
	}
	// Fallback: any USB serial device not banned is a candidate.
	return entity.Device.Serial != nil
}

// watchDevicesAndPublishMeshtasticDevices watches all device entities and
// publishes meshtastic child device entities for those that look like
// meshtastic candidates (based on USB VID autolist/banlist).
// Each child device has Controller.Id = "meshtastic", Parent = parent device ID,
// and Configurable entries for per-device configuration.
func watchDevicesAndPublishMeshtasticDevices(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		logger.Error("device watch: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	// Watch for entities with DeviceComponent (field 50).
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50},
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

		// Skip entities owned by this controller.
		if entity.Controller != nil && entity.Controller.GetId() == "meshtastic" {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			if entity.Lifetime != nil && entity.Lifetime.Until != nil &&
				!entity.Lifetime.Until.AsTime().After(time.Now()) {
				continue
			}

			if !isMeshtasticCandidate(entity) {
				continue
			}

			if _, exists := children[entity.Id]; exists {
				continue
			}

			logger.Info("meshtastic candidate device found", "entityID", entity.Id)

			childEntity := meshtasticDeviceForParent(entity)
			childEntityID := childEntity.Id
			if _, err := client.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{childEntity},
			}); err != nil {
				logger.Error("failed to push meshtastic device", "entityID", entity.Id, "error", err)
				continue
			}

			childCtx, childCancel := context.WithCancel(ctx)
			children[entity.Id] = &childInfo{cancel: childCancel}
			go func() {
				if err := controller.Run(childCtx, childEntityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
					ready()
					return runInstance(ctx, logger, entity)
				}); err != nil && childCtx.Err() == nil {
					logger.Error("meshtastic instance error", "entityID", childEntityID, "error", err)
				}
			}()

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			if info, exists := children[entity.Id]; exists {
				info.cancel()
				delete(children, entity.Id)
			}
			if !isMeshtasticCandidate(entity) {
				continue
			}
			childID := "meshtastic.device." + entity.Id
			if _, err := client.ExpireEntity(ctx, &pb.ExpireEntityRequest{
				Id: childID,
			}); err != nil && status.Code(err) != codes.NotFound {
				logger.Error("failed to expire meshtastic device", "entityID", entity.Id, "error", err)
			}
		}
	}
}

// isAutolistDevice checks whether a device entity matches a known autolist entry
// by VID, PID, and manufacturer name.
func isAutolistDevice(entity *pb.Entity) bool {
	if entity.Device == nil || entity.Device.Usb == nil {
		return false
	}
	usb := entity.Device.Usb
	for _, d := range autolistDevices {
		if d.VendorID == usb.GetVendorId() && d.ProductID == usb.GetProductId() && d.ManufacturerName == usb.GetManufacturerName() {
			return true
		}
	}
	return false
}

// runAutoManager watches for meshtastic child device entities and pushes
// Config onto the device entity directly for autolist devices using
// default config values. This way the controller.Run loop picks up the
// device entity with its Config and starts runInstance.
func runAutoManager(ctx context.Context, logger *slog.Logger) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("auto manager: grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	// Watch for device entities (component field 50).
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50},
		},
	})
	if err != nil {
		return fmt.Errorf("auto manager: watch: %w", err)
	}

	autoConfigs := make(map[string]struct{}) // child device IDs we've auto-configured

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("auto manager: stream error: %w", err)
		}

		if event.Entity == nil {
			continue
		}

		entity := event.Entity

		// We only care about our own meshtastic child device entities.
		if entity.Controller == nil || entity.Controller.GetId() != "meshtastic" {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			if entity.Lifetime != nil && entity.Lifetime.Until != nil &&
				!entity.Lifetime.Until.AsTime().After(time.Now()) {
				continue
			}

			// Check if the underlying serial device is on the autolist.
			// The child device entity doesn't have USB info directly,
			// so we check the composition (the actual serial device).
			composition := entity.Device.GetComposition()
			if len(composition) == 0 {
				continue
			}

			// Look up the serial device to check its VID.
			parentResp, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: composition[0]})
			if err != nil {
				logger.Error("auto manager: get composition device", "deviceID", composition[0], "error", err)
				continue
			}
			if !isAutolistDevice(parentResp.Entity) {
				continue
			}

			if _, exists := autoConfigs[entity.Id]; exists {
				continue
			}

			// Skip if the entity already has a config (e.g. from a
			// previous run or manual user configuration).
			if entity.Config != nil && entity.Config.Value != nil {
				autoConfigs[entity.Id] = struct{}{}
				continue
			}

			// Read current defaults.
			defaultsMu.RLock()
			configValue, _ := structpb.NewStruct(map[string]interface{}{
				"channel":     float64(defaultChannel),
				"hop_limit":   float64(defaultHopLimit),
				"send_format": defaultSendFmt,
			})
			defaultsMu.RUnlock()

			logger.Info("Auto-configuring device",
				"entityID", entity.Id,
			)

			// Push Config directly onto the device entity.
			if _, err := client.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{{
					Id:     entity.Id,
					Config: &pb.ConfigurationComponent{Value: configValue},
				}},
			}); err != nil {
				logger.Error("auto manager: push config", "entityID", entity.Id, "error", err)
			} else {
				autoConfigs[entity.Id] = struct{}{}
			}

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			// Device gone -- do NOT expire the auto-created config.
			// The device disappearing may be temporary (e.g. radio restart,
			// USB re-enumeration), so we keep the config around so it is
			// reused when the device comes back.
			delete(autoConfigs, entity.Id)
		}
	}
}

// meshtasticDeviceForParent creates a meshtastic child device entity from a parent device entity.
func meshtasticDeviceForParent(parent *pb.Entity) *pb.Entity {
	usbProps := map[string]interface{}{
		"channel": map[string]interface{}{
			"type":        "integer",
			"title":       "Channel Index",
			"description": "Meshtastic channel index",
			"default":     0,
			"minimum":     0,
			"ui:group":    "messaging",
			"ui:order":    0,
		},
		"hop_limit": map[string]interface{}{
			"type":        "integer",
			"title":       "Hop Limit",
			"description": "Maximum number of hops for transmitted packets",
			"default":     3,
			"minimum":     0,
			"maximum":     7,
			"ui:widget":   "stepper",
			"ui:step":     1,
			"ui:group":    "messaging",
			"ui:order":    1,
		},
		"send_format": map[string]interface{}{
			"type":        "string",
			"title":       "Send Format",
			"description": "Format for outbound entities. Empty means no sending.",
			"default":     "",
			"oneOf": []interface{}{
				map[string]interface{}{"const": "", "title": "Silent"},
				map[string]interface{}{"const": "native", "title": "Native Meshtastic Only"},
				map[string]interface{}{"const": "tak", "title": "TAK (ATAK compatible)"},
				map[string]interface{}{"const": "hydris", "title": "Hydris"},
			},
			"ui:group": "messaging",
			"ui:order": 2,
		},
	}
	for k, v := range radioConfigSchemaProperties() {
		usbProps[k] = v
	}
	usbSchema, _ := structpb.NewStruct(map[string]interface{}{
		"type": "object",
		"ui:groups": []interface{}{
			map[string]interface{}{"key": "messaging", "title": "Messaging"},
			map[string]interface{}{"key": "radio", "title": "Radio", "collapsed": true},
			map[string]interface{}{"key": "device", "title": "Device", "collapsed": true},
			map[string]interface{}{"key": "position", "title": "Position", "collapsed": true},
			map[string]interface{}{"key": "identity", "title": "Identity", "collapsed": true},
			map[string]interface{}{"key": "channel", "title": "Channel", "collapsed": true},
		},
		"properties": usbProps,
	})

	label := "Meshtastic Device"
	if parent.Label != nil && *parent.Label != "" {
		label = *parent.Label
	}

	return &pb.Entity{
		Id:    "meshtastic.device." + parent.Id,
		Label: proto.String(label),
		Controller: &pb.Controller{
			Id: proto.String("meshtastic"),
		},
		Device: &pb.DeviceComponent{
			Category:    proto.String("Network"),
			Parent:      proto.String("meshtastic.service"),
			Composition: []string{parent.Id},
		},
		Configurable: &pb.ConfigurableComponent{
			Label:  proto.String("Specific device Configuration"),
			Schema: usbSchema,
		},
	}
}
