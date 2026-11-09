package federation

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/goclient"
	"github.com/projectqai/hydris/pkg/timesync"
	"github.com/projectqai/hydris/pkg/tracing"
	pb "github.com/projectqai/proto/go"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// relay pushes one federated entity to dst inside a "federation.relay" span
// in the trace of the version being relayed. That trace is derived from the
// entity id and fresh as the source node stores it (before clock-offset
// shifting), exactly as the source derived it, so no lookup is needed; the
// push then forwards the span as a traceparent header and the destination's
// change links it as carrier. Entities without a version get no span.
func (i *Instance) relay(ctx context.Context, dst pb.WorldServiceClient, e *pb.Entity, fresh *timestamppb.Timestamp, direction, peerNode string) error {
	ctx, span := tracing.ContinueSpan(ctx, tracing.Derive(e.Id, fresh), "federation.relay",
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("hydris.federation.link", i.entityID),
			attribute.String("hydris.federation.direction", direction),
			attribute.String("hydris.federation.peer_node", peerNode),
		),
	)
	defer span.End()
	_, err := dst.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{e}})
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	return err
}

type Instance struct {
	entityID    string
	remote      string // server URL (host:port or http(s)://…)
	fingerprint string // pinned mTLS identity of the remote ("" = no pin)
	logger      *slog.Logger

	ts timesync.Tracker
}

const federationKeepaliveMs = 30000 // 30s

// federationBehavior is the watch behaviour for both federation legs: a fixed
// keepalive so forwarded entities' TTLs are refreshed.
func federationBehavior() *pb.WatchBehavior {
	ms := uint32(federationKeepaliveMs)
	return &pb.WatchBehavior{KeepaliveIntervalMs: &ms}
}

// keepaliveTTL is 2× the keepalive interval: a forwarded entity survives one
// missed keepalive but expires when the link is truly dead.
const keepaliveTTL = 2 * federationKeepaliveMs * time.Millisecond

var globalLogger *slog.Logger

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	globalLogger = logger
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
				"description":    "Remote server URL to sync with, e.g. 10.0.0.2:50051 or https://10.0.0.2:50051. TLS connections authenticate with this node's certificate (mTLS).",
				"ui:placeholder": "e.g. 10.0.0.2:50051",
				"ui:order":       0,
			},
			"fingerprint": map[string]any{
				"type":           "string",
				"title":          "mTLS identity",
				"description":    "Pin the remote's mTLS identity: the SHA-256 fingerprint of its TLS certificate. When set, the link only connects over TLS and refuses any server that does not present a pinned certificate, so it keeps working — and stays safe — when the remote's IP changes. Several fingerprints may be listed (comma or space separated) to stage a certificate rotation.",
				"ui:placeholder": "e.g. 3316a5c578…(64 hex digits)",
				"ui:order":       1,
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
			return runInstance(ctx, globalLogger, entity)
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
		// https:// pins the transport: auto-discovered links never fall back to plaintext.
		source := "https://" + net.JoinHostPort(host, fmt.Sprintf("%d", port))
		fingerprint := dev.Node.GetMtlsIdentity()

		hostname := dev.Node.GetHostname()
		if hostname == "" {
			hostname = host
		}

		childID := fmt.Sprintf("federation.downstream.%s", event.Entity.Id)

		existing, _ := client.GetEntity(ctx, &pb.GetEntityRequest{Id: childID})
		if existing != nil && existing.Entity != nil {
			// Keyed by the peer's identity; follow it to the new address.
			updateDiscoveredConfig(ctx, logger, client, existing.Entity, source, fingerprint)
			continue
		}

		cfg, _ := structpb.NewStruct(map[string]any{
			"enabled":     false,
			"source":      source,
			"fingerprint": fingerprint,
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
		logger.Info("auto-discover: created disabled downstream", "entity", event.Entity.Id, "source", source)
	}
}

// updateDiscoveredConfig points an auto-discovered downstream at the peer's
// current address, preserving the rest of its config (notably "enabled").
func updateDiscoveredConfig(ctx context.Context, logger *slog.Logger,
	client pb.WorldServiceClient, child *pb.Entity, source, fingerprint string,
) {
	if child.Config == nil || child.Config.Value == nil || child.Config.Value.Fields == nil {
		return
	}
	fields := child.Config.Value.Fields
	currentSource := fields["source"].GetStringValue()
	currentFP := fields["fingerprint"].GetStringValue()

	// The pin is write-once: discovery fills it when empty but never changes
	// an existing one. A peer presenting a different certificate is a new
	// identity and gets its own link; moving an existing link's trust to a
	// new certificate is an operator decision, not an automatic one.
	if currentFP != "" {
		fingerprint = currentFP
	}
	if currentSource == source && currentFP == fingerprint {
		return
	}

	cfg := proto.Clone(child.Config).(*pb.ConfigurationComponent)
	cfg.Value.Fields["source"] = structpb.NewStringValue(source)
	if fingerprint != "" {
		cfg.Value.Fields["fingerprint"] = structpb.NewStringValue(fingerprint)
	}

	if _, err := client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:     child.Id,
			Config: cfg,
		}},
	}); err != nil {
		logger.Error("auto-discover: update config", "id", child.Id, "error", err)
		return
	}
	logger.Info("auto-discover: updated downstream", "id", child.Id,
		"source", source, "previousSource", currentSource, "fingerprint", fingerprint)
}

