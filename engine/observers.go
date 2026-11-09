package engine

import (
	"context"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"

	"connectrpc.com/connect"
)

func (s *WorldServer) WatchEntities(ctx context.Context, req *connect.Request[pb.ListEntitiesRequest], stream *connect.ServerStream[pb.EntityChangeEvent]) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	consumer := NewConsumer(s, req.Msg.Behaviour, req.Msg.Filter)
	consumer.cancel = cancel
	consumer.actor = actorFromContext(ctx)
	consumer.builtin, _ = ctx.Value(builtinNameKey).(string)
	s.bus.Register(consumer)
	defer s.bus.Unregister(consumer)

	// stamp every event with our wall clock so consumers without a synced
	// clock can estimate the offset
	send := func(ev *pb.EntityChangeEvent) error {
		ev.Now = timestamppb.Now()
		return stream.Send(ev)
	}

	// UI workaround - send an initial invalid event to signal stream is ready
	if err := send(&pb.EntityChangeEvent{
		T: pb.EntityChange_EntityChangeInvalid,
	}); err != nil {
		return err
	}

	// Send initial snapshot sorted by Lifetime.From
	s.l.RLock()
	var snapshot []*pb.Entity
	for _, es := range s.head {
		e := es.entity
		if s.matchesEntityFilter(e, req.Msg.Filter) {
			snapshot = append(snapshot, e)
		}
	}
	s.l.RUnlock()

	if len(req.Msg.Sort) > 0 {
		sortEntities(snapshot, req.Msg.Sort)
	} else {
		sortEntities(snapshot, defaultWatchSort)
	}

	for _, e := range snapshot {
		if err := send(&pb.EntityChangeEvent{
			Entity: e,
			T:      pb.EntityChange_EntityChangeUpdated,
		}); err != nil {
			return err
		}
	}

	return consumer.SenderLoop(ctx, send)
}
