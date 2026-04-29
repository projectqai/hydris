package federation

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"net/url"
	"os"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
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

const defaultFederationKeepaliveMs = 30000 // 30s

// ensureKeepalive makes sure the WatchBehavior has a keepalive interval set.
// Federation relies on keepalive to refresh the TTL of forwarded entities, so
// we always need one even if the user didn't configure it.
func (i *Instance) ensureKeepalive() {
	if i.limiter == nil {
		i.limiter = &pb.WatchBehavior{}
	}
	if i.limiter.KeepaliveIntervalMs == nil || *i.limiter.KeepaliveIntervalMs == 0 {
		ms := uint32(defaultFederationKeepaliveMs)
		i.limiter.KeepaliveIntervalMs = &ms
	}
}

// keepaliveTTL returns the TTL to stamp on forwarded entities that have no
// explicit lifetime.until. It is 2× the keepalive interval so that the entity
// survives one missed keepalive but expires when the connection is truly dead.
func (i *Instance) keepaliveTTL() time.Duration {
	return 2 * time.Duration(*i.limiter.KeepaliveIntervalMs) * time.Millisecond
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

// discoverNode queries a world service for the local node and returns its
// unique_id and entity.
func discoverNode(ctx context.Context, client pb.WorldServiceClient) (string, *pb.Entity, error) {
	resp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return "", nil, fmt.Errorf("get local node: %w", err)
	}
	if resp.Entity == nil || resp.Entity.Controller == nil || resp.Entity.Controller.Node == nil {
		return "", nil, fmt.Errorf("local node has no controller.node")
	}
	return *resp.Entity.Controller.Node, resp.Entity, nil
}

// federateNodeEntity pushes a scrubbed copy of a node entity to a destination.
// This lets the receiving side know who a sender ID refers to.
func federateNodeEntity(ctx context.Context, dst pb.WorldServiceClient, node *pb.Entity, keepaliveTTL time.Duration, clockOffset time.Duration) {
	e := proto.Clone(node).(*pb.Entity)
	e.Lease = nil
	e.Config = nil
	e.Configurable = nil
	now := timestamppb.Now()
	e.Lifetime = &pb.Lifetime{
		From:  now,
		Fresh: now,
		Until: timestamppb.New(now.AsTime().Add(keepaliveTTL)),
	}
	shiftEntityTimestamps(e, clockOffset)
	_, _ = dst.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{e},
	})
}

