// Package controller provides a framework for managing entity-driven connectors.
//
// It uses the engine's WatchEntities RPC to watch a specific entity by ID,
// starting the run function when the entity appears and restarting it when
// the entity's Config changes.
package controller

import (
	"context"
	"log/slog"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// RunFunc is called for each entity that has Config on this controller.
// It should block until done or ctx is cancelled.
// On error, the framework retries with backoff.
// The function must call ready() once it has validated the configuration
// and is operational. If it returns an error without calling ready(),
// the error is treated as a configuration validation failure.
//
// Returning nil without calling ready() signals that the configuration
// was accepted but the controller is intentionally idle. The framework
// sets the entity to Inactive and waits for the next config change.
type RunFunc func(ctx context.Context, entity *pb.Entity, ready func()) error

// Option configures optional behavior for Run.
type Option func(*runConfig)

type runConfig struct {
	entity   *pb.Entity
	onUpdate func(*pb.Entity)
}

// WithEntity provides the entity template for registration.
// Run will push this entity with a heartbeat TTL and keep it alive.
// If the controller crashes, the entity expires automatically.
func WithEntity(e *pb.Entity) Option {
	return func(c *runConfig) {
		c.entity = e
	}
}

// WithOnUpdate registers a callback that is invoked for every entity update
// that does not change Config (i.e. non-restart updates). This allows the
// running function to react to component changes like PTZ commands.
// The callback is only called while the run function is active.
func WithOnUpdate(fn func(*pb.Entity)) Option {
	return func(c *runConfig) {
		c.onUpdate = fn
	}
}

// Run watches a single entity by ID using WatchEntities and runs the
// provided function when the entity has a Config. If the Config changes,
// the running function is cancelled and restarted.
//
// Use WithEntity to provide the entity template. Run will push it with
// a heartbeat TTL and keep it alive automatically.
func Run(ctx context.Context, entityID string, run RunFunc, opts ...Option) error {
	var cfg runConfig
	for _, o := range opts {
		o(&cfg)
	}

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	// If an entity template was provided, register it.
	if cfg.entity != nil {
		cfg.entity.Id = entityID
		_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{cfg.entity},
		})
	}

	stream, err := goclient.WatchEntitiesWithRetry(ctx, worldClient, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id: &entityID,
		},
	})
	if err != nil {
		return err
	}

	pushConfigurableState := func(current *pb.Entity, state pb.ConfigurableState, errMsg string, applied bool) {
		var cfgComp *pb.ConfigurableComponent
		if current.Configurable != nil {
			cfgComp = proto.Clone(current.Configurable).(*pb.ConfigurableComponent)
		} else {
			cfgComp = &pb.ConfigurableComponent{}
		}
		cfgComp.State = state
		if errMsg != "" {
			cfgComp.Error = proto.String(errMsg)
		} else {
			cfgComp.Error = nil
		}
		if applied && current.Config != nil {
			cfgComp.AppliedVersion = current.Config.Version
		}
		_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id:           entityID,
				Configurable: cfgComp,
			}},
		})
	}

	var cancel context.CancelFunc
	var currentEntity *pb.Entity
	entityExpired := false

	stopRunning := func() {
		if cancel != nil {
			cancel()
			cancel = nil
			if !entityExpired {
				pushConfigurableState(currentEntity, pb.ConfigurableState_ConfigurableStateInactive, "", false)
			}
			currentEntity = nil
		}
	}

	startRunning := func(e *pb.Entity) {
		var connCtx context.Context
		connCtx, cancel = context.WithCancel(ctx)
		currentEntity = e

		go func() {
			for {
				if connCtx.Err() != nil {
					return
				}

				pushConfigurableState(e, pb.ConfigurableState_ConfigurableStateStarting, "", false)

				readyCalled := false
				ready := func() {
					if !readyCalled {
						readyCalled = true
						pushConfigurableState(e, pb.ConfigurableState_ConfigurableStateActive, "", true)
					}
				}

				err := run(connCtx, e, ready)
				if connCtx.Err() != nil {
					return
				}

				// Returning nil without calling ready() means the config
				// was accepted but the controller is intentionally idle.
				if !readyCalled && err == nil {
					pushConfigurableState(e, pb.ConfigurableState_ConfigurableStateInactive, "", true)
					<-connCtx.Done()
					return
				}

				errMsg := ""
				if err != nil {
					errMsg = err.Error()
					slog.Error("connector error, restarting", "entity", entityID, "error", err)
				}

				pushConfigurableState(e, pb.ConfigurableState_ConfigurableStateFailed, errMsg, true)

				select {
				case <-connCtx.Done():
					return
				case <-time.After(5 * time.Second):
				}
			}
		}()
	}

	defer stopRunning()

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
				stopRunning()
				continue
			}
			if currentEntity != nil && proto.Equal(currentEntity.Config, e.Config) {
				if cfg.onUpdate != nil && cancel != nil {
					cfg.onUpdate(e)
				}
				continue
			}
			stopRunning()
			startRunning(e)

		case pb.EntityChange_EntityChangeExpired, pb.EntityChange_EntityChangeUnobserved:
			entityExpired = true
			stopRunning()
		}
	}
}

// Push pushes one or more entities to the world service.
func Push(ctx context.Context, entities ...*pb.Entity) error {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)
	_, err = client.Push(ctx, &pb.EntityChangeRequest{
		Changes: entities,
	})
	return err
}
