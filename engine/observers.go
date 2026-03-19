package engine

import (
	"context"
	"sort"

	pb "github.com/projectqai/proto/go"

	"connectrpc.com/connect"
)

func (s *WorldServer) WatchEntities(ctx context.Context, req *connect.Request[pb.ListEntitiesRequest], stream *connect.ServerStream[pb.EntityChangeEvent]) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	consumer := NewConsumer(s, req.Msg.Behaviour, req.Msg.Filter)
	consumer.cancel = cancel
	s.bus.Register(consumer)
	defer s.bus.Unregister(consumer)

	// UI workaround - send an initial invalid event to signal stream is ready
	if err := stream.Send(&pb.EntityChangeEvent{
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

	sort.Slice(snapshot, func(i, j int) bool {
		var ti, tj int64
		if snapshot[i].Lifetime != nil && snapshot[i].Lifetime.From != nil {
			ti = snapshot[i].Lifetime.From.AsTime().UnixNano()
		}
		if snapshot[j].Lifetime != nil && snapshot[j].Lifetime.From != nil {
			tj = snapshot[j].Lifetime.From.AsTime().UnixNano()
		}
		return ti < tj
	})

	for _, e := range snapshot {
		if err := stream.Send(&pb.EntityChangeEvent{
			Entity: e,
			T:      pb.EntityChange_EntityChangeUpdated,
		}); err != nil {
			return err
		}
	}

	return consumer.SenderLoop(ctx, stream.Send)
}
