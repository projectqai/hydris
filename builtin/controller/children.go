package controller

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// DeviceClass describes one type of child device that a service supports.
type DeviceClass struct {
	Class  string
	Label  string
	Schema *structpb.Struct
}

// ChildHandler is called per child device. It should block until done or ctx cancelled.
type ChildHandler func(ctx context.Context, entityID string) error

// WatchChildren watches for device entities parented to serviceEntityID.
// When a child with a recognized device_class appears, it pushes
// ConfigurableComponent (schema for that class) + Controller onto it
// and starts handler(ctx, entityID) in a goroutine.
// When the child expires or is unobserved, the handler's context is cancelled.
func WatchChildren(ctx context.Context, serviceEntityID, controllerName string, classes []DeviceClass, handler ChildHandler) error {
	classMap := make(map[string]DeviceClass, len(classes))
	for _, c := range classes {
		classMap[c.Class] = c
	}

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	localNodeResp, err := worldClient.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return fmt.Errorf("get local node: %w", err)
	}
	localNodeID := localNodeResp.Entity.Controller.GetNode()

	stream, err := goclient.WatchEntitiesWithRetry(ctx, worldClient, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentDevice)},
			Device: &pb.DeviceFilter{
				Parent: &serviceEntityID,
			},
		},
	})
	if err != nil {
		return err
	}

	var mu sync.Mutex
	children := make(map[string]context.CancelFunc)

	defer func() {
		mu.Lock()
		for _, cancel := range children {
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

		entityID := event.Entity.Id

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			mu.Lock()
			_, running := children[entityID]
			mu.Unlock()
			if running {
				continue
			}

			// Skip entities owned by a different node (e.g. federated in).
			if n := event.Entity.Controller.GetNode(); n != "" && n != localNodeID {
				continue
			}

			deviceClass := event.Entity.Device.GetClass()
			class, ok := classMap[deviceClass]
			if !ok {
				continue
			}

			// Push ConfigurableComponent + Controller onto the child entity.
			_, pushErr := worldClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{{
					Id: entityID,
					Controller: &pb.Controller{
						Id: &controllerName,
					},
					Configurable: &pb.ConfigurableComponent{
						Schema: class.Schema,
						Label:  proto.String(class.Label),
					},
				}},
			})
			if pushErr != nil {
				slog.Error("WatchChildren: push configurable", "entity", entityID, "error", pushErr)
				continue
			}

			childCtx, cancel := context.WithCancel(ctx)
			mu.Lock()
			children[entityID] = cancel
			mu.Unlock()

			go func() {
				err := handler(childCtx, entityID)
				if err != nil && childCtx.Err() == nil {
					slog.Error("WatchChildren: handler error", "entity", entityID, "error", err)
				}
				mu.Lock()
				delete(children, entityID)
				mu.Unlock()
			}()

		case pb.EntityChange_EntityChangeExpired, pb.EntityChange_EntityChangeUnobserved:
			mu.Lock()
			if cancel, ok := children[entityID]; ok {
				cancel()
				delete(children, entityID)
			}
			mu.Unlock()
		}
	}
}
