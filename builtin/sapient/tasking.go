package sapient

import (
	"context"
	"log/slog"
	"sync"

	"github.com/aep/gosapient/pkg/sapient"
	sapientpb "github.com/aep/gosapient/pkg/sapientpb"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
)

// reportedMode tracks the sensor's actual mode from StatusReport.
type reportedMode struct {
	mu   sync.Mutex
	mode string
}

func (r *reportedMode) Set(mode string) {
	r.mu.Lock()
	r.mode = mode
	r.mu.Unlock()
}

func (r *reportedMode) Get() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.mode
}

// watchSensorEntity watches a sensor entity for mode config changes
// and sends SAPIENT mode_change tasks when the requested mode differs
// from the sensor's reported mode.
func watchSensorEntity(ctx context.Context, logger *slog.Logger, conn *sapient.Conn, myNodeID, sapientNodeID, sensorEntityID string, sensorMode *reportedMode) {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		logger.Error("sensor watcher: grpc connection", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, worldClient, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id: &sensorEntityID,
		},
	})
	if err != nil {
		logger.Error("sensor watcher: watch entities", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Error("sensor watcher: recv", "error", err)
			return
		}

		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}

		cfg := event.Entity.Config
		if cfg == nil || cfg.Value == nil {
			continue
		}

		if v, ok := cfg.Value.Fields["mode"]; ok {
			mode := v.GetStringValue()
			if mode != "" && mode != sensorMode.Get() {
				task := sapient.NewTask(sapientpb.Task_CONTROL_START).
					ModeChange(mode).
					Build()
				logger.Info("sending mode change",
					"sensor", sensorEntityID,
					"mode", mode)
				if err := conn.SendTask(myNodeID, sapientNodeID, task); err != nil {
					logger.Error("send mode change", "error", err)
				}
			}
		}
	}
}
