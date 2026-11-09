package playground

import (
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
)

// A spawned capture run is answered on its own entity, but its task must
// keep naming the capture taskable: that is how a run is found as one of it.
func TestModeDemo_CaptureRunsBelongToTheTaskable(t *testing.T) {
	d := newModeDemo("sensor")
	child := d.captureID() + ".exec-1"
	for _, e := range []*pb.Entity{
		d.ofCapture(d.running(child, "frame 1 of 10", time.Now(), nil)),
		d.ofCapture(d.answer(child, pb.TaskExecutionState_TaskExecutionStateCompleted, "10 frames saved")),
	} {
		if e.Id != child {
			t.Errorf("answered on %s, want the run's own entity %s", e.Id, child)
		}
		if got := e.GetTaskExecution().GetTask(); got != d.captureID() {
			t.Errorf("task = %s, want the capture taskable %s", got, d.captureID())
		}
	}
}
