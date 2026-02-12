package policy

import (
	"context"
	"errors"
	"log/slog"
	"net"

	"connectrpc.com/connect"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

type Ability struct {
	engine   *Engine
	sourceIP string
	builtin  bool
}

// Creates an Ability bound to a remote identity, like source ip for now
func For(engine *Engine, remoteAddr string) *Ability {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	return &Ability{
		engine:   engine,
		sourceIP: host,
		builtin:  remoteAddr == "bufconn",
	}
}

func (a *Ability) CanRead(ctx context.Context, entity *pb.Entity) bool {
	return a.can(ctx, "read", entity)
}

func (a *Ability) AuthorizeWrite(ctx context.Context, entity *pb.Entity) error {
	if a.can(ctx, "write", entity) {
		return nil
	}
	return connect.NewError(connect.CodePermissionDenied,
		errors.New("policy denied write of "+entity.Id))
}

func (a *Ability) AuthorizeTimeline(ctx context.Context) error {
	if a.can(ctx, "timeline", nil) {
		return nil
	}
	return connect.NewError(connect.CodePermissionDenied,
		errors.New("policy denied timeline access"))
}

func (a *Ability) can(ctx context.Context, action string, entity *pb.Entity) bool {
	if a.engine == nil || a.builtin {
		return true
	}

	input := &Input{
		Action:     action,
		Connection: Connection{SourceIP: a.sourceIP},
	}
	if entity != nil {
		input.Entity = Entity{
			ID:         entity.Id,
			Components: presentFields(entity),
		}
	}

	allowed, err := a.engine.Evaluate(ctx, input)
	if err != nil {
		slog.Warn("policy evaluation error", "error", err, "action", action)
		return false
	}
	return allowed
}

func presentFields(msg proto.Message) []int {
	var fields []int
	ref := msg.ProtoReflect()
	ref.Range(func(fd protoreflect.FieldDescriptor, _ protoreflect.Value) bool {
		fields = append(fields, int(fd.Number()))
		return true
	})
	return fields
}