func runInstance(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return fmt.Errorf("federation entity %s has no config", entity.Id)
	}

	fields := entity.Config.Value.Fields

	remote := ""
	if v, ok := fields["source"]; ok {
		remote = v.GetStringValue()
	}
	if remote == "" {
		return fmt.Errorf("federation config missing source")
	}
	fingerprint := fields["fingerprint"].GetStringValue()

	instance := &Instance{
		entityID:    entity.Id,
		remote:      remote,
		fingerprint: fingerprint,
		logger:      logger,
	}

	logger.Info("starting federation", "entityID", entity.Id, "remote", remote, "fingerprint", fingerprint)

	return instance.runDownstream(ctx)
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

// connectToRemote establishes a working connection to the remote server. The
// scheme selects the transport — http:// is plaintext, https:// is TLS — and a
// bare host:port is tried over TLS first, then plaintext. For TLS we present the
// node's own certificate (mTLS) so the remote can identify us, and fall back to
// the same target without a client cert for remotes that predate mTLS
// federation. Each candidate is probed with GetLocalNode (gRPC dials lazily, so
// only a real RPC proves the transport and authentication actually work).
func (i *Instance) connectToRemote(ctx context.Context) (*goclient.Connection, error) {
	var opts []goclient.ConnectOption
	if engine.NodeTLSCert != nil {
		opts = append(opts, goclient.WithClientCert(*engine.NodeTLSCert))
	}
	if i.fingerprint != "" {
		// TLS only; rejected unless the remote presents the pinned cert.
		opts = append(opts, goclient.WithServerFingerprint(i.fingerprint))
	}
	return goclient.ConnectURL(ctx, i.remote, "", opts...)
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
	remoteConn, err := i.connectToRemote(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = remoteConn.Close() }()
	remoteClient := pb.NewWorldServiceClient(remoteConn)

	// Discover the remote node before opening the local connection: local pushes
	// are attributed to the link entity (actor) and scoped to this remote node, so
	// the policy can constrain what the link may write (source.node).
	remoteNodeID, remoteNodeEntity, err := discoverNode(ctx, remoteClient)
	if err != nil {
		return fmt.Errorf("discover remote node ID: %w", err)
	}
	i.logger.Info("downstream: discovered remote node", "nodeID", remoteNodeID)

	localConn, err := builtin.BuiltinClientConnForNode("federation", i.entityID, remoteNodeID)
	if err != nil {
		return err
	}
	defer func() { _ = localConn.Close() }()
	localClient := pb.NewWorldServiceClient(localConn)

	localNodeID, localNodeEntity, err := discoverNode(ctx, localClient)
	if err != nil {
		return fmt.Errorf("discover local node ID: %w", err)
	}
	i.logger.Info("downstream: discovered local node", "nodeID", localNodeID)

	go i.timeSyncLoop(ctx, remoteClient)

	federateNodeEntity(ctx, localClient, remoteNodeEntity, keepaliveTTL, 0)
	federateNodeEntity(ctx, remoteClient, localNodeEntity, keepaliveTTL, i.ts.Offset())

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	errc := make(chan error, 2)

	// Pull: remote → local (same as regular pull)
	go func() {
		stream, err := goclient.WatchEntitiesWithRetry(ctx, remoteClient, &pb.ListEntitiesRequest{
			Behaviour: federationBehavior(),
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
			// The version's trace is derived from the remote's own fresh,
			// before we shift or bump it.
			remoteFresh := event.Entity.GetLifetime().GetFresh()
			shiftEntityTimestamps(event.Entity, -i.ts.Offset())
			if !filterForFederation(event.Entity, remoteNodeID, keepaliveTTL) {
				continue
			}
			if event.Entity.Camera != nil {
				rewriteCameraURLs(event.Entity, "http://"+i.remote)
			}
			if err := i.relay(ctx, localClient, event.Entity, remoteFresh, "pull", remoteNodeID); err != nil {
				i.logger.Error("downstream: failed to push to local", "targetEntity", event.Entity.Id, "error", err)
			}
		}
	}()

	// Push: local → remote (only the TaskExecution component of local tasks)
	go func() {
		stream, err := goclient.WatchEntitiesWithRetry(ctx, localClient, &pb.ListEntitiesRequest{
			Behaviour: federationBehavior(),
		})
		if err != nil {
			cancel()
			errc <- err
			return
		}
		i.logger.Info("downstream push started", "entityID", i.entityID)
		// Every update to a vehicle repeats its last control frame; relay each
		// frame once, or a lapsed command would be revived upstream.
		relayedFrame := map[string]time.Time{}
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
			// Relay the TaskExecution of tasks issued against remote-owned
			// entities back upstream. Always send a stub carrying ONLY the
			// command component, never the full entity: defense in depth so a
			// local controller can never clobber the remote's authoritative
			// copy even if ownership ever gets misjudged.
			if event.Entity == nil || (event.Entity.TaskExecution == nil && event.Entity.TargetManualControl == nil) {
				continue
			}
			ownedByRemote := event.Entity.Controller != nil &&
				event.Entity.Controller.Node != nil &&
				*event.Entity.Controller.Node == remoteNodeID
			if !ownedByRemote {
				continue
			}
			frame := event.Entity.TargetManualControl
			if frame != nil {
				if at := frame.GetAt().AsTime(); at.Equal(relayedFrame[event.Entity.Id]) {
					frame = nil
				} else {
					relayedFrame[event.Entity.Id] = at
				}
			}
			if event.Entity.TaskExecution == nil && frame == nil {
				continue
			}
			localFresh := event.Entity.GetLifetime().GetFresh()
			stub := &pb.Entity{
				Id:                  event.Entity.Id,
				TaskExecution:       event.Entity.TaskExecution,
				TargetManualControl: frame,
			}
			shiftEntityTimestamps(stub, i.ts.Offset())
			if err := i.relay(ctx, remoteClient, stub, localFresh, "push", remoteNodeID); err != nil {
				i.logger.Error("downstream: failed to push to remote", "targetEntity", stub.Id, "error", err)
				_ = json.NewEncoder(os.Stderr).Encode(stub)
			}
		}
	}()

	err = <-errc
	cancel()
	<-errc
	return err
}

