// Package mdns discovers other hydris nodes on the local L2 network via
// mDNS/DNS-SD and makes them available for federation.
//
// Each node advertises "_hydris._tcp" with its gRPC port and TLS certificate
// fingerprint in TXT. Peers are probed over TLS only and keyed by the
// fingerprint verified in that handshake, so a peer that changes IP keeps the
// same entity (mdns.peer.<fingerprint>) and only its address is updated.
package mdns

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/goclient"
	"github.com/projectqai/hydris/hal"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	controllerName = "mdns"
	serviceID      = "mdns.service"
	serviceType    = "_hydris._tcp"

	refreshInterval = 30 * time.Second
	peerTTL         = 3 * refreshInterval
	probeTimeout    = 5 * time.Second
	probeDelay      = 200 * time.Millisecond
)

func init() {
	builtin.Register(controllerName, Run)
}

func configSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"enabled": map[string]interface{}{
				"type":        "boolean",
				"title":       "Enabled",
				"description": "Advertise this node and discover hydris peers on the local network via mDNS",
				"default":     true,
			},
			"advertise": map[string]interface{}{
				"type":        "boolean",
				"title":       "Advertise",
				"description": "Announce this node on the local network. Disable to discover peers without disclosing this node's presence (browse-only).",
				"default":     true,
			},
		},
	})
	return s
}

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	if err := controller.Push(ctx, controllerName, &pb.Entity{
		Id:    serviceID,
		Label: proto.String("LAN Discovery"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
		},
		Configurable: &pb.ConfigurableComponent{
			Label:  proto.String("LAN Discovery (mDNS)"),
			Schema: configSchema(),
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("network"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	return controller.Run(ctx, controllerName, serviceID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
		advertise := true
		if entity.Config != nil && entity.Config.Value != nil {
			if v, ok := entity.Config.Value.Fields["enabled"]; ok && !v.GetBoolValue() {
				return nil // intentionally idle
			}
			if v, ok := entity.Config.Value.Fields["advertise"]; ok && !v.GetBoolValue() {
				advertise = false
			}
		}

		grpcConn, err := builtin.BuiltinClientConn(controllerName)
		if err != nil {
			return fmt.Errorf("grpc connect: %w", err)
		}
		defer func() { _ = grpcConn.Close() }()
		client := pb.NewWorldServiceClient(grpcConn)

		localNode, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
		if err != nil {
			return fmt.Errorf("get local node: %w", err)
		}

		port := grpcPort(serverURL)
		fp := localFingerprint()
		instance := instanceName(fp)

		txt := map[string]string{}
		if fp != "" {
			txt["fp"] = fp
		}
		if localNode.Entity != nil && localNode.Entity.Controller != nil && localNode.Entity.Controller.Node != nil {
			txt["node"] = *localNode.Entity.Controller.Node
		}

		ready()

		if advertise {
			stopAdv, err := hal.AdvertiseMDNS(instance, serviceType, port, txt)
			if err != nil {
				logger.Warn("mDNS advertise unavailable", "error", err)
			} else {
				logger.Info("advertising on LAN", "instance", instance, "port", port, "fp", fp)
				defer stopAdv()
			}
		} else {
			logger.Info("mDNS advertise disabled, browse-only")
		}

		d := &discovery{
			logger:  logger,
			client:  client,
			localFP: fp,
			peers:   make(map[string]*peerState),
			probeCh: make(chan string, 64),
		}

		stopBrowse, err := hal.WatchMDNS(serviceType, func(peers []hal.MDNSPeer) {
			if ctx.Err() != nil {
				return
			}
			d.reconcile(ctx, peers)
		})
		if err != nil {
			logger.Warn("mDNS browse unavailable, LAN discovery idle", "error", err)
			<-ctx.Done()
			return ctx.Err()
		}
		defer stopBrowse()
		logger.Info("mdns peer discovery started")

		go d.probeLoop(ctx)

		ticker := time.NewTicker(refreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-ticker.C:
				d.refresh(ctx)
			}
		}
	})
}

// grpcPort extracts the port this node's gRPC server listens on.
func grpcPort(serverURL string) int {
	if _, p, err := net.SplitHostPort(strings.TrimPrefix(strings.TrimPrefix(serverURL, "http://"), "https://")); err == nil {
		var port int
		if _, err := fmt.Sscanf(p, "%d", &port); err == nil {
			return port
		}
	}
	return 50051
}

// localFingerprint returns the hex SHA-256 of this node's TLS leaf certificate.
func localFingerprint() string {
	if engine.NodeTLSCert == nil || len(engine.NodeTLSCert.Certificate) == 0 {
		return ""
	}
	sum := sha256.Sum256(engine.NodeTLSCert.Certificate[0])
	return hex.EncodeToString(sum[:])
}

// instanceName builds a unique, DNS-friendly service instance name.
func instanceName(fp string) string {
	host := engine.Hostname()
	if host == "" {
		host = "hydris"
	}
	host = sanitizeLabel(host)
	if len(fp) >= 8 {
		return host + "-" + fp[:8]
	}
	return host
}

func sanitizeLabel(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

// peerState is one discovered peer, keyed by TLS certificate fingerprint.
type peerState struct {
	fp       string // verified (or TXT-claimed, until probed) fingerprint
	instance string
	hostname string
	addr     string
	port     int
	node     *pb.NodeDevice // set once the TLS probe confirmed a hydris node
	probedAt string         // "host:port" the last successful probe used
}

type discovery struct {
	logger  *slog.Logger
	client  pb.WorldServiceClient
	localFP string

	mu      sync.Mutex
	peers   map[string]*peerState // fp -> state
	probeCh chan string           // fp queue for the probe worker
}

// reconcile folds a browse snapshot into the peer table and pushes entities.
func (d *discovery) reconcile(ctx context.Context, snapshot []hal.MDNSPeer) {
	var entities []*pb.Entity
	var toProbe []string

	d.mu.Lock()
	seen := make(map[string]struct{})
	for _, p := range snapshot {
		fp := strings.ToLower(p.Txt["fp"])
		if fp == "" || fp == d.localFP {
			// Without a fingerprint we cannot key the peer stably nor federate over mTLS.
			continue
		}
		addr := pickAddr(p.Addrs)
		if addr == "" {
			continue
		}
		seen[fp] = struct{}{}

		st := d.peers[fp]
		if st == nil {
			st = &peerState{fp: fp}
			d.peers[fp] = st
			d.logger.Info("discovered hydris peer on LAN", "instance", p.Instance, "addr", addr)
		}
		st.instance = p.Instance
		st.hostname = strings.TrimSuffix(p.Hostname, ".local")
		// Addrs is ordered freshest-first and can reorder between
		// announcements on a multi-homed peer; switching the address
		// restarts the federation link, so keep the current one for as
		// long as the peer still announces it.
		if st.addr == "" || !slices.Contains(p.Addrs, st.addr) {
			st.addr = addr
		}
		st.port = p.Port

		entities = append(entities, peerEntity(st))

		if st.probedAt != net.JoinHostPort(st.addr, fmt.Sprint(st.port)) {
			toProbe = append(toProbe, fp)
		}
	}

	// Peers gone from the snapshot expire via TTL; drop them so a return is a
	// fresh rediscovery.
	for fp := range d.peers {
		if _, ok := seen[fp]; !ok {
			delete(d.peers, fp)
		}
	}
	d.mu.Unlock()

	d.push(ctx, entities)
	for _, fp := range toProbe {
		select {
		case d.probeCh <- fp:
		default:
		}
	}
}

// refresh re-pushes all known peers to keep their TTLs alive and retries the
// TLS probe for peers not yet verified.
func (d *discovery) refresh(ctx context.Context) {
	d.mu.Lock()
	entities := make([]*pb.Entity, 0, len(d.peers))
	var toProbe []string
	for fp, st := range d.peers {
		entities = append(entities, peerEntity(st))
		if st.probedAt != net.JoinHostPort(st.addr, fmt.Sprint(st.port)) {
			toProbe = append(toProbe, fp)
		}
	}
	d.mu.Unlock()
	d.push(ctx, entities)
	for _, fp := range toProbe {
		select {
		case d.probeCh <- fp:
		default:
		}
	}
}

func (d *discovery) push(ctx context.Context, entities []*pb.Entity) {
	if len(entities) == 0 {
		return
	}
	if _, err := d.client.Push(ctx, &pb.EntityChangeRequest{Changes: entities}); err != nil {
		d.logger.Error("failed to push mdns peer entities", "error", err)
	}
}

// peerEntity builds the entity for one peer; the caller holds d.mu.
func peerEntity(st *peerState) *pb.Entity {
	now := time.Now()
	// Prefer the hostname the verified node reports over the mDNS host record,
	// which some platforms fill with a generated name.
	label := st.node.GetHostname()
	if label == "" {
		label = st.hostname
	}
	if label == "" {
		label = st.instance
	}
	linkStatus := pb.LinkStatus_LinkStatusConnected
	port := uint32(st.port)

	return &pb.Entity{
		Id:         peerEntityID(st.fp),
		Label:      proto.String(label),
		Controller: &pb.Controller{Id: proto.String(controllerName)},
		Device: &pb.DeviceComponent{
			Parent:   proto.String(serviceID),
			Category: proto.String("Network"),
			State:    pb.DeviceState_DeviceStateActive,
			Ip:       &pb.IpDevice{Host: proto.String(st.addr), Port: &port},
			Node:     st.node,
		},
		Link: &pb.LinkComponent{
			Status: &linkStatus,
		},
		Lifetime: &pb.Lifetime{
			Fresh: timestamppb.New(now),
			Until: timestamppb.New(now.Add(peerTTL)),
		},
	}
}

func peerEntityID(fp string) string {
	return controllerName + ".peer." + fp
}

// probeLoop verifies peers over TLS, one at a time.
func (d *discovery) probeLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case fp := <-d.probeCh:
			d.mu.Lock()
			st, ok := d.peers[fp]
			var addr, host string
			if ok {
				addr = net.JoinHostPort(st.addr, fmt.Sprint(st.port))
				host = st.hostname
			}
			d.mu.Unlock()
			if !ok {
				continue
			}

			verifiedFP, remote, err := probeTLS(ctx, addr)
			if err != nil {
				d.logger.Debug("TLS probe failed", "addr", addr, "error", err)
				continue
			}

			d.mu.Lock()
			st, ok = d.peers[fp]
			if !ok {
				d.mu.Unlock()
				continue
			}
			if verifiedFP != fp {
				// Trust only the certificate presented in the handshake.
				d.logger.Warn("mdns peer fingerprint mismatch, keying by verified certificate",
					"advertised", fp, "verified", verifiedFP, "addr", addr)
				if verifiedFP == d.localFP {
					delete(d.peers, fp)
					d.mu.Unlock()
					continue
				}
				delete(d.peers, fp)
				st.fp = verifiedFP
				d.peers[verifiedFP] = st
			}
			if remote != nil && remote.Device != nil && remote.Device.Node != nil {
				st.node = remote.Device.Node
				// Overwrite the self-reported identity with what our handshake verified.
				st.node.MtlsIdentity = proto.String(verifiedFP)
			}
			st.probedAt = addr
			entity := peerEntity(st)
			d.mu.Unlock()

			d.logger.Info("verified hydris peer over TLS", "host", host, "addr", addr)
			d.push(ctx, []*pb.Entity{entity})

			select {
			case <-ctx.Done():
				return
			case <-time.After(probeDelay):
			}
		}
	}
}

