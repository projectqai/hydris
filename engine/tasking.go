package engine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"slices"

	"connectrpc.com/connect"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *WorldServer) RunTask(ctx context.Context, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	entityID := req.Msg.EntityId

	if entityID == "" {
		return connect.NewResponse(&pb.RunTaskResponse{
			Status: pb.TaskStatus_TaskStatusInvalid,
		}), nil
	}

	s.l.Lock()
	defer s.l.Unlock()

	es, exists := s.head[entityID]
	if !exists {
		return nil, connect.NewError(connect.CodeNotFound,
			fmt.Errorf("entity %s not found", entityID))
	}
	entity := es.entity

	if entity.Taskable == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("entity %s has no TaskableComponent", entityID))
	}
	if entity.Taskable.Disabled != nil {
		reason := entity.Taskable.GetDisabled()
		if reason == "" {
			reason = "taskable is disabled"
		}
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("%s: %s", entityID, reason))
	}

	switch entity.Taskable.Mode {
	case pb.TaskableMode_TaskableModeExclusive:
		return s.runTaskExclusive(ctx, entity, req)
	case pb.TaskableMode_TaskableModeReconcile:
		return s.runTaskReconcile(ctx, entity, req)
	case pb.TaskableMode_TaskableModePriorityQueue:
		return s.runTaskPriorityQueue(ctx, entity, req)
	case pb.TaskableMode_TaskableModeSpawn:
		return s.runTaskSpawn(ctx, entity)
	default:
		return s.runTaskExclusive(ctx, entity, req)
	}
}

// runTaskExclusive places the TaskExecutionComponent on the taskable entity itself.
// Rejects the call if an execution is already active.
// Caller must hold s.l.
func (s *WorldServer) runTaskExclusive(ctx context.Context, entity *pb.Entity, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	if entity.TaskExecution != nil {
		state := entity.TaskExecution.State
		if state == pb.TaskExecutionState_TaskExecutionStatePending || state == pb.TaskExecutionState_TaskExecutionStateRunning {
			return nil, connect.NewError(connect.CodeAlreadyExists,
				fmt.Errorf("task is already being executed"))
		}
	}

	return s.setTaskExecution(ctx, entity, req)
}

// runTaskReconcile places the TaskExecutionComponent on the taskable entity itself,
// replacing any existing execution.
// Caller must hold s.l.
func (s *WorldServer) runTaskReconcile(ctx context.Context, entity *pb.Entity, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	return s.setTaskExecution(ctx, entity, req)
}

// setTaskExecution sets a pending TaskExecutionComponent on the entity and notifies the bus.
// Caller must hold s.l.
func (s *WorldServer) setTaskExecution(ctx context.Context, entity *pb.Entity, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	entity.TaskExecution = &pb.TaskExecutionComponent{
		Task:     entity.Id,
		State:    pb.TaskExecutionState_TaskExecutionStatePending,
		Priority: req.Msg.Priority,
		Target:   req.Msg.Target,
	}
	entity.Lifetime.Fresh = timestamppb.Now()

	s.bus.Dirty(ctx, entity.Id, entity, pb.EntityChange_EntityChangeUpdated)

	return connect.NewResponse(&pb.RunTaskResponse{
		ExecutionId: entity.Id,
		Status:      pb.TaskStatus_TaskStatusRunning,
	}), nil
}

// runTaskPriorityQueue creates a child entity with TaskExecutionComponent + priority.
// The driver picks the highest-priority active task from the children.
// Caller must hold s.l.
func (s *WorldServer) runTaskPriorityQueue(ctx context.Context, entity *pb.Entity, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	if err := s.makeRoomLocked(ctx, entity); err != nil {
		return nil, err
	}
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to generate execution id: %w", err))
	}
	execID := entity.Id + ".exec-" + hex.EncodeToString(b[:])

	now := timestamppb.Now()
	execEntity := &pb.Entity{
		Id: execID,
		Lifetime: &pb.Lifetime{
			From: now,
		},
		Routing:    &pb.Routing{Channels: []*pb.Channel{{}}},
		Controller: entity.Controller,
		TaskExecution: &pb.TaskExecutionComponent{
			Task:     entity.Id,
			State:    pb.TaskExecutionState_TaskExecutionStatePending,
			Priority: req.Msg.Priority,
			Target:   req.Msg.Target,
		},
	}

	s.setEntity(execID, execEntity, nil)
	s.bus.Dirty(ctx, execID, execEntity, pb.EntityChange_EntityChangeUpdated)

	return connect.NewResponse(&pb.RunTaskResponse{
		ExecutionId: execID,
		Status:      pb.TaskStatus_TaskStatusRunning,
	}), nil
}

