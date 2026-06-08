package goom

import (
	"context"
	"log/slog"
	"time"

	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

const taskShoot = controllerName + ".shoot"

func taskableIDs() []string {
	return []string{taskShoot}
}

func pushTaskables(ctx context.Context) error {
	svcID := playerEntityID
	return controller.Push(ctx, controllerName, &pb.Entity{
		Id:      taskShoot,
		Label:   proto.String("Shoot"),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("crosshair"),
		},
		Taskable: &pb.TaskableComponent{
			Priority: proto.Uint32(100),
			Label:    proto.String("Shoot"),
			Icon:     proto.String("crosshair"),
			Mode:     pb.TaskableMode_TaskableModeReconcile,
			Effect:   proto.String("Fire the pistol at whatever is in the crosshair"),
			Assignee: []*pb.TaskableAssignee{{EntityId: &svcID}},
			Taxonomy: &pb.TaskingTaxonomy{
				Kind: &pb.TaskingTaxonomy_Effect{Effect: &pb.TaskingTaxonomyEffect{}},
			},
		},
	})
}

func watchTaskExecutions(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, s *state) {
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        proto.String(taskShoot),
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentTaskExecution)},
		},
	})
	if err != nil {
		logger.Warn("goom: watch shoot task", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Warn("goom: shoot task recv", "error", err)
			return
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		exec := event.Entity.TaskExecution
		if exec == nil || exec.State != pb.TaskExecutionState_TaskExecutionStatePending {
			continue
		}

		pushExecState(ctx, client, taskShoot, pb.TaskExecutionState_TaskExecutionStateRunning, "")
		s.mu.Lock()
		hit := s.game.Shoot()
		s.mu.Unlock()
		reason := "miss"
		if hit {
			reason = "hit!"
		}
		logger.Info("goom task executed", "task", taskShoot, "result", reason)
		pushExecState(ctx, client, taskShoot, pb.TaskExecutionState_TaskExecutionStateCompleted, reason)
	}
}

func pushExecState(ctx context.Context, client pb.WorldServiceClient, entityID string, st pb.TaskExecutionState, reason string) {
	exec := &pb.TaskExecutionComponent{
		Task:  entityID,
		State: st,
	}
	if reason != "" {
		exec.Reason = &reason
	}
	_, _ = client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:            entityID,
			TaskExecution: exec,
		}},
	})
}

const moveStep = 0.045

func watchManualControl(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, s *state) {
	id := playerEntityID
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &id,
			Component: []uint32{65},
		},
	})
	if err != nil {
		logger.Warn("goom: manual control watch", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Warn("goom: manual control recv", "error", err)
			return
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		tmc := event.Entity.TargetManualControl
		if tmc == nil || len(tmc.Input) == 0 {
			s.mu.Lock()
			s.axisForward = 0
			s.axisRight = 0
			s.axisPan = 0
			s.axisTilt = 0
			s.mu.Unlock()
			continue
		}

		axes := tmc.Input[0].Axes
		if axes == nil {
			s.mu.Lock()
			s.axisForward = 0
			s.axisRight = 0
			s.axisPan = 0
			s.axisTilt = 0
			s.mu.Unlock()
			continue
		}
		s.mu.Lock()
		s.axisForward = axes.GetForward()
		s.axisRight = axes.GetRight()
		s.axisPan = axes.GetPan()
		s.axisTilt = axes.GetTilt()
		s.lastControl = time.Now()
		s.mu.Unlock()
	}
}
