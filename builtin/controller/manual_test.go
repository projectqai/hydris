package controller

import (
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
)

func TestManualInput_LinkLossAndRelease(t *testing.T) {
	var in ManualInput
	if in.Axes() != nil {
		t.Error("no command before any frame")
	}
	in.set(&pb.ManualControlAxes{})
	if in.Axes() == nil {
		t.Error("a fresh frame is a command")
	}
	in.mu.Lock()
	in.at = time.Now().Add(-ManualLinkTimeout - time.Millisecond)
	in.mu.Unlock()
	if in.Axes() != nil {
		t.Error("the command must lapse when frames stop")
	}
	in.set(&pb.ManualControlAxes{})
	in.set(nil)
	if in.Axes() != nil {
		t.Error("a release ends the command at once")
	}
}
