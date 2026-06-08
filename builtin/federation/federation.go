package federation

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	"github.com/projectqai/hydris/pkg/timesync"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Instance struct {
	entityID  string
	serverURL string
	remote    string
	filter    *pb.EntityFilter
	limiter   *pb.WatchBehavior
	logger    *slog.Logger
	wgConfig  *goclient.WireGuardConfig
	sshDest   string

	ts timesync.Tracker
}

var (
	globalLogger    *slog.Logger
	globalServerURL string
)

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	globalLogger = logger
	globalServerURL = serverURL
	controllerName := "federation"

	enabledProp := map[string]any{
		"type":        "boolean",
		"title":       "Enabled",
		"description": "Enable or disable this federation link",
		"default":     true,
		"ui:order":    -1,
	}

	downstreamSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"enabled": enabledProp,
			"source": map[string]any{
				"type":           "string",
				"title":          "Source",
				"description":    "Remote server address to sync with (pull all, push back taskables and changes to pulled entities)",
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
			"ssh": map[string]any{
				"type":        "object",
				"title":       "SSH Tunnel",
				"description": "Inline SSH tunnel config",
				"ui:order":    4,
			},
		},
		"required": []any{"source"},
	})

	serviceID := controllerName + ".service"

	if err := controller.Push(ctx, controllerName, &pb.Entity{
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
				{
					Class:       "downstream",
					Label:       "Downstream",
					Description: "Pull from a remote node and selectively push back local changes. Use this when the remote node owns the data but also you want to control its assets remotely.",
				},
			},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("network"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "downstream", Schema: downstreamSchema},
	}

	go autoDiscoverDownstream(ctx, logger, serviceID, controllerName)

	return controller.WatchChildren(ctx, controllerName, serviceID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, controllerName, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			if entity.Config != nil && entity.Config.Value != nil {
				if v, ok := entity.Config.Value.Fields["enabled"]; ok && !v.GetBoolValue() {
					return nil
				}
			}
			ready()
			if entity.Device.GetClass() != "downstream" {
				return fmt.Errorf("unknown device class: %s", entity.Device.GetClass())
			}
			return runInstance(ctx, globalLogger, globalServerURL, entity)
		})
	})
}

func autoDiscoverDownstream(ctx context.Context, logger *slog.Logger, serviceID, controllerName string) {
	grpcConn, err := builtin.BuiltinClientConn("federation")
	if err != nil {
		logger.Error("auto-discover: connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	localNodeResp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		logger.Error("auto-discover: get local node", "error", err)
		return
	}

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentDevice)},
		},
	})
	if err != nil {
		logger.Error("auto-discover: watch", "error", err)
		return
	}

	for {
		if ctx.Err() != nil {
			return
		}
		event, err := stream.Recv()
		if err != nil {
			logger.Error("auto-discover: recv", "error", err)
			return
		}
		if event.Entity == nil || event.Entity.Device == nil {
			continue
		}
		dev := event.Entity.Device
		if dev.Ip == nil || dev.Node == nil {
			continue
		}
		// Skip our own node entity.
		if event.Entity.Id == localNodeResp.Entity.GetId() {
			continue
		}

		host := dev.Ip.GetHost()
		if host == "" {
			continue
		}
		port := dev.Ip.GetPort()
		if port == 0 {
			port = 50051
		}
		addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))

		hostname := dev.Node.GetHostname()
		if hostname == "" {
			hostname = host
		}

		childID := fmt.Sprintf("federation.downstream.%s", event.Entity.Id)

		existing, _ := client.GetEntity(ctx, &pb.GetEntityRequest{Id: childID})
		if existing != nil && existing.Entity != nil {
			continue
		}

		cfg, _ := structpb.NewStruct(map[string]any{
			"enabled": false,
			"source":  addr,
		})

		_, err = client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id:    childID,
				Label: proto.String(hostname),
				Controller: &pb.Controller{
					Id: &controllerName,
				},
				Device: &pb.DeviceComponent{
					Parent: &serviceID,
					Class:  proto.String("downstream"),
				},
				Config: &pb.ConfigurationComponent{
					Value: cfg,
				},
				Configurable: &pb.ConfigurableComponent{
					Label: proto.String(hostname),
				},
			}},
		})
		if err != nil {
			logger.Error("auto-discover: push child", "entity", event.Entity.Id, "error", err)
			continue
		}
		logger.Info("auto-discover: created disabled downstream", "entity", event.Entity.Id, "addr", addr)
	}
}