// rewriteCameraURLs points every federated camera stream at the immediate
// upstream's media proxy, so a downstream viewer reaches the camera through the
// upstream (which it can reach via the federation source) rather than the
// camera's own address (which it usually cannot). Video goes to the RTSP relay,
// image/MJPEG to the HTTP image proxy. In multi-hop federation each hop
// re-points to its own immediate upstream. HLS/Iframe are left unchanged.
func rewriteCameraURLs(entity *pb.Entity, origin string) {
	if entity.Camera == nil || origin == "" {
		return
	}
	originURL, err := url.Parse(origin)
	if err != nil {
		return
	}
	for idx, stream := range entity.Camera.Streams {
		if stream.Url == "" {
			continue
		}
		switch stream.Protocol {
		case pb.MediaStreamProtocol_MediaStreamProtocolImage,
			pb.MediaStreamProtocol_MediaStreamProtocolMjpeg:
			stream.Url = fmt.Sprintf("%s/media/image/%s?stream=%d", origin, entity.Id, idx)
		case pb.MediaStreamProtocol_MediaStreamProtocolHls,
			pb.MediaStreamProtocol_MediaStreamProtocolIframe:
			continue
		default:
			stream.Url = fmt.Sprintf("rtsp://%s/media/rtsp/%s?stream=%d", originURL.Host, entity.Id, idx)
			stream.Protocol = pb.MediaStreamProtocol_MediaStreamProtocolRtsp
		}
	}
}

func init() {
	builtin.Register("federation", Run)
}
