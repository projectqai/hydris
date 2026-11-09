package engine

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	pb "github.com/projectqai/proto/go"
)

func TestCancelTask(t *testing.T) {
	ctx := context.Background()
	w := testWorld(map[string]*pb.Entity{
		"exclusive": {Id: "exclusive", Lifetime: &pb.Lifetime{}, Taskable: &pb.TaskableComponent{Mode: pb.TaskableMode_TaskableModeExclusive}},
		"spawn":     {Id: "spawn", Lifetime: &pb.Lifetime{}, Taskable: &pb.TaskableComponent{Mode: pb.TaskableMode_TaskableModeSpawn}},
		"plain":     {Id: "plain", Lifetime: &pb.Lifetime{}, Label: ptr("not a task")},
	})
	run := func(id string) string {
		t.Helper()
		resp, err := w.RunTask(ctx, peerRequest(&pb.RunTaskRequest{EntityId: id}))
		if err != nil {
			t.Fatal(err)
		}
		return resp.Msg.ExecutionId
	}
	cancel := func(id string) error {
		_, err := w.CancelTask(ctx, peerRequest(&pb.CancelTaskRequest{ExecutionId: id}))
		return err
	}

	t.Run("exclusive", func(t *testing.T) {
		exec := run("exclusive")
		if exec != "exclusive" {
			t.Fatalf("an exclusive execution lives on the taskable, got %s", exec)
		}
		if err := cancel(exec); err != nil {
			t.Fatal(err)
		}
		e := w.GetHead("exclusive")
		if e.TaskExecution != nil || e.Taskable == nil {
			t.Fatalf("cancel removes the execution and keeps the taskable: %v", e)
		}
		run("exclusive") // no longer in flight
		if err := cancel("exclusive"); err != nil {
			t.Fatal(err)
		}
		if err := cancel("exclusive"); err != nil {
			t.Fatalf("cancelling with nothing to cancel is fine: %v", err)
		}
	})

	t.Run("running", func(t *testing.T) {
		exec := run("exclusive")
		if _, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{Changes: []*pb.Entity{{Id: exec,
			TaskExecution: &pb.TaskExecutionComponent{Task: exec, State: pb.TaskExecutionState_TaskExecutionStateRunning}}}})); err != nil {
			t.Fatal(err)
		}
		err := cancel(exec)
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("a running execution cannot be cancelled, got %v", err)
		}
		if w.GetHead(exec).TaskExecution == nil {
			t.Error("a refused cancel leaves the execution")
		}
		if _, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{Changes: []*pb.Entity{{Id: exec,
			TaskExecution: &pb.TaskExecutionComponent{Task: exec, State: pb.TaskExecutionState_TaskExecutionStateCompleted}}}})); err != nil {
			t.Fatal(err)
		}
		if err := cancel(exec); err != nil {
			t.Fatalf("a finished execution can be dismissed: %v", err)
		}
	})

	t.Run("spawn", func(t *testing.T) {
		first, second := run("spawn"), run("spawn")
		if err := cancel(first); err != nil {
			t.Fatal(err)
		}
		if lt := w.GetHead(first).GetLifetime(); !lt.GetUntil().IsValid() {
			t.Error("a cancelled spawned execution is expired")
		}
		if lt := w.GetHead(second).GetLifetime(); lt.GetUntil().IsValid() {
			t.Error("other executions are left alone")
		}
		if w.GetHead("spawn").Taskable == nil {
			t.Error("the taskable is left alone")
		}
	})

	t.Run("errors", func(t *testing.T) {
		if connect.CodeOf(cancel("ghost")) != connect.CodeNotFound {
			t.Error("unknown execution")
		}
		if connect.CodeOf(cancel("plain")) != connect.CodeFailedPrecondition {
			t.Error("an entity without execution is not a task execution")
		}
	})
}

func TestMaxExecutions(t *testing.T) {
	ctx := context.Background()
	three := uint32(3)
	w := testWorld(map[string]*pb.Entity{
		"capped":  {Id: "capped", Lifetime: &pb.Lifetime{}, Taskable: &pb.TaskableComponent{Mode: pb.TaskableMode_TaskableModeSpawn, MaxExecutions: &three}},
		"default": {Id: "default", Lifetime: &pb.Lifetime{}, Taskable: &pb.TaskableComponent{Mode: pb.TaskableMode_TaskableModeSpawn}},
	})
	run := func(id string) (string, error) {
		resp, err := w.RunTask(ctx, peerRequest(&pb.RunTaskRequest{EntityId: id}))
		if err != nil {
			return "", err
		}
		return resp.Msg.ExecutionId, nil
	}
	finish := func(id string) {
		t.Helper()
		if _, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{Changes: []*pb.Entity{{Id: id,
			TaskExecution: &pb.TaskExecutionComponent{Task: "capped", State: pb.TaskExecutionState_TaskExecutionStateCompleted}}}})); err != nil {
			t.Fatal(err)
		}
	}
	expired := func(id string) bool { return w.GetHead(id).GetLifetime().GetUntil().IsValid() }

	var runs []string
	for range 3 {
		id, err := run("capped")
		if err != nil {
			t.Fatal(err)
		}
		runs = append(runs, id)
	}
	if _, err := run("capped"); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a fourth run while three are in flight must fail, got %v", err)
	}

	finish(runs[0])
	finish(runs[1])
	if _, err := run("capped"); err != nil {
		t.Fatalf("with finished runs there is room: %v", err)
	}
	if !expired(runs[0]) {
		t.Error("the oldest finished run makes room")
	}
	if expired(runs[1]) || expired(runs[2]) {
		t.Error("only as many as needed are expired, and never one in flight")
	}

	for i := range defaultMaxExecutions {
		if _, err := run("default"); err != nil {
			t.Fatalf("run %d of the default %d: %v", i+1, defaultMaxExecutions, err)
		}
	}
	if _, err := run("default"); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("unset max_executions means %d, got %v", defaultMaxExecutions, err)
	}
}
