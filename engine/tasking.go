package engine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

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

	switch entity.Taskable.Mode {
	case pb.TaskableMode_TaskableModeExclusive:
		return s.runTaskExclusive(entity, req)
	case pb.TaskableMode_TaskableModeReconcile:
		return s.runTaskReconcile(entity, req)
	case pb.TaskableMode_TaskableModePriorityQueue:
		return s.runTaskPriorityQueue(entity, req)
	case pb.TaskableMode_TaskableModeSpawn:
		return s.runTaskSpawn(entity)
	default:
		return s.runTaskExclusive(entity, req)
	}
}

// runTaskExclusive places the TaskExecutionComponent on the taskable entity itself.
// Rejects the call if an execution is already active.
// Caller must hold s.l.
func (s *WorldServer) runTaskExclusive(entity *pb.Entity, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	if entity.TaskExecution != nil {
		state := entity.TaskExecution.State
		if state == pb.TaskExecutionState_TaskExecutionStatePending || state == pb.TaskExecutionState_TaskExecutionStateRunning {
			return nil, connect.NewError(connect.CodeAlreadyExists,
				fmt.Errorf("task is already being executed"))
		}
	}

	return s.setTaskExecution(entity, req)
}

// runTaskReconcile places the TaskExecutionComponent on the taskable entity itself,
// replacing any existing execution.
// Caller must hold s.l.
func (s *WorldServer) runTaskReconcile(entity *pb.Entity, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	return s.setTaskExecution(entity, req)
}

// setTaskExecution sets a pending TaskExecutionComponent on the entity and notifies the bus.
// Caller must hold s.l.
func (s *WorldServer) setTaskExecution(entity *pb.Entity, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	entity.TaskExecution = &pb.TaskExecutionComponent{
		Task:     entity.Id,
		State:    pb.TaskExecutionState_TaskExecutionStatePending,
		Priority: req.Msg.Priority,
	}
	entity.Lifetime.Fresh = timestamppb.Now()

	s.bus.Dirty(entity.Id, entity, pb.EntityChange_EntityChangeUpdated)

	return connect.NewResponse(&pb.RunTaskResponse{
		ExecutionId: entity.Id,
		Status:      pb.TaskStatus_TaskStatusRunning,
	}), nil
}

// runTaskPriorityQueue creates a child entity with TaskExecutionComponent + priority.
// The driver picks the highest-priority active task from the children.
// Caller must hold s.l.
func (s *WorldServer) runTaskPriorityQueue(entity *pb.Entity, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
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
		Controller: entity.Controller,
		TaskExecution: &pb.TaskExecutionComponent{
			Task:     entity.Id,
			State:    pb.TaskExecutionState_TaskExecutionStatePending,
			Priority: req.Msg.Priority,
		},
	}

	s.setEntity(execID, execEntity, nil)
	s.bus.Dirty(execID, execEntity, pb.EntityChange_EntityChangeUpdated)

	return connect.NewResponse(&pb.RunTaskResponse{
		ExecutionId: execID,
		Status:      pb.TaskStatus_TaskStatusRunning,
	}), nil
}

// runTaskSpawn creates a new child entity with a TaskExecutionComponent.
// Caller must hold s.l.
func (s *WorldServer) runTaskSpawn(entity *pb.Entity) (*connect.Response[pb.RunTaskResponse], error) {
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
		Controller: entity.Controller,
		TaskExecution: &pb.TaskExecutionComponent{
			Task:  entity.Id,
			State: pb.TaskExecutionState_TaskExecutionStatePending,
		},
	}

	s.setEntity(execID, execEntity, nil)
	s.bus.Dirty(execID, execEntity, pb.EntityChange_EntityChangeUpdated)

	return connect.NewResponse(&pb.RunTaskResponse{
		ExecutionId: execID,
		Status:      pb.TaskStatus_TaskStatusRunning,
	}), nil
}