func runInstance(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return fmt.Errorf("federation entity %s has no config", entity.Id)
	}

	fields := entity.Config.Value.Fields

	remote := ""
	var filter *pb.EntityFilter
	var limiter *pb.WatchBehavior
	var wgConfig *goclient.WireGuardConfig
	var sshDest string

	if v, ok := fields["source"]; ok {
		remote = v.GetStringValue()
	}
	if v, ok := fields["filter"]; ok {
		filter = parseEntityFilter(v)
	}
	if v, ok := fields["limiter"]; ok {
		limiter = parseWatchLimiter(v)
	}
	if v, ok := fields["wireguard"]; ok {
		wgConfig = parseWireGuardConfig(v)
	}
	if v, ok := fields["ssh"]; ok {
		sshDest = v.GetStringValue()
	}

	if wgConfig != nil && sshDest != "" {
		return fmt.Errorf("federation config has both wireguard and ssh; pick one")
	}
	if remote == "" {
		return fmt.Errorf("federation config missing source")
	}

	instance := &Instance{
		entityID:  entity.Id,
		serverURL: serverURL,
		remote:    remote,
		filter:    filter,
		limiter:   limiter,
		logger:    logger,
		wgConfig:  wgConfig,
		sshDest:   sshDest,
	}

	if wgConfig != nil {
		logger.Info("starting federation with WireGuard", "entityID", entity.Id, "remote", remote)
	} else if sshDest != "" {
		logger.Info("starting federation with SSH", "entityID", entity.Id, "remote", remote)
	} else {
		logger.Info("starting federation", "entityID", entity.Id, "remote", remote)
	}

	return instance.runDownstream(ctx)
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

const timeSyncInterval = 30 * time.Second

func (i *Instance) timeSyncLoop(ctx context.Context, client pb.WorldServiceClient) {
	probe := func() {
		offset, rtt := estimateClockOffset(ctx, client)
		i.ts.Add(offset, rtt)
	}
	probe()
	i.logger.Info("time sync", "offset", i.ts.Offset(), "rtt", i.ts.RTT())

	ticker := time.NewTicker(timeSyncInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			probe()
			i.logger.Debug("time sync", "offset", i.ts.Offset(), "rtt", i.ts.RTT())
		}
	}
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
	if i.sshDest != "" {
		return goclient.ConnectWithSSH(i.remote, i.sshDest)
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

	return true
}