// filterForFederation prepares an entity for federation. It returns false if
// the entity should be skipped entirely (no Routing, missing Controller).
//
// All entities with Routing are forwarded — there is no node-based reject.
// This enables star topology (a hub redistributes entities from all spokes)
// and multi-hop relay (A→B→C without explicit configuration).
//
// Fresh bumping rule — only the origin bumps:
//
// Lifetime.Fresh is bumped ONLY when the entity originates from the source
// node of this hop (entity.Controller.Node == sourceNodeID). Relayed
// entities (from a third node) preserve their original Fresh. This single
// rule prevents federation loops in any topology:
//
//   - Push direction: sourceNodeID = localNodeID. The pushing node bumps
//     fresh for its own entities. Entities it received via federation from
//     other nodes are relayed with preserved fresh.
//
//   - Pull direction: sourceNodeID = remoteNodeID. The pulling node bumps
//     fresh for the remote's own entities. Entities the remote is relaying
//     from third nodes are pulled with preserved fresh.
//
// Why this prevents loops (A→B→C→B, entity node=A):
//
//  1. A pushes to B: node=A == A (origin) → bump fresh to T2. B has T2.
//  2. B pushes to C: node=A ≠ B (relay) → preserve fresh T2. C has T2.
//  3. B pulls from C: node=A ≠ C (relay) → preserve fresh T2.
//     B already has T2 → LWW rejects (identical fresh+until). No loop.
//
// Why star topology works (Spoke A → Hub → Spoke B):
//
//  1. Spoke A pushes to Hub: origin → bump fresh T2.
//  2. Spoke B pulls from Hub: node=A ≠ Hub (relay) → preserve fresh T2.
//     B gets A's entity.
//  3. Keepalive: A pushes again → bump fresh T3. B pulls → T3 > T2 →
//     accepted. Entity stays alive.
//
// Formally verified: see ha_sync.qnt (Quint) and ha_sync.als (Alloy).
func filterForFederation(entity *pb.Entity, sourceNodeID string, keepaliveTTL time.Duration) bool {
	if entity == nil {
		return false
	}

	// Only entities with Routing are shareable. Entities without it
	// (services, device configs, infrastructure) stay local.
	if entity.Routing == nil {
		return false
	}

	if entity.Controller == nil || entity.Controller.Node == nil {
		return false
	}

	// Determine if the source node of this hop is the entity's origin.
	// Only the origin bumps fresh — relays preserve it to prevent loops.
	isOrigin := *entity.Controller.Node == sourceNodeID

	if entity.Lifetime == nil {
		entity.Lifetime = &pb.Lifetime{}
	}
	now := timestamppb.Now()
	keepaliveUntil := now.AsTime().Add(keepaliveTTL)
	// Stamp the keepalive-based TTL, unless the entity already has a
	// shorter lifetime.until (we don't want to extend entities that are
	// about to expire). Only bump Fresh when we are the origin — relayed
	// entities keep their original Fresh so that LWW dedup stops loops.
	if entity.Lifetime.Until == nil || entity.Lifetime.Until.AsTime().After(keepaliveUntil) {
		if isOrigin {
			entity.Lifetime.Fresh = now
		}
		entity.Lifetime.Until = timestamppb.New(keepaliveUntil)
	}

	// Scrub fields that must never be distributed.
	entity.Lease = nil
	entity.Config = nil

	// Strip engine-managed GeoShapeComponent when LocalShapeComponent has
	// relative_to set. The receiving engine will recompute GeoShapeComponent
	// from LocalShapeComponent + the parent entity's position.
	if entity.LocalShape != nil && entity.LocalShape.RelativeTo != "" {
		entity.Shape = nil
	}

	return true
}

// runPull connects to a remote node and pulls their entities to local.
func (i *Instance) runPull(ctx context.Context) error {
	i.ensureKeepalive()

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

	// Discover remote node_id — we only pull entities that originated there
	// (no multi-hop: skip anything the remote itself received via federation).
	remoteNodeID, remoteNodeEntity, err := discoverNode(ctx, remoteClient)
	if err != nil {
		return fmt.Errorf("discover remote node ID: %w", err)
	}
	i.logger.Info("pull: discovered remote node", "nodeID", remoteNodeID)

	clockOffset := estimateClockOffset(ctx, remoteClient)
	if clockOffset != 0 {
		i.logger.Info("pull: clock offset estimated", "offset", clockOffset)
	}

	// Push the remote node entity to local so receivers can resolve the sender.
	// No clock offset: the node entity lifetime is stamped with local now.
	federateNodeEntity(ctx, localClient, remoteNodeEntity, i.keepaliveTTL(), 0)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, remoteClient, &pb.ListEntitiesRequest{
		Filter:    i.filter,
		Behaviour: i.limiter,
	})
	if err != nil {
		return err
	}

	i.logger.Info("pull started", "entityID", i.entityID)

	keepaliveTTL := i.keepaliveTTL()

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

		// Translate timestamps from remote clock domain to local.
		shiftEntityTimestamps(event.Entity, -clockOffset)

		if !filterForFederation(event.Entity, remoteNodeID, keepaliveTTL) {
			continue
		}

		// Rewrite private camera URLs to point to the remote's media proxy.
		if event.Entity.Camera != nil {
			rewriteCameraURLs(event.Entity, "http://"+i.remote)
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
	i.ensureKeepalive()

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

	// Discover local node_id — we only push entities that originated here
	// (no multi-hop: skip anything we received via federation from other nodes).
	localNodeID, localNodeEntity, err := discoverNode(ctx, localClient)
	if err != nil {
		return fmt.Errorf("discover local node ID: %w", err)
	}
	i.logger.Info("push: discovered local node", "nodeID", localNodeID)

	clockOffset := estimateClockOffset(ctx, remoteClient)
	if clockOffset != 0 {
		i.logger.Info("push: clock offset estimated", "offset", clockOffset)
	}

	// Push the local node entity to remote so receivers can resolve the sender.
	federateNodeEntity(ctx, remoteClient, localNodeEntity, i.keepaliveTTL(), clockOffset)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, localClient, &pb.ListEntitiesRequest{
		Filter:    i.filter,
		Behaviour: i.limiter,
	})
	if err != nil {
		return err
	}

	i.logger.Info("push started", "entityID", i.entityID)

	keepaliveTTL := i.keepaliveTTL()

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

		if !filterForFederation(event.Entity, localNodeID, keepaliveTTL) {
			continue
		}

		// Rewrite private camera URLs to point to our media proxy.
		if event.Entity.Camera != nil {
			origin := detectOrigin(i.remote)
			rewriteCameraURLs(event.Entity, origin)
		}

		// Translate timestamps from local clock domain to remote.
		shiftEntityTimestamps(event.Entity, clockOffset)

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

