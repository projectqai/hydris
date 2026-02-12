package federation

import (
	"context"
	"fmt"
	"log/slog"
	"net/netip"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/structpb"
)

// Instance represents a running federation connection
type Instance struct {
	entityID  string
	serverURL string
	remote    string
	mode      string // "push" or "pull"
	filter    *pb.EntityFilter
	limiter   *pb.WatchBehavior
	logger    *slog.Logger
	wgConfig  *goclient.WireGuardConfig // optional WireGuard config
}

var (
	globalLogger    *slog.Logger
	globalServerURL string
)

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	globalLogger = logger
	globalServerURL = serverURL
	controllerName := "federation"

	pushSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"target":    map[string]any{"type": "string", "description": "Remote server address"},
			"filter":    map[string]any{"type": "object", "description": "Entity filter"},
			"limiter":   map[string]any{"type": "object", "description": "Watch behavior / rate limiter"},
			"wireguard": map[string]any{"type": "object", "description": "Inline WireGuard config"},
		},
		"required": []any{"target"},
	})
	pullSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"source":    map[string]any{"type": "string", "description": "Remote server address"},
			"filter":    map[string]any{"type": "object", "description": "Entity filter"},
			"limiter":   map[string]any{"type": "object", "description": "Watch behavior / rate limiter"},
			"wireguard": map[string]any{"type": "object", "description": "Inline WireGuard config"},
		},
		"required": []any{"source"},
	})

	if err := controller.PublishDevice(ctx, controllerName+".service", controllerName, []*pb.Configurable{
		{Key: "federation.push.v0", Schema: pushSchema},
		{Key: "federation.pull.v0", Schema: pullSchema},
	}, nil, nil); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	return controller.Run1to1(ctx, controllerName, func(ctx context.Context, config *pb.Entity, _ *pb.Entity) error {
		return runInstance(ctx, globalLogger, globalServerURL, config)
	})
}

func runInstance(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	config := entity.Config
	if config == nil {
		return fmt.Errorf("federation entity %s has no config", entity.Id)
	}

	var mode string
	switch config.Key {
	case "federation.push.v0":
		mode = "push"
	case "federation.pull.v0":
		mode = "pull"
	default:
		return fmt.Errorf("unknown federation config key: %s", config.Key)
	}

	// Parse configuration
	remote := ""
	var filter *pb.EntityFilter
	var limiter *pb.WatchBehavior
	var wgConfig *goclient.WireGuardConfig

	if config.Value != nil && config.Value.Fields != nil {
		// Remote target/source
		if v, ok := config.Value.Fields["target"]; ok {
			remote = v.GetStringValue()
		}
		if v, ok := config.Value.Fields["source"]; ok {
			remote = v.GetStringValue()
		}

		// Parse filter
		if v, ok := config.Value.Fields["filter"]; ok {
			filter = parseEntityFilter(v)
		}

		// Parse limiter
		if v, ok := config.Value.Fields["limiter"]; ok {
			limiter = parseWatchLimiter(v)
		}

		// Parse inline WireGuard config
		if v, ok := config.Value.Fields["wireguard"]; ok {
			wgConfig = parseWireGuardConfig(v)
		}

	}

	if remote == "" {
		return fmt.Errorf("federation config missing target/source")
	}

	instance := &Instance{
		entityID:  entity.Id,
		serverURL: serverURL,
		remote:    remote,
		mode:      mode,
		filter:    filter,
		limiter:   limiter,
		logger:    logger,
		wgConfig:  wgConfig,
	}

	if wgConfig != nil {
		logger.Info("starting federation with WireGuard", "entityID", entity.Id, "mode", mode, "remote", remote)
	} else {
		logger.Info("starting federation", "entityID", entity.Id, "mode", mode, "remote", remote)
	}

	if mode == "push" {
		return instance.runPush(ctx)
	}
	return instance.runPull(ctx)
}

