package sdk

import (
	"context"
	"io"
	"log/slog"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// WatchEntitiesWithRetry is WatchEntities that reconnects, with backoff, when
// the stream fails with a transient error. EOF, a permanent error and the end
// of ctx are returned as they are.
func WatchEntitiesWithRetry(ctx context.Context, world pb.WorldServiceClient, req *pb.ListEntitiesRequest) (pb.WorldService_WatchEntitiesClient, error) {
	stream, err := world.WatchEntities(ctx, req)
	if err != nil {
		return nil, err
	}
	return &retryStream{WorldService_WatchEntitiesClient: stream, ctx: ctx, world: world, req: req}, nil
}

type retryStream struct {
	pb.WorldService_WatchEntitiesClient
	ctx   context.Context
	world pb.WorldServiceClient
	req   *pb.ListEntitiesRequest
}

func (r *retryStream) Context() context.Context { return r.ctx }

func (r *retryStream) Recv() (*pb.EntityChangeEvent, error) {
	for {
		msg, err := r.WorldService_WatchEntitiesClient.Recv()
		if err == nil {
			return msg, nil
		}
		if err == io.EOF || !transient(err) {
			return nil, err
		}
		if r.ctx.Err() != nil {
			return nil, r.ctx.Err()
		}
		wait := time.Second
		for attempt := 1; ; attempt++ {
			select {
			case <-time.After(wait):
			case <-r.ctx.Done():
				return nil, r.ctx.Err()
			}
			stream, err := r.world.WatchEntities(r.ctx, r.req)
			if err != nil {
				slog.Warn("reconnecting to hydris", "error", err, "attempt", attempt)
				wait = min(wait*2, 30*time.Second)
				continue
			}
			r.WorldService_WatchEntitiesClient = stream
			break
		}
	}
}

func transient(err error) bool {
	switch status.Code(err) {
	case codes.Unavailable, codes.ResourceExhausted, codes.Aborted, codes.Internal, codes.Unknown:
		return true
	}
	return false
}