// rewriteCameraURLs rewrites private/localhost/credentialed camera stream
// URLs to use the origin node's media proxy endpoints. This ensures that
// federated entities carry publicly-reachable URLs.
func rewriteCameraURLs(entity *pb.Entity, origin string) {
	if entity.Camera == nil || origin == "" {
		return
	}
	for idx, stream := range entity.Camera.Streams {
		if stream.Url == "" {
			continue
		}
		u, err := url.Parse(stream.Url)
		if err != nil {
			continue
		}
		// Only rewrite URLs that point to localhost/loopback or carry
		// credentials. Other addresses (including RFC1918) are assumed to
		// be already network-reachable and must not be changed — otherwise
		// multi-hop federation would clobber valid proxy URLs.
		if u.User == nil && !isLoopback(u.Hostname()) {
			continue
		}
		switch stream.Protocol {
		case pb.MediaStreamProtocol_MediaStreamProtocolImage,
			pb.MediaStreamProtocol_MediaStreamProtocolMjpeg:
			stream.Url = fmt.Sprintf("%s/media/image/%s?stream=%d", origin, entity.Id, idx)
		case pb.MediaStreamProtocol_MediaStreamProtocolWebrtc:
			stream.Url = fmt.Sprintf("%s/media/whep/%s?stream=%d", origin, entity.Id, idx)
		case pb.MediaStreamProtocol_MediaStreamProtocolRtsp:
			stream.Url = fmt.Sprintf("%s/media/whep/%s?stream=%d", origin, entity.Id, idx)
			stream.Protocol = pb.MediaStreamProtocol_MediaStreamProtocolWebrtc
		default:
			stream.Url = fmt.Sprintf("%s/media/image/%s?stream=%d", origin, entity.Id, idx)
		}
	}
}

// isLoopback returns true if the hostname is localhost or a loopback address.
func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// detectOrigin determines the externally-reachable address of this node
// relative to the given remote address. It dials UDP to discover which
// local interface would be used to reach the remote, then combines that
// IP with the engine's HTTP port.
func detectOrigin(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	// Dial UDP (no actual packets sent) to discover the source interface.
	conn, err := net.Dial("udp", net.JoinHostPort(host, "80"))
	if err != nil {
		return ""
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)
	port := os.Getenv("PORT")
	if port == "" {
		port = "50051"
	}
	return "http://" + net.JoinHostPort(localAddr.IP.String(), port)
}

func init() {
	builtin.Register("federation", Run)
}