// runTaskSpawn creates a new child entity with a TaskExecutionComponent.
// Caller must hold s.l.
func (s *WorldServer) runTaskSpawn(ctx context.Context, entity *pb.Entity) (*connect.Response[pb.RunTaskResponse], error) {
	if err := s.makeRoomLocked(ctx, entity); err != nil {
		return nil, err
	}
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to generate execution id: %w", err))
	}
	execID := entity.Id + ".exec-" + hex.EncodeToString(b[:])

	now := timestamppb.Now()
	execEntity := &pb.Entity{
		Id: execID,
		Lifetime: &pb.Lifetime{
			From: now,
		},
		Routing:    &pb.Routing{Channels: []*pb.Channel{{}}},
		Controller: entity.Controller,
		TaskExecution: &pb.TaskExecutionComponent{
			Task:  entity.Id,
			State: pb.TaskExecutionState_TaskExecutionStatePending,
		},
	}

	s.setEntity(execID, execEntity, nil)
	s.bus.Dirty(ctx, execID, execEntity, pb.EntityChange_EntityChangeUpdated)

	return connect.NewResponse(&pb.RunTaskResponse{
		ExecutionId: execID,
		Status:      pb.TaskStatus_TaskStatusRunning,
	}), nil
}

// CancelTask clears an execution away. On an exclusive or reconcile taskable
// it removes the TaskExecutionComponent, so the controller sees it go; a
// spawned or queued execution entity is expired. A running execution cannot
// be cancelled yet: controllers have no way to stop work on request.
func (s *WorldServer) CancelTask(ctx context.Context, req *connect.Request[pb.CancelTaskRequest]) (*connect.Response[pb.CancelTaskResponse], error) {
	id := req.Msg.ExecutionId
	s.l.Lock()
	defer s.l.Unlock()

	es, exists := s.head[id]
	if !exists {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("execution %s not found", id))
	}
	if es.entity.TaskExecution.GetState() == pb.TaskExecutionState_TaskExecutionStateRunning {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("%s is running and cannot be cancelled", id))
	}
	switch {
	case es.entity.Taskable != nil:
		if es.entity.TaskExecution == nil {
			break // nothing to cancel
		}
		es.entity.TaskExecution = nil
		delete(es.lifetimes, int32(pb.EntityComponent_EntityComponentTaskExecution))
		s.bus.Dirty(ctx, id, es.entity, pb.EntityChange_EntityChangeUpdated)
	case es.entity.TaskExecution != nil:
		s.expireLocked(ctx, es)
	default:
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("%s is not a task execution", id))
	}
	return connect.NewResponse(&pb.CancelTaskResponse{}), nil
}

// defaultMaxExecutions is TaskableComponent.max_executions when unset.
const defaultMaxExecutions = 10

// makeRoomLocked enforces the taskable's max_executions before it spawns or
// queues another execution: it fails while that many are pending or running,
// and otherwise expires the oldest finished ones so the new one fits.
// Caller holds s.l.
func (s *WorldServer) makeRoomLocked(ctx context.Context, taskable *pb.Entity) error {
	limit := defaultMaxExecutions
	if m := taskable.GetTaskable().MaxExecutions; m != nil {
		limit = int(*m)
	}
	inFlight := 0
	var finished []*entityState
	for id, es := range s.head {
		ex := es.entity.TaskExecution
		if ex == nil || ex.Task != taskable.Id || id == taskable.Id || es.hardExpire {
			continue
		}
		switch ex.State {
		case pb.TaskExecutionState_TaskExecutionStatePending, pb.TaskExecutionState_TaskExecutionStateRunning:
			inFlight++
		default:
			finished = append(finished, es)
		}
	}
	if inFlight >= limit {
		return connect.NewError(connect.CodeResourceExhausted,
			fmt.Errorf("%d runs of %s are already in progress, the most it allows", inFlight, taskable.Id))
	}
	excess := inFlight + len(finished) + 1 - limit
	if excess <= 0 {
		return nil
	}
	slices.SortFunc(finished, func(a, b *entityState) int {
		return a.entity.GetLifetime().GetFrom().AsTime().Compare(b.entity.GetLifetime().GetFrom().AsTime())
	})
	for _, es := range finished[:min(excess, len(finished))] {
		s.expireLocked(ctx, es)
	}
	return nil
}
