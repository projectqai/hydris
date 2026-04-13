package hal

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/hal"
	worldpb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const entityTTL = 45 * time.Second // lifetime for discovered device entities

func halConfigSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"serial": map[string]interface{}{
				"type":    "boolean",
				"title":   "Serial Ports",
				"default": true,
			},
			"bluetooth": map[string]interface{}{
				"type":    "boolean",
				"title":   "Bluetooth",
				"default": true,
			},
			"camera": map[string]interface{}{
				"type":    "boolean",
				"title":   "Cameras",
				"default": false,
			},
		},
	})
	return s
}

func init() {
	builtin.Register("hal", Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	if err := controller.Push(ctx, &worldpb.Entity{
		Id:    "hal.service",
		Label: proto.String("Hardware"),
		Controller: &worldpb.Controller{
			Id: proto.String("hal"),
		},
		Device: &worldpb.DeviceComponent{
			Category: proto.String("Network"),
		},
		Configurable: &worldpb.ConfigurableComponent{
			Label:  proto.String("Node Peripherals"),
			Schema: halConfigSchema(),
		},
		Interactivity: &worldpb.InteractivityComponent{},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	return controller.Run(ctx, "hal.service", func(ctx context.Context, entity *worldpb.Entity, ready func()) error {
		ready()

		grpcConn, err := builtin.BuiltinClientConn()
		if err != nil {
			return fmt.Errorf("grpc connect: %w", err)
		}
		defer func() { _ = grpcConn.Close() }()

		worldClient := worldpb.NewWorldServiceClient(grpcConn)

		enableSerial := true
		enableBLE := true
		if entity.Config != nil && entity.Config.Value != nil {
			if v, ok := entity.Config.Value.Fields["serial"]; ok {
				enableSerial = v.GetBoolValue()
			}
			if v, ok := entity.Config.Value.Fields["bluetooth"]; ok {
				enableBLE = v.GetBoolValue()
			}
		}

		if enableSerial {
			logger.Info("serial discovery enabled")
			stop := hal.WatchSerial(func(ports []hal.SerialPort) {
				pushSerialEntities(ctx, logger, worldClient, ports)
			})
			defer stop()
		} else {
			expireDevicesByClass(ctx, logger, worldClient, "usb_serial")
			serialKnown = make(map[string]struct{})
		}
		if enableBLE {
			logger.Info("bluetooth discovery enabled")
			stop := hal.WatchBLE(nil, func(devices []hal.BLEDevice) {
				pushBLEEntities(ctx, logger, worldClient, devices)
			})
			defer stop()
		} else {
			expireDevicesByClass(ctx, logger, worldClient, "ble")
		}

		// Poll local sensors (battery, CPU temp, barometer, etc.)
		go pollSensors(ctx, logger, worldClient)

		<-ctx.Done()
		return ctx.Err()
	})
}

func sanitizeID(s string) string {
	s = strings.ReplaceAll(s, "/", "_")
	s = strings.ReplaceAll(s, "\\", "_")
	s = strings.ReplaceAll(s, " ", "_")
	s = strings.ReplaceAll(s, ":", "-")
	return s
}

var serialKnown = make(map[string]struct{})

func pushSerialEntities(ctx context.Context, logger *slog.Logger,
	client worldpb.WorldServiceClient, ports []hal.SerialPort,
) {
	until := time.Now().Add(entityTTL)
	current := make(map[string]struct{})

	var entities []*worldpb.Entity
	for _, port := range ports {
		var key string
		switch {
		case port.Key != "":
			key = port.Key
		case port.VendorID != 0 && port.SerialNumber != "":
			key = fmt.Sprintf("%04x-%04x-%s", port.VendorID, port.ProductID, port.SerialNumber)
		default:
			key = port.Name
		}
		id := fmt.Sprintf("serial.device.%s", sanitizeID(key))
		current[id] = struct{}{}

		entity := &worldpb.Entity{
			Id:    id,
			Label: proto.String(port.Name),
			Lifetime: &worldpb.Lifetime{
				Until: timestamppb.New(until),
			},
			Device: &worldpb.DeviceComponent{
				Parent: proto.String("hal.service"),
				State:  worldpb.DeviceState_DeviceStateActive,
				Class:  proto.String("usb_serial"),
				Serial: &worldpb.SerialDevice{
					Path: proto.String(port.Path),
				},
			},
		}

		if port.VendorID != 0 || port.ProductID != 0 {
			entity.Device.Usb = &worldpb.UsbDevice{
				VendorId:         proto.Uint32(port.VendorID),
				ProductId:        proto.Uint32(port.ProductID),
				SerialNumber:     proto.String(port.SerialNumber),
				ManufacturerName: proto.String(port.ManufacturerName),
				ProductName:      proto.String(port.ProductName),
			}
		}

		entities = append(entities, entity)
	}

	if len(entities) > 0 {
		if _, err := client.Push(ctx, &worldpb.EntityChangeRequest{Changes: entities}); err != nil {
			logger.Error("failed to push serial device entities", "error", err)
		}
	}

	for id := range serialKnown {
		if _, exists := current[id]; !exists {
			logger.Info("serial port removed", "entityID", id)
			if _, err := client.ExpireEntity(ctx, &worldpb.ExpireEntityRequest{Id: id}); err != nil {
				logger.Error("failed to expire serial device", "error", err)
			}
		}
	}

	serialKnown = current
}

func expireDevicesByClass(ctx context.Context, logger *slog.Logger,
	client worldpb.WorldServiceClient, deviceClass string,
) {
	resp, err := client.ListEntities(ctx, &worldpb.ListEntitiesRequest{
		Filter: &worldpb.EntityFilter{
			Device: &worldpb.DeviceFilter{
				Parent:      proto.String("hal.service"),
				DeviceClass: proto.String(deviceClass),
			},
		},
	})
	if err != nil {
		logger.Error("failed to list devices for expiry", "class", deviceClass, "error", err)
		return
	}
	for _, e := range resp.Entities {
		if _, err := client.ExpireEntity(ctx, &worldpb.ExpireEntityRequest{Id: e.Id}); err != nil {
			logger.Error("failed to expire device", "id", e.Id, "error", err)
		}
	}
}

const sensorPollInterval = 30 * time.Second

func pollSensors(ctx context.Context, logger *slog.Logger, client worldpb.WorldServiceClient) {
	// Do an initial read immediately.
	pushSensorMetrics(ctx, logger, client)

	ticker := time.NewTicker(sensorPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pushSensorMetrics(ctx, logger, client)
		}
	}
}

func pushSensorMetrics(ctx context.Context, logger *slog.Logger, client worldpb.WorldServiceClient) {
	readings := hal.ReadSensors()
	if len(readings) == 0 {
		return
	}

	now := timestamppb.Now()
	metrics := make([]*worldpb.Metric, len(readings))
	for i, r := range readings {
		metrics[i] = &worldpb.Metric{
			Id:         proto.Uint32(r.ID),
			Label:      proto.String(r.Label),
			Kind:       worldpb.MetricKind(r.Kind).Enum(),
			Unit:       worldpb.MetricUnit(r.Unit),
			MeasuredAt: now,
			Val:        &worldpb.Metric_Double{Double: r.Value},
		}
	}

	if _, err := client.Push(ctx, &worldpb.EntityChangeRequest{
		Changes: []*worldpb.Entity{{
			Id:     "hal.service",
			Metric: &worldpb.MetricComponent{Metrics: metrics},
		}},
	}); err != nil {
		logger.Error("failed to push sensor metrics", "error", err)
	}
}

func pushBLEEntities(ctx context.Context, logger *slog.Logger,
	client worldpb.WorldServiceClient, devices []hal.BLEDevice,
) {
	until := time.Now().Add(entityTTL)

	var entities []*worldpb.Entity
	for _, device := range devices {
		label := device.Name
		if label == "" {
			label = device.Address
		}

		e := &worldpb.Entity{
			Id:    fmt.Sprintf("ble.device.%s", sanitizeID(device.Address)),
			Label: proto.String(label),
			Lifetime: &worldpb.Lifetime{
				Until: timestamppb.New(until),
			},
			Device: &worldpb.DeviceComponent{
				Parent: proto.String("hal.service"),
				State:  worldpb.DeviceState_DeviceStateActive,
				Class:  proto.String("ble"),
				Ble: &worldpb.BleDevice{
					Address:      proto.String(device.Address),
					Name:         proto.String(device.Name),
					ServiceUuids: device.ServiceUUIDs,
				},
			},
		}
		if device.RSSI != 0 {
			rssi := int32(device.RSSI)
			e.Link = &worldpb.LinkComponent{
				RssiDbm: &rssi,
			}
		}
		entities = append(entities, e)
	}

	if len(entities) > 0 {
		if _, err := client.Push(ctx, &worldpb.EntityChangeRequest{Changes: entities}); err != nil {
			logger.Error("failed to push ble device entities", "error", err)
		}
	}
}
