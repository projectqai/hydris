package netscan

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/builtin/devices"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const deviceTTL = 5 * time.Minute

// progressFunc is called with a value between 0 and 1 to report sweep progress.
type progressFunc func(fraction float64)

func init() {
	builtin.Register("netscan", Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	if !builtin.LocalPermissions.AllowNetscan {
		logger.Info("network scanning disabled (use --allow-netscan to enable)")
		<-ctx.Done()
		return ctx.Err()
	}

	logger.Info("network scanner started")

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

	controllerName := "netscan"

	// Push service entity.
	if err := controller.Push(ctx, &pb.Entity{
		Id:    "netscan.service",
		Label: proto.String("Network Scanner"),
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
		},
		Interactivity: &pb.InteractivityComponent{},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	logger.Info("network scan loop started", "nodeEntityID", nodeEntityID)

	known := make(map[string]devices.DeviceInfo)

	pushMetrics := func(sweepProgress float64, lastSweepDevices int) {
		_, _ = client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: "netscan.service",
				Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
					{Kind: pb.MetricKind_MetricKindCount.Enum(), Label: proto.String("devices discovered"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: uint64(len(known))}},
					{Kind: pb.MetricKind_MetricKindCount.Enum(), Label: proto.String("devices found in last sweep"), Id: proto.Uint32(2), Val: &pb.Metric_Uint64{Uint64: uint64(lastSweepDevices)}},
					{Kind: pb.MetricKind_MetricKindProgress.Enum(), Label: proto.String("sweep progress"), Id: proto.Uint32(3), Val: &pb.Metric_Float{Float: float32(sweepProgress)}},
				}},
			}},
		})
	}

	return controller.RunPolled(ctx, "netscan.service", func(ctx context.Context, entity *pb.Entity) (time.Duration, error) {
		var lastSnapshotSize int

		for snapshot := range scanNetwork(ctx, logger, func(fraction float64) {
			pushMetrics(fraction, lastSnapshotSize)
		}) {
			reconcile(ctx, logger, client, nodeEntityID, known, snapshot)
			lastSnapshotSize = len(snapshot)
			for k, v := range snapshot {
				known[k] = v
			}
			pushMetrics(1, lastSnapshotSize)
		}
		return 30 * time.Second, nil
	})
}

// reconcile pushes every device in the current snapshot with a TTL so the
// entity stays alive as long as the device responds to sweeps. Devices that
// stop responding simply won't be refreshed and the GC will expire them.
func reconcile(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient,
	nodeEntityID string, known, current map[string]devices.DeviceInfo,
) {
	now := time.Now()
	var entities []*pb.Entity
	for name, info := range current {
		if _, exists := known[name]; !exists {
			logger.Info("network device discovered", "name", name, "host", info.IP.Host)
		}
		entity := devices.BuildDeviceEntity("netscan", nodeEntityID, info)
		serviceID := "netscan.service"
		entity.Device.Parent = &serviceID
		entity.Device.State = pb.DeviceState_DeviceStateActive
		entity.Lifetime = &pb.Lifetime{
			Fresh: timestamppb.New(now),
			Until: timestamppb.New(now.Add(deviceTTL)),
		}
		entities = append(entities, entity)
	}

	if len(entities) > 0 {
		if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: entities}); err != nil {
			logger.Error("failed to push network device entities", "error", err)
		}
	}
}
