package serial

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/devices"
	pb "github.com/projectqai/proto/go"
)

func init() {
	builtin.Register("serial", Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	if !builtin.LocalPermissions.AllowLocalSerial {
		logger.Info("serial port discovery disabled (use --allow-local-serial to enable)")
		<-ctx.Done()
		return ctx.Err()
	}

	logger.Info("serial port discovery enabled")

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	resp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return fmt.Errorf("get local node: %w", err)
	}
	nodeEntityID := resp.Entity.Id

	logger.Info("serial discovery started",
		"nodeEntityID", nodeEntityID,
	)

	known := make(map[string]devices.DeviceInfo)

	// discoverAndWatch sends snapshots of currently-present serial ports on a
	// channel. It fires once immediately (initial scan) and again whenever
	// devices are added or removed.
	snapshots := discoverAndWatch(ctx, logger)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case current, ok := <-snapshots:
			if !ok {
				return nil
			}
			reconcile(ctx, logger, client, nodeEntityID, known, current)
			known = current
		}
	}
}

// reconcile compares the known device set with the current snapshot and pushes
// new device entities / expires removed ones.
func reconcile(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient,
	nodeEntityID string, known, current map[string]devices.DeviceInfo,
) {
	// New ports
	var newEntities []*pb.Entity
	for name, info := range current {
		if _, exists := known[name]; exists {
			continue
		}
		logger.Info("serial port appeared", "name", name, "path", info.Serial.Path)
		entity := devices.BuildDeviceEntity("serial", nodeEntityID, info)
		entity.Device.Parent = &nodeEntityID
		entity.Device.State = pb.DeviceState_DeviceStateActive
		newEntities = append(newEntities, entity)
	}

	if len(newEntities) > 0 {
		if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: newEntities}); err != nil {
			logger.Error("failed to push serial device entities", "error", err)
		}
	}

	// Removed ports
	for name := range known {
		if _, exists := current[name]; exists {
			continue
		}
		logger.Info("serial port removed", "name", name)
		entityID := fmt.Sprintf("serial.device.%s.%s", nodeEntityID, name)
		if _, err := client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: entityID}); err != nil {
			logger.Error("failed to expire serial device entity", "name", name, "error", err)
		}
	}
}