// probeTLS connects to addr over TLS only and returns the SHA-256 fingerprint
// of the certificate the peer presented, plus its local node entity.
func probeTLS(ctx context.Context, addr string) (string, *pb.Entity, error) {
	probeCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()

	// The engine serves a self-signed node certificate, so verify by fingerprint.
	dialer := &tls.Dialer{Config: &tls.Config{
		InsecureSkipVerify: true,
		NextProtos:         []string{"h2"},
		MinVersion:         tls.VersionTLS12,
	}}
	rawConn, err := dialer.DialContext(probeCtx, "tcp", addr)
	if err != nil {
		return "", nil, fmt.Errorf("tls handshake: %w", err)
	}
	state := rawConn.(*tls.Conn).ConnectionState()
	_ = rawConn.Close()
	if len(state.PeerCertificates) == 0 {
		return "", nil, fmt.Errorf("peer presented no certificate")
	}
	sum := sha256.Sum256(state.PeerCertificates[0].Raw)
	fp := hex.EncodeToString(sum[:])

	// Present our node cert first; ConnectURL retries without it for peers that
	// deny unknown client certificates.
	var opts []goclient.ConnectOption
	if engine.NodeTLSCert != nil {
		opts = append(opts, goclient.WithClientCert(*engine.NodeTLSCert))
	}
	conn, err := goclient.ConnectURL(probeCtx, "https://"+addr, "", opts...)
	if err != nil {
		return "", nil, err
	}
	defer func() { _ = conn.Close() }()

	resp, err := pb.NewWorldServiceClient(conn).GetLocalNode(probeCtx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return "", nil, fmt.Errorf("get local node: %w", err)
	}
	return fp, resp.Entity, nil
}

// pickAddr prefers an IPv4 address; mDNS browse results may mix families.
func pickAddr(addrs []string) string {
	for _, a := range addrs {
		ip := net.ParseIP(a)
		if ip != nil && ip.To4() != nil {
			return a
		}
	}
	if len(addrs) > 0 {
		return addrs[0]
	}
	return ""
}