// connectToRemote establishes a connection to the remote server
func (i *Instance) connectToRemote() (*goclient.Connection, error) {
	if i.wgConfig != nil {
		conn, tunnel, err := goclient.ConnectViaWireGuard(i.remote, i.wgConfig)
		if err != nil {
			return nil, err
		}
		return &goclient.Connection{ClientConn: conn, Tunnel: tunnel}, nil
	}
	return goclient.Connect(i.remote)
}

// discoverNodeID queries a world service for the local node and returns its unique_id.
func discoverNodeID(ctx context.Context, client pb.WorldServiceClient) (string, error) {
	resp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return "", fmt.Errorf("get local node: %w", err)
	}
	if resp.Entity == nil || resp.Entity.Controller == nil || resp.Entity.Controller.Node == nil {
		return "", fmt.Errorf("local node has no controller.node")
	}
	return *resp.Entity.Controller.Node, nil
}

// runPull connects to a remote node and pulls their entities to local.
func (i *Instance) runPull(ctx context.Context) error {
	localConn, err := goclient.Connect(i.serverURL)
	if err != nil {
		return err
	}
	defer func() { _ = localConn.Close() }()

	remoteConn, err := i.connectToRemote()
	if err != nil {
		return err
	}
	defer func() { _ = remoteConn.Close() }()

	localClient := pb.NewWorldServiceClient(localConn)
	remoteClient := pb.NewWorldServiceClient(remoteConn)

	// Discover local node_id so we don't pull back entities that originated here
	localNodeID, err := discoverNodeID(ctx, localClient)
	if err != nil {
		return fmt.Errorf("discover local node ID: %w", err)
	}
	i.logger.Info("pull: discovered local node", "nodeID", localNodeID)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, remoteClient, &pb.ListEntitiesRequest{
		Filter:    i.filter,
		Behaviour: i.limiter,
	})
	if err != nil {
		return err
	}

	i.logger.Info("pull started", "entityID", i.entityID)

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil {
			continue
		}

		// Only federate entities with a lifetime.until
		// We may miss the delete event and persist something forever
		// config entities need a different way of sharing that relies on consensus
		if event.Entity.Lifetime == nil || event.Entity.Lifetime.Until == nil {
			continue
		}

		if event.Entity.Config != nil {
			continue
		}

		// Skip entities that originated from us
		if event.Entity.Controller != nil && event.Entity.Controller.Node != nil && *event.Entity.Controller.Node == localNodeID {
			continue
		}

		_, err = localClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{event.Entity},
		})
		if err != nil {
			i.logger.Error("failed to push to local", "entityID", i.entityID, "targetEntity", event.Entity.Id, "error", err)
			continue
		}

		i.logger.Debug("pulled", "entityID", i.entityID, "targetEntity", event.Entity.Id)
	}
}

// runPush watches local entities and pushes them to a remote node.
func (i *Instance) runPush(ctx context.Context) error {
	localConn, err := goclient.Connect(i.serverURL)
	if err != nil {
		return err
	}
	defer func() { _ = localConn.Close() }()

	remoteConn, err := i.connectToRemote()
	if err != nil {
		return err
	}
	defer func() { _ = remoteConn.Close() }()

	localClient := pb.NewWorldServiceClient(localConn)
	remoteClient := pb.NewWorldServiceClient(remoteConn)

	// Discover remote node_id so we don't push back entities that originated there
	remoteNodeID, err := discoverNodeID(ctx, remoteClient)
	if err != nil {
		return fmt.Errorf("discover remote node ID: %w", err)
	}
	i.logger.Info("push: discovered remote node", "nodeID", remoteNodeID)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, localClient, &pb.ListEntitiesRequest{
		Filter:    i.filter,
		Behaviour: i.limiter,
	})
	if err != nil {
		return err
	}

	i.logger.Info("push started", "entityID", i.entityID)

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil {
			continue
		}

		// Only federate entities with a lifetime.until
		// We may miss the delete event and persist something forever
		// config entities need a different way of sharing that relies on consensus
		if event.Entity.Lifetime == nil || event.Entity.Lifetime.Until == nil {
			continue
		}

		if event.Entity.Config != nil {
			continue
		}

		// Skip entities that originated from the remote node
		if event.Entity.Controller != nil && event.Entity.Controller.Node != nil && *event.Entity.Controller.Node == remoteNodeID {
			continue
		}

		_, err = remoteClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{event.Entity},
		})
		if err != nil {
			i.logger.Error("failed to push", "entityID", i.entityID, "targetEntity", event.Entity.Id, "error", err)
			continue
		}

		i.logger.Debug("pushed", "entityID", i.entityID, "targetEntity", event.Entity.Id)
	}
}

