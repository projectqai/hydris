package engine

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/projectqai/hydris/engine/meta"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const testVehicle = "vehicle"

func manualWorld(t *testing.T) *WorldServer {
	t.Helper()
	return testWorld(map[string]*pb.Entity{
		testVehicle: {Id: testVehicle, ManualControl: &pb.ManualControlComponent{}},
	})
}

func frame(session string, forward float32) *pb.Entity {
	return &pb.Entity{Id: testVehicle, TargetManualControl: &pb.TargetManualControlComponent{
		Session: &session,
		Input:   []*pb.ManualControlInput{{Axes: &pb.ManualControlAxes{Forward: &forward}}},
	}}
}

func release(session string) *pb.Entity {
	return &pb.Entity{Id: testVehicle, TargetManualControl: &pb.TargetManualControlComponent{Session: &session}}
}

func sendFrame(w *WorldServer, e ...*pb.Entity) error {
	_, err := w.Push(context.Background(), connect.NewRequest(&pb.EntityChangeRequest{Changes: e}))
	return err
}

// the frame as a driver sees it, nil if there is none
func current(w *WorldServer) *pb.TargetManualControlComponent {
	return w.GetHead(testVehicle).GetTargetManualControl()
}

func lapse(w *WorldServer) {
	w.head[testVehicle].lifetimes[manualFrameProtoNum] = meta.Component{Until: time.Now().Add(-time.Second)}
	w.GC()
}

func TestManual_FrameIsStampedAndLapses(t *testing.T) {
	w := manualWorld(t)
	if err := sendFrame(w, frame("a", 1)); err != nil {
		t.Fatal(err)
	}
	f := current(w)
	if f == nil || f.Input[0].Axes.GetForward() != 1 {
		t.Fatalf("frame not stored: %v", f)
	}
	if f.At == nil || time.Since(f.At.AsTime()) > time.Second {
		t.Errorf("frame must carry its receive time, got %v", f.At)
	}
	first := f.At.AsTime()
	time.Sleep(2 * time.Millisecond)
	if err := sendFrame(w, frame("a", 2)); err != nil {
		t.Fatal(err)
	}
	if !current(w).At.AsTime().After(first) {
		t.Error("each frame must be distinguishable from the last")
	}
	lapse(w)
	if w.GetHead(testVehicle) == nil {
		t.Fatal("the vehicle went with its lapsed frame")
	}
	if current(w) != nil {
		t.Error("the frame must lapse by itself")
	}
}

// The sender's clock doesn't matter, and an expiring frame must not take a
// vehicle whose other components have no lifetime with it.
func TestManual_SenderLifetimeIsIgnored(t *testing.T) {
	w := manualWorld(t)
	past := time.Now().Add(-time.Hour)
	e := frame("", 1)
	e.Lifetime = &pb.Lifetime{From: timestamppb.New(past), Until: timestamppb.New(past)}
	if err := sendFrame(w, e); err != nil {
		t.Fatal(err)
	}
	if current(w) == nil {
		t.Fatal("frame not stored")
	}
	w.GC()
	if w.GetHead(testVehicle) == nil {
		t.Fatal("vehicle was deleted when the frame lapsed")
	}
}

func TestManual_OtherSessionRejectedWhileHeld(t *testing.T) {
	w := manualWorld(t)
	if err := sendFrame(w, frame("a", 1)); err != nil {
		t.Fatal(err)
	}
	if err := sendFrame(w, frame("b", 2)); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", err)
	}
	if current(w).Input[0].Axes.GetForward() != 1 {
		t.Error("rejected frame must not be stored")
	}
	if err := sendFrame(w, frame("a", 3)); err != nil {
		t.Errorf("holder must keep control: %v", err)
	}
}

func TestManual_TakeoverAfterHolderGoesSilent(t *testing.T) {
	w := manualWorld(t)
	if err := sendFrame(w, frame("a", 1)); err != nil {
		t.Fatal(err)
	}
	w.manual.by[testVehicle] = manualHolder{session: "a", last: time.Now().Add(-manualHoldTimeout)}
	if err := sendFrame(w, frame("b", 2)); err != nil {
		t.Fatalf("silent holder must not block others: %v", err)
	}
	if err := sendFrame(w, frame("a", 3)); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("the old holder is now the outsider, got %v", err)
	}
}

func TestManual_Release(t *testing.T) {
	w := manualWorld(t)
	if err := sendFrame(w, frame("a", 1)); err != nil {
		t.Fatal(err)
	}
	at := current(w).At.AsTime()

	// an outsider can't release
	if err := sendFrame(w, release("b")); err != nil {
		t.Fatal(err)
	}
	if f := current(w); !f.At.AsTime().Equal(at) || len(f.Input) == 0 {
		t.Error("an outsider's release must not reach the driver")
	}

	time.Sleep(2 * time.Millisecond)
	if err := sendFrame(w, release("a")); err != nil {
		t.Fatal(err)
	}
	if f := current(w); f == nil || len(f.Input) != 0 || !f.At.AsTime().After(at) {
		t.Fatalf("driver must see the release, got %v", f)
	}
	if err := sendFrame(w, frame("b", 2)); err != nil {
		t.Errorf("released vehicle must be free: %v", err)
	}
}

func TestManual_RejectsWhatCannotBeDriven(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{"plain": {Id: "plain"}})
	input := frame("a", 1).TargetManualControl
	for id, want := range map[string]connect.Code{
		"nope":  connect.CodeNotFound,
		"plain": connect.CodeFailedPrecondition,
	} {
		if err := sendFrame(w, &pb.Entity{Id: id, TargetManualControl: input}); connect.CodeOf(err) != want {
			t.Errorf("%s: got %v", id, err)
		}
	}
}

// The lifetime that makes a frame lapse must not reach what else was pushed.
func TestManual_RestOfPushKeepsItsLifetime(t *testing.T) {
	w := manualWorld(t)
	e := frame("a", 1)
	e.Label = proto.String("kept")
	if err := sendFrame(w, e); err != nil {
		t.Fatal(err)
	}
	if w.GetHead(testVehicle).GetLabel() != "kept" || current(w) == nil {
		t.Fatalf("head = %v", w.GetHead(testVehicle))
	}
	lapse(w)
	if w.GetHead(testVehicle).GetLabel() != "kept" {
		t.Error("the label lapsed with the frame")
	}
}

// A vehicle whose only component with a lifetime is a frame must survive it.
func TestManual_FrameAloneDoesNotKeepOrKillVehicle(t *testing.T) {
	w := manualWorld(t)
	if err := sendFrame(w, frame("a", 1)); err != nil {
		t.Fatal(err)
	}
	for protoNum := range w.head[testVehicle].lifetimes {
		if protoNum != manualFrameProtoNum {
			w.head[testVehicle].lifetimes[protoNum] = meta.Component{NoLifetime: true}
		}
	}
	lapse(w)
	if w.GetHead(testVehicle) == nil || current(w) != nil {
		t.Fatalf("head = %v", w.GetHead(testVehicle))
	}
}
