package sdk

import (
	"context"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// FailInterrupted fails the executions on the given taskables that are still
// pending or running. Call it when a controller starts, before it watches
// for executions: whatever an earlier run of it was carrying out cannot
// finish any more, and a request made while it was gone is not run late.
func FailInterrupted(ctx context.Context, client pb.WorldServiceClient, ids []string, reason string) error {
	var changes []*pb.Entity
	for _, id := range ids {
		got, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: id})
		if err != nil {
			continue // not there yet
		}
		ex := got.GetEntity().GetTaskExecution()
		if ex == nil || (ex.State != pb.TaskExecutionState_TaskExecutionStatePending && ex.State != pb.TaskExecutionState_TaskExecutionStateRunning) {
			continue
		}
		changes = append(changes, &pb.Entity{Id: id, TaskExecution: &pb.TaskExecutionComponent{
			Task:   ex.Task,
			State:  pb.TaskExecutionState_TaskExecutionStateFailed,
			Reason: proto.String(reason),
			Target: ex.Target,
		}})
	}
	if len(changes) == 0 {
		return nil
	}
	_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: changes})
	return err
}
