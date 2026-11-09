package engine

import (
	"context"
	"fmt"
	"reflect"
	"sync"
	"time"

	"connectrpc.com/connect"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Manual control frames are commands, not state. They are stored on the entity
// like any component, but with a lifetime of a fraction of a second that the
// node sets itself, so a dead operator's last command lapses instead of lingering
// and a sender's clock doesn't matter. The frame is pushed as a stub of its own,
// so that lifetime never applies to anything else in the same push.

const (
	// how long a silent holder keeps others out. Longer than a driver's
	// link-loss timeout, so the vehicle fails safe before anyone can take over.
	manualHoldTimeout = time.Second
	// how long a frame stays on the entity
	manualFrameTTL = 500 * time.Millisecond
)

type manualHolder struct {
	session string
	last    time.Time
}

// manualHolders' zero value is ready to use.
type manualHolders struct {
	mu sync.Mutex
	by map[string]manualHolder
}

// stampManualFrames checks the control frames in a push, arbitrates between
// operators, and gives each frame its receive time and lifetime. An error
// rejects the whole push.
func (s *WorldServer) stampManualFrames(ctx context.Context, msg *pb.EntityChangeRequest) error {
	var frames []*pb.Entity
	kept := msg.Changes[:0]
	for _, e := range msg.Changes {
		tmc := e.TargetManualControl
		if tmc == nil {
			kept = append(kept, e)
			continue
		}
		s.l.RLock()
		es := s.head[e.Id]
		found := es != nil
		drivable := found && es.entity.ManualControl != nil
		s.l.RUnlock()

		switch {
		case !found:
			return connect.NewError(connect.CodeNotFound, fmt.Errorf("entity %s not found", e.Id))
		case !drivable:
			return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("entity %s cannot be driven", e.Id))
		}
		accepted, err := s.manual.admit(ctx, e.Id, tmc)
		if err != nil {
			return err
		}
		e.TargetManualControl = nil
		if hasOtherComponents(e) {
			kept = append(kept, e)
		}
		if !accepted {
			continue
		}
		now := time.Now()
		frames = append(frames, &pb.Entity{
			Id: e.Id,
			TargetManualControl: &pb.TargetManualControlComponent{
				Input: tmc.Input, Session: tmc.Session, At: timestamppb.New(now),
			},
			Lifetime: &pb.Lifetime{From: timestamppb.New(now), Until: timestamppb.New(now.Add(manualFrameTTL))},
		})
	}
	msg.Changes = append(kept, frames...)
	return nil
}

func hasOtherComponents(e *pb.Entity) bool {
	v := reflect.ValueOf(e).Elem()
	for protoNum, fieldIdx := range protoNumToFieldIdx {
		if protoNum == lifetimeProtoNum {
			continue
		}
		if f := v.Field(fieldIdx); f.Kind() == reflect.Pointer && !f.IsNil() {
			return true
		}
	}
	return false
}

// admit decides whether a frame goes through: the first session to send holds
// the vehicle. A release from anyone but the holder is dropped, without error.
func (h *manualHolders) admit(ctx context.Context, id string, tmc *pb.TargetManualControlComponent) (bool, error) {
	session := tmc.GetSession()
	if session == "" {
		session = "actor:" + actorFromContext(ctx)
	}
	now := time.Now()

	h.mu.Lock()
	defer h.mu.Unlock()
	holder, held := h.by[id]
	held = held && now.Sub(holder.last) < manualHoldTimeout

	if len(tmc.Input) == 0 { // release
		if !held || holder.session != session {
			return false, nil
		}
		delete(h.by, id)
		return true, nil
	}
	if held && holder.session != session {
		return false, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("%s is being controlled by someone else", id))
	}
	if h.by == nil {
		h.by = map[string]manualHolder{}
	}
	h.by[id] = manualHolder{session: session, last: now}
	return true, nil
}
