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
	"google.golang.org/protobuf/proto"
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
			"target": map[string]any{
				"type":           "string",
				"title":          "Target",
				"description":    "Remote server address to push entities to",
				"ui:placeholder": "e.g. 10.0.0.2:9090",
				"ui:order":       0,
			},
			"filter": map[string]any{
				"type":        "object",
				"title":       "Filter",
				"description": "Entity filter to select which entities to push",
				"ui:order":    1,
			},
			"limiter": map[string]any{
				"type":        "object",
				"title":       "Rate Limiter",
				"description": "Watch behavior / rate limiter",
				"ui:order":    2,
			},
			"wireguard": map[string]any{
				"type":        "object",
				"title":       "WireGuard",
				"description": "Inline WireGuard tunnel config",
				"ui:order":    3,
			},
		},
		"required": []any{"target"},
	})
	pullSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"source": map[string]any{
				"type":           "string",
				"title":          "Source",
				"description":    "Remote server address to pull entities from",
				"ui:placeholder": "e.g. 10.0.0.2:9090",
				"ui:order":       0,
			},
			"filter": map[string]any{
				"type":        "object",
				"title":       "Filter",
				"description": "Entity filter to select which entities to pull",
				"ui:order":    1,
			},
			"limiter": map[string]any{
				"type":        "object",
				"title":       "Rate Limiter",
				"description": "Watch behavior / rate limiter",
				"ui:order":    2,
			},
			"wireguard": map[string]any{
				"type":        "object",
				"title":       "WireGuard",
				"description": "Inline WireGuard tunnel config",
				"ui:order":    3,
			},
		},
		"required": []any{"source"},
	})

	serviceID := controllerName + ".service"

	if err := controller.Push(ctx, &pb.Entity{
		Id:    serviceID,
		Label: proto.String("Federation"),
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
		},
		Configurable: &pb.ConfigurableComponent{
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{Class: "push", Label: "Push"},
				{Class: "pull", Label: "Pull"},
			},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("network"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "push", Label: "Push", Schema: pushSchema},
		{Class: "pull", Label: "Pull", Schema: pullSchema},
	}

	return controller.WatchChildren(ctx, serviceID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			ready()
			switch entity.Device.GetClass() {
			case "push":
				return runInstance(ctx, globalLogger, globalServerURL, entity, "push")
			case "pull":
				return runInstance(ctx, globalLogger, globalServerURL, entity, "pull")
			}
			return fmt.Errorf("unknown device class: %s", entity.Device.GetClass())
		})
	})
}

func runInstance(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity, mode string) error {
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return fmt.Errorf("federation entity %s has no config", entity.Id)
	}

	fields := entity.Config.Value.Fields

	// Parse configuration
	remote := ""
	var filter *pb.EntityFilter
	var limiter *pb.WatchBehavior
	var wgConfig *goclient.WireGuardConfig

	// Remote target/source
	if v, ok := fields["target"]; ok {
		remote = v.GetStringValue()
	}
	if v, ok := fields["source"]; ok {
		remote = v.GetStringValue()
	}

	// Parse filter
	if v, ok := fields["filter"]; ok {
		filter = parseEntityFilter(v)
	}

	// Parse limiter
	if v, ok := fields["limiter"]; ok {
		limiter = parseWatchLimiter(v)
	}

	// Parse inline WireGuard config
	if v, ok := fields["wireguard"]; ok {
		wgConfig = parseWireGuardConfig(v)
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

// filterForFederation checks whether an entity is eligible for federation and
// scrubs fields that must never be distributed. It returns false if the entity
// should be skipped entirely. skipNodeID is the node whose entities we want to
// exclude (to avoid echoing back).
func filterForFederation(entity *pb.Entity, skipNodeID string) bool {
	if entity == nil {
		return false
	}

	// Only federate entities with a lifetime.until
	// We may miss the delete event and persist something forever
	// config entities need a different way of sharing that relies on consensus
	if entity.Lifetime == nil || entity.Lifetime.Until == nil {
		return false
	}

	if entity.Config != nil {
		return false
	}

	// Skip entities that originated from the given node
	if entity.Controller != nil && entity.Controller.Node != nil && *entity.Controller.Node == skipNodeID {
		return false
	}

	// Scrub fields that must never be distributed
	entity.Lease = nil

	return true
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

	var entitiesReceived, entitiesPushed uint64

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		event, err := stream.Recv()
		if err != nil {
			return err
		}

		entitiesReceived++

		if !filterForFederation(event.Entity, localNodeID) {
			continue
		}

		_, err = localClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{event.Entity},
		})
		if err != nil {
			i.logger.Error("failed to push to local", "entityID", i.entityID, "targetEntity", event.Entity.Id, "error", err)
			continue
		}

		entitiesPushed++
		_, _ = localClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: i.entityID,
				Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
					{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("entities received"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: entitiesReceived}},
					{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("entities pushed"), Id: proto.Uint32(2), Val: &pb.Metric_Uint64{Uint64: entitiesPushed}},
				}},
			}},
		})

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

	var entitiesReceived, entitiesPushed uint64

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		event, err := stream.Recv()
		if err != nil {
			return err
		}

		entitiesReceived++

		if !filterForFederation(event.Entity, remoteNodeID) {
			continue
		}

		_, err = remoteClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{event.Entity},
		})
		if err != nil {
			i.logger.Error("failed to push", "entityID", i.entityID, "targetEntity", event.Entity.Id, "error", err)
			continue
		}

		entitiesPushed++
		_, _ = localClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: i.entityID,
				Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
					{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("entities received"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: entitiesReceived}},
					{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("entities pushed"), Id: proto.Uint32(2), Val: &pb.Metric_Uint64{Uint64: entitiesPushed}},
				}},
			}},
		})

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
		if configFilter.GetStructValue() != nil {
			filter.Config = &pb.ConfigurationFilter{}
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
