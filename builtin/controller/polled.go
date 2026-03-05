package controller

import (
	"context"
	"log/slog"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// PollFunc does one unit of work (one sweep, one poll).
// It returns the desired delay before the next poll and an error.
// On error, the framework retries with backoff (ignoring the returned duration).
// On success, the framework waits for the returned duration before calling again.
// A duration <= 0 is treated as 30s.
type PollFunc func(ctx context.Context, entity *pb.Entity) (time.Duration, error)

// RunPolled watches a single entity by ID using WatchEntities and runs a
// polling loop when the entity has a Config. The PollFunc is called once
// per cycle; the interval between cycles is determined by the PollFunc's
// return value.
func RunPolled(ctx context.Context, entityID string, run PollFunc) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, worldClient, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id: &entityID,
		},
	})
	if err != nil {
		return err
	}

	pushConfigurableState := func(entity *pb.Entity, state pb.ConfigurableState, errMsg string, scheduledAt *time.Time, applied bool) {
		var cfg *pb.ConfigurableComponent
		if entity.Configurable != nil {
			cfg = proto.Clone(entity.Configurable).(*pb.ConfigurableComponent)
		} else {
			cfg = &pb.ConfigurableComponent{}
		}
		cfg.State = state
		if errMsg != "" {
			cfg.Error = proto.String(errMsg)
		} else {
			cfg.Error = nil
		}
		if scheduledAt != nil {
			cfg.ScheduledAt = timestamppb.New(*scheduledAt)
		} else {
			cfg.ScheduledAt = nil
		}
		if applied && entity.Config != nil {
			cfg.AppliedVersion = entity.Config.Version
		}
		_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id:           entityID,
				Configurable: cfg,
			}},
		})
	}

	var cancel context.CancelFunc
	var currentEntity *pb.Entity

	stopRunning := func() {
		if cancel != nil {
			cancel()
			cancel = nil
			pushConfigurableState(currentEntity, pb.ConfigurableState_ConfigurableStateInactive, "", nil, false)
			currentEntity = nil
		}
	}

	startRunning := func(entity *pb.Entity) {
		var connCtx context.Context
		connCtx, cancel = context.WithCancel(ctx)
		currentEntity = entity

		go func() {
			for {
				if connCtx.Err() != nil {
					return
				}

				pushConfigurableState(entity, pb.ConfigurableState_ConfigurableStateActive, "", nil, false)

				interval, err := run(connCtx, entity)
				if connCtx.Err() != nil {
					return
				}

				if err != nil {
					errMsg := err.Error()
					slog.Error("poll error, restarting", "entity", entityID, "error", err)
					pushConfigurableState(entity, pb.ConfigurableState_ConfigurableStateFailed, errMsg, nil, true)

					select {
					case <-connCtx.Done():
						return
					case <-time.After(5 * time.Second):
					}
					continue
				}

				if interval <= 0 {
					interval = 30 * time.Second
				}

				// Success: wait for next interval.
				nextRun := time.Now().Add(interval)
				pushConfigurableState(entity, pb.ConfigurableState_ConfigurableStateScheduled, "", &nextRun, true)

				select {
				case <-connCtx.Done():
					return
				case <-time.After(interval):
				}
			}
		}()
	}

	defer stopRunning()

	for {
		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			entity := event.Entity
			if entity.Config == nil {
				stopRunning()
				continue
			}
			if currentEntity != nil && proto.Equal(currentEntity.Config, entity.Config) {
				continue
			}
			stopRunning()
			startRunning(entity)

		case pb.EntityChange_EntityChangeExpired, pb.EntityChange_EntityChangeUnobserved:
			stopRunning()
		}
	}
}