// parseWireGuardConfig parses inline WireGuard config from structpb.Value
func parseWireGuardConfig(v *structpb.Value) *goclient.WireGuardConfig {
	if v == nil {
		return nil
	}

	s := v.GetStructValue()
	if s == nil {
		return nil
	}

	cfg := &goclient.WireGuardConfig{}

	if pk, ok := s.Fields["private_key"]; ok {
		cfg.PrivateKey = pk.GetStringValue()
	}
	if pk, ok := s.Fields["peer_public_key"]; ok {
		cfg.PeerPublicKey = pk.GetStringValue()
	}
	if ep, ok := s.Fields["endpoint"]; ok {
		cfg.Endpoint = ep.GetStringValue()
	}
	if addr, ok := s.Fields["address"]; ok {
		addrStr := addr.GetStringValue()
		if parsed, err := netip.ParseAddr(addrStr); err == nil {
			cfg.Address = parsed
		}
	}

	// Validate - return nil if missing required fields
	if cfg.PrivateKey == "" || cfg.PeerPublicKey == "" || cfg.Endpoint == "" || !cfg.Address.IsValid() {
		return nil
	}

	return cfg
}

func parseEntityFilter(v *structpb.Value) *pb.EntityFilter {
	if v == nil {
		return nil
	}

	s := v.GetStructValue()
	if s == nil {
		return nil
	}

	filter := &pb.EntityFilter{}

	if id, ok := s.Fields["id"]; ok {
		idStr := id.GetStringValue()
		filter.Id = &idStr
	}

	if label, ok := s.Fields["label"]; ok {
		labelStr := label.GetStringValue()
		filter.Label = &labelStr
	}

	if components, ok := s.Fields["component"]; ok {
		if list := components.GetListValue(); list != nil {
			for _, c := range list.Values {
				filter.Component = append(filter.Component, uint32(c.GetNumberValue()))
			}
		}
	}

	if configFilter, ok := s.Fields["config"]; ok {
		if cs := configFilter.GetStructValue(); cs != nil {
			filter.Config = &pb.ConfigurationFilter{}
			if key, ok := cs.Fields["key"]; ok {
				keyStr := key.GetStringValue()
				filter.Config.Key = &keyStr
			}
		}
	}

	return filter
}

func parseWatchLimiter(v *structpb.Value) *pb.WatchBehavior {
	if v == nil {
		return nil
	}

	s := v.GetStructValue()
	if s == nil {
		return nil
	}

	limiter := &pb.WatchBehavior{}

	if v, ok := s.Fields["max_rate_hz"]; ok {
		val := float32(v.GetNumberValue())
		limiter.MaxRateHz = &val
	}

	if minPri, ok := s.Fields["min_priority"]; ok {
		val := pb.Priority(int32(minPri.GetNumberValue()))
		limiter.MinPriority = &val
	}

	if ka, ok := s.Fields["keepalive_interval_ms"]; ok {
		val := uint32(ka.GetNumberValue())
		limiter.KeepaliveIntervalMs = &val
	}

	return limiter
}

func init() {
	builtin.Register("federation", Run)
}
