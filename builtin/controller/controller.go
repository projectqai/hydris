// Package controller provides a framework for managing config-driven connectors.
//
// It uses the engine's ControllerService.Reconcile RPC to receive (config, device)
// matching events, and runs a connector for each 1:1 match.
package controller

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// RunFunc is called for each (config, device) match.
// It should block until done or error.
// The context is cancelled when the match is removed.
// On error, it will be restarted with backoff until the context is cancelled.
type RunFunc func(ctx context.Context, config *pb.Entity, device *pb.Entity) error

type connector struct {
	cancel context.CancelFunc
	config *pb.Entity
	device *pb.Entity
}

// Run1to1 connects to the engine's Reconcile stream and runs a connector
// for each (config, device) pair matched by the engine.
func Run1to1(ctx context.Context, controllerName string, run RunFunc) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewControllerServiceClient(grpcConn)

	stream, err := client.Reconcile(ctx, &pb.ControllerReconciliationRequest{
		Controller: controllerName,
	})
	if err != nil {
		return err
	}

	var mu sync.Mutex
	connectors := make(map[string]*connector) // "configID/deviceID" -> connector

	connectorKey := func(configID, deviceID string) string {
		return configID + "/" + deviceID
	}

	stopConnector := func(key string) {
		if conn, exists := connectors[key]; exists {
			conn.cancel()
			delete(connectors, key)
		}
	}

	startConnector := func(key string, config *pb.Entity, device *pb.Entity) {
		var connCtx context.Context
		var cancel context.CancelFunc
		if config.Lifetime != nil && config.Lifetime.Until != nil {
			connCtx, cancel = context.WithDeadline(ctx, config.Lifetime.Until.AsTime())
		} else {
			connCtx, cancel = context.WithCancel(ctx)
		}

		conn := &connector{cancel: cancel, config: config, device: device}
		connectors[key] = conn

		go func() {
			defer func() {
				mu.Lock()
				// Only delete if we're still the active connector for this key.
				// A replacement connector may have already taken our slot.
				if connectors[key] == conn {
					delete(connectors, key)
				}
				mu.Unlock()
			}()

			for {
				if connCtx.Err() != nil {
					return
				}

				err := run(connCtx, config, device)
				if connCtx.Err() != nil {
					return
				}

				if err != nil {
					slog.Error("connector error, restarting", "config", config.Id, "device", device.Id, "error", err)
				}

				select {
				case <-connCtx.Done():
					return
				case <-time.After(5 * time.Second):
				}
			}
		}()
	}

	for {
		resp, err := stream.Recv()
		if err != nil {
			// Cancel all running connectors.
			mu.Lock()
			for key := range connectors {
				stopConnector(key)
			}
			mu.Unlock()
			return err
		}

		event := resp.GetConfig()
		if event == nil {
			continue
		}

		config := event.Config
		device := event.Device
		if config == nil || device == nil {
			continue
		}

		key := connectorKey(config.Id, device.Id)

		mu.Lock()
		switch event.T {
		case pb.ControllerDeviceConfigurationEventType_ControllerDeviceConfigurationEventNew:
			stopConnector(key) // safety: shouldn't exist, but just in case
			startConnector(key, config, device)

		case pb.ControllerDeviceConfigurationEventType_ControllerDeviceConfigurationEventChanged:
			if existing, running := connectors[key]; !running || !proto.Equal(existing.config, config) || !proto.Equal(existing.device, device) {
				stopConnector(key)
				startConnector(key, config, device)
			}

		case pb.ControllerDeviceConfigurationEventType_ControllerDeviceConfigurationEventRemoved:
			stopConnector(key)
		}
		mu.Unlock()
	}
}

// PublishDevice emits a device entity with Configurable entries and Labels.
func PublishDevice(ctx context.Context, entityID string, controllerName string, configurables []*pb.Configurable, labels map[string]string, parent *string) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	dev := &pb.DeviceComponent{
		Configurable: configurables,
		Labels:       labels,
	}
	if parent != nil {
		dev.Parent = parent
	}

	_, err = client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: entityID,
			Controller: &pb.Controller{
				Id: &controllerName,
			},
			Device: dev,
		}},
	})
	return err
}
