package sdk

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// Push writes entities to the world.
func Push(ctx context.Context, entities ...*pb.Entity) error {
	conn, err := Dial()
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	_, err = pb.NewWorldServiceClient(conn).Push(ctx, &pb.EntityChangeRequest{Changes: entities})
	return err
}

// RunFunc runs one configuration of an entity until ctx ends. It calls ready
// once the configuration is valid and it is working; that sets the entity
// Active. An error before ready is a configuration failure. An error is
// retried after a delay, unless it wraps ErrConflict. Returning nil without
// calling ready means the configuration is valid but there is nothing to do:
// the entity goes Inactive until its configuration changes.
type RunFunc func(ctx context.Context, entity *pb.Entity, ready func()) error

// Run watches the entity entityID and runs run while it has a config. A
// config change cancels the run and starts a new one. The entity's
// configurable state shows how the run goes.
func Run(ctx context.Context, entityID string, run RunFunc) error {
	conn, err := Dial()
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	world := pb.NewWorldServiceClient(conn)

	stream, err := WatchEntitiesWithRetry(ctx, world, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{Id: &entityID},
	})
	if err != nil {
		return err
	}

	setState := func(current *pb.Entity, state pb.ConfigurableState, errMsg string, applied bool) {
		if current.Configurable == nil {
			return
		}
		c := proto.Clone(current.Configurable).(*pb.ConfigurableComponent)
		c.State = state
		c.Error = nil
		if errMsg != "" {
			c.Error = proto.String(errMsg)
		}
		if applied && current.Config != nil {
			c.AppliedVersion = current.Config.Version
		}
		_, _ = world.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{{Id: entityID, Configurable: c}}})
	}

	var cancel context.CancelFunc
	var current *pb.Entity
	expired := false

	stop := func() {
		if cancel == nil {
			return
		}
		cancel()
		cancel = nil
		if !expired {
			setState(current, pb.ConfigurableState_ConfigurableStateInactive, "", false)
		}
		current = nil
	}

	start := func(e *pb.Entity) {
		var runCtx context.Context
		runCtx, cancel = context.WithCancel(ctx)
		current = e
		go func() {
			for runCtx.Err() == nil {
				setState(e, pb.ConfigurableState_ConfigurableStateStarting, "", false)
				isReady := false
				ready := func() {
					if !isReady {
						isReady = true
						setState(e, pb.ConfigurableState_ConfigurableStateActive, "", true)
					}
				}
				err := run(runCtx, e, ready)
				switch {
				case runCtx.Err() != nil:
					return
				case err == nil && !isReady:
					setState(e, pb.ConfigurableState_ConfigurableStateInactive, "", true)
					<-runCtx.Done()
					return
				case errors.Is(err, ErrConflict):
					setState(e, pb.ConfigurableState_ConfigurableStateConflict, err.Error(), true)
					<-runCtx.Done()
					return
				}
				msg := ""
				if err != nil {
					msg = err.Error()
					slog.Error("run failed, restarting", "entity", entityID, "error", err)
				}
				setState(e, pb.ConfigurableState_ConfigurableStateFailed, msg, true)
				select {
				case <-runCtx.Done():
					return
				case <-time.After(5 * time.Second):
				}
			}
		}()
	}
	defer stop()

	for {
		event, err := stream.Recv()
		if err != nil {
			return err
		}
		if event.Entity == nil {
			continue
		}
		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			e := event.Entity
			if e.Config == nil {
				stop()
				continue
			}
			if current != nil && proto.Equal(current.Config, e.Config) {
				continue
			}
			stop()
			start(e)
		case pb.EntityChange_EntityChangeExpired, pb.EntityChange_EntityChangeUnobserved:
			expired = true
			stop()
		}
	}
}

// DeviceClass is one kind of child device a service supports, with the
// schema of its config.
type DeviceClass struct {
	Class  string
	Label  string
	Schema *structpb.Struct
}

// ChildHandler runs one child device until ctx ends.
type ChildHandler func(ctx context.Context, entityID string) error

// WatchChildren watches the devices parented to serviceID. For each child of
// a class in classes it sets that class's config schema on the child and
// runs handler; an expired child's handler is cancelled. Children owned by
// another node (federated in) are skipped.
func WatchChildren(ctx context.Context, serviceID string, classes []DeviceClass, handler ChildHandler) error {
	byClass := make(map[string]DeviceClass, len(classes))
	for _, c := range classes {
		byClass[c.Class] = c
	}

	conn, err := Dial()
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	world := pb.NewWorldServiceClient(conn)

	local, err := world.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return fmt.Errorf("get local node: %w", err)
	}
	localNode := local.Entity.Controller.GetNode()

	stream, err := WatchEntitiesWithRetry(ctx, world, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentDevice)},
			Device:    &pb.DeviceFilter{Parent: &serviceID},
		},
	})
	if err != nil {
		return err
	}

	var mu sync.Mutex
	running := map[string]context.CancelFunc{}
	defer func() {
		mu.Lock()
		for _, cancel := range running {
			cancel()
		}
		mu.Unlock()
	}()

	for {
		event, err := stream.Recv()
		if err != nil {
			return err
		}
		if event.Entity == nil {
			continue
		}
		id := event.Entity.Id
		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			mu.Lock()
			_, isRunning := running[id]
			mu.Unlock()
			if isRunning {
				continue
			}
			if n := event.Entity.Controller.GetNode(); n != "" && n != localNode {
				continue
			}
			class, ok := byClass[event.Entity.Device.GetClass()]
			if !ok {
				continue
			}
			c := &pb.ConfigurableComponent{Schema: class.Schema}
			if class.Label != "" {
				c.Label = proto.String(class.Label)
			}
			if _, err := world.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{{Id: id, Configurable: c}}}); err != nil {
				slog.Error("set child schema", "entity", id, "error", err)
				continue
			}
			childCtx, cancel := context.WithCancel(ctx)
			mu.Lock()
			running[id] = cancel
			mu.Unlock()
			go func() {
				if err := handler(childCtx, id); err != nil && childCtx.Err() == nil {
					slog.Error("child failed", "entity", id, "error", err)
				}
				mu.Lock()
				delete(running, id)
				mu.Unlock()
			}()
		case pb.EntityChange_EntityChangeExpired, pb.EntityChange_EntityChangeUnobserved:
			mu.Lock()
			if cancel, ok := running[id]; ok {
				cancel()
				delete(running, id)
			}
			mu.Unlock()
		}
	}
}
