package webcam

import (
	"context"
	"fmt"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/builtin/devices"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"log/slog"
)

func init() {
	builtin.Register("webcam", Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	logger.Info("webcam discovery enabled")

	controllerName := "webcam"

	if err := controller.Push(ctx, &pb.Entity{
		Id:    "webcam.service",
		Label: proto.String("Webcams"),
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Cameras"),
		},
		Configurable: &pb.ConfigurableComponent{
			Label: proto.String("Webcams"),
		},
		Interactivity: &pb.InteractivityComponent{},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	return controller.Run(ctx, "webcam.service", func(ctx context.Context, entity *pb.Entity, ready func()) error {
		ready()

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

		logger.Info("webcam discovery started", "nodeEntityID", nodeEntityID)

		streamer := newStreamer(logger, func(id string, captureErr error) {
			entityID := fmt.Sprintf("webcam.device.%s.%s", nodeEntityID, id)
			_, _ = client.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{{
					Id: entityID,
					Device: &pb.DeviceComponent{
						State: pb.DeviceState_DeviceStateFailed,
						Error: proto.String(captureErr.Error()),
					},
				}},
			})
		})
		defer streamer.close()

		known := make(map[string]webcamInfo)
		snapshots := discoverAndWatch(ctx, logger)

		for {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case current, ok := <-snapshots:
				if !ok {
					return nil
				}
				reconcile(ctx, logger, client, nodeEntityID, streamer, known, current)
				known = current

				_, _ = client.Push(ctx, &pb.EntityChangeRequest{
					Changes: []*pb.Entity{{
						Id: "webcam.service",
						Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
							{Kind: pb.MetricKind_MetricKindCount.Enum(), Label: proto.String("Connected Cameras"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: uint64(len(known))}},
						}},
					}},
				})
			}
		}
	})
}

// reconcile compares the known camera set with the current snapshot and pushes
// new camera entities / expires removed ones.
func reconcile(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient,
	nodeEntityID string, streamer *streamer, known, current map[string]webcamInfo,
) {
	// New cameras.
	var newEntities []*pb.Entity
	for id, info := range current {
		if _, exists := known[id]; exists {
			continue
		}
		logger.Info("webcam appeared", "id", id, "name", info.Name, "device", info.DevicePath)

		devInfo := devices.DeviceInfo{
			Name:  id,
			Label: info.Name,
			USB:   info.USB,
		}
		entity := devices.BuildDeviceEntity("webcam", nodeEntityID, devInfo)
		serviceID := "webcam.service"
		entity.Device.Parent = &serviceID
		entity.Device.Class = proto.String("camera")

		// Check if the camera is accessible for capture.
		if err := validateCapture(logger, info); err != nil {
			logger.Warn("webcam not capturable", "id", id, "error", err)
			entity.Device.State = pb.DeviceState_DeviceStateFailed
			entity.Device.Error = proto.String(err.Error())
		} else {
			entity.Device.State = pb.DeviceState_DeviceStateActive
			// Only register with streamer if capture is possible.
			streams := streamer.register(id, info)
			entity.Camera = &pb.CameraComponent{
				Streams: streams,
			}
			entity.Routing = &pb.Routing{Channels: []*pb.Channel{{}}}
		}

		newEntities = append(newEntities, entity)
	}

	if len(newEntities) > 0 {
		if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: newEntities}); err != nil {
			logger.Error("failed to push webcam device entities", "error", err)
		}
	}

	// Removed cameras.
	for id := range known {
		if _, exists := current[id]; exists {
			continue
		}
		logger.Info("webcam removed", "id", id)
		streamer.unregister(id)
		entityID := fmt.Sprintf("webcam.device.%s.%s", nodeEntityID, id)
		if _, err := client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: entityID}); err != nil {
			logger.Error("failed to expire webcam device entity", "id", id, "error", err)
		}
	}
}