// runDownstream pulls from a remote node and selectively pushes back.
// Only entities with a TaskableComponent or whose Controller.Node matches
// the remote node (i.e. entities that originated there) are pushed back.
func (i *Instance) runDownstream(ctx context.Context) error {
	i.ensureKeepalive()

	localConn, err := builtin.BuiltinClientConn("federation")
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

	localNodeID, localNodeEntity, err := discoverNode(ctx, localClient)
	if err != nil {
		return fmt.Errorf("discover local node ID: %w", err)
	}
	i.logger.Info("downstream: discovered local node", "nodeID", localNodeID)

	remoteNodeID, remoteNodeEntity, err := discoverNode(ctx, remoteClient)
	if err != nil {
		return fmt.Errorf("discover remote node ID: %w", err)
	}
	i.logger.Info("downstream: discovered remote node", "nodeID", remoteNodeID)

	go i.timeSyncLoop(ctx, remoteClient)

	federateNodeEntity(ctx, localClient, remoteNodeEntity, i.keepaliveTTL(), 0)
	federateNodeEntity(ctx, remoteClient, localNodeEntity, i.keepaliveTTL(), i.ts.Offset())

	keepaliveTTL := i.keepaliveTTL()

	// pulledFresh tracks the Fresh timestamp (in local clock domain) last
	// ingested by the pull leg for each entity. The push-back leg uses this
	// to skip owned-by-remote entities that haven't been locally modified.
	var pulledFresh sync.Map // entityID → time.Time

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	errc := make(chan error, 2)

	// Pull: remote → local (same as regular pull)
	go func() {
		stream, err := goclient.WatchEntitiesWithRetry(ctx, remoteClient, &pb.ListEntitiesRequest{
			Filter:    i.filter,
			Behaviour: i.limiter,
		})
		if err != nil {
			cancel()
			errc <- err
			return
		}
		i.logger.Info("downstream pull started", "entityID", i.entityID)
		for {
			if ctx.Err() != nil {
				errc <- ctx.Err()
				return
			}
			event, err := stream.Recv()
			if err != nil {
				cancel()
				errc <- err
				return
			}
			if event.Entity == nil {
				continue
			}
			shiftEntityTimestamps(event.Entity, -i.ts.Offset())
			if !filterForFederation(event.Entity, remoteNodeID, keepaliveTTL) {
				continue
			}
			if event.Entity.Camera != nil {
				rewriteCameraURLs(event.Entity, "http://"+i.remote)
			}
			if event.Entity.Lifetime != nil && event.Entity.Lifetime.Fresh != nil {
				pulledFresh.Store(event.Entity.Id, event.Entity.Lifetime.Fresh.AsTime())
			}
			_, err = localClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{event.Entity},
			})
			if err != nil {
				i.logger.Error("downstream: failed to push to local", "targetEntity", event.Entity.Id, "error", err)
			}
		}
	}()

	// Push: local → remote (only TaskableComponent or entities owned by remote)
	go func() {
		stream, err := goclient.WatchEntitiesWithRetry(ctx, localClient, &pb.ListEntitiesRequest{
			Behaviour: i.limiter,
		})
		if err != nil {
			cancel()
			errc <- err
			return
		}
		i.logger.Info("downstream push started", "entityID", i.entityID)
		for {
			if ctx.Err() != nil {
				errc <- ctx.Err()
				return
			}
			event, err := stream.Recv()
			if err != nil {
				cancel()
				errc <- err
				return
			}
			if event.Entity == nil {
				continue
			}
			hasTaskable := event.Entity.Taskable != nil
			ownedByRemote := event.Entity.Controller != nil &&
				event.Entity.Controller.Node != nil &&
				*event.Entity.Controller.Node == remoteNodeID
			if !hasTaskable && !ownedByRemote {
				continue
			}
			if ownedByRemote {
				if event.Entity.Lifetime != nil && event.Entity.Lifetime.Fresh != nil {
					entityFresh := event.Entity.Lifetime.Fresh.AsTime()
					if last, ok := pulledFresh.Load(event.Entity.Id); ok {
						if !entityFresh.After(last.(time.Time)) {
							continue
						}
					}
				}
			}
			if !filterForFederation(event.Entity, localNodeID, keepaliveTTL) {
				continue
			}
			if event.Entity.Camera != nil {
				origin := detectOrigin(i.remote)
				rewriteCameraURLs(event.Entity, origin)
			}
			shiftEntityTimestamps(event.Entity, i.ts.Offset())
			_, err = remoteClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{event.Entity},
			})
			if err != nil {
				i.logger.Error("downstream: failed to push to remote", "targetEntity", event.Entity.Id, "error", err)
			}
		}
	}()

	err = <-errc
	cancel()
	<-errc
	return err
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
