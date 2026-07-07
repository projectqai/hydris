package engine

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"os"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin/plugins"
	"github.com/projectqai/hydris/pkg/version"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// This file owns the node's stable identity: the hardware-derived node ID, the
// node device entity, and the long-lived TLS keypair used to serve HTTPS and to
// present a client certificate for federation.

// hardwareNodeID derives a stable node identifier from hardware characteristics.
// It tries /etc/machine-id first, then falls back to hashing MAC addresses,
// then to a random ID as a last resort.
func hardwareNodeID() string {
	// Try /etc/machine-id (Linux, systemd-based)
	if mid, err := os.ReadFile("/etc/machine-id"); err == nil {
		id := strings.TrimSpace(string(mid))
		if len(id) >= 16 {
			return id[:16]
		}
	}

	// Fallback: hash MAC addresses of network interfaces
	ifaces, err := net.Interfaces()
	if err == nil {
		var macs []string
		for _, iface := range ifaces {
			mac := iface.HardwareAddr.String()
			if mac != "" {
				macs = append(macs, mac)
			}
		}
		slices.Sort(macs)
		if len(macs) > 0 {
			h := sha256.Sum256([]byte(strings.Join(macs, ",")))
			return hex.EncodeToString(h[:16])
		}
	}

	// Last resort: random
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("failed to generate node identity: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// InitNodeIdentity finds or creates a stable node identity.
// It looks for an existing entity with a DeviceComponent containing a NodeDevice.
// If none is found, it derives one from hardware MAC addresses.
func (s *WorldServer) InitNodeIdentity() {
	s.l.Lock()
	defer s.l.Unlock()

	// Look for an existing node device entity
	for _, es := range s.head {
		e := es.entity
		if e.Device != nil && e.Device.Node != nil && strings.HasPrefix(e.Id, "node.") {
			s.nodeID = strings.TrimPrefix(e.Id, "node.")
			s.nodeEntity = e
			s.fillNodeDeviceInfo(e.Device.Node)
			if s.chatTransformer != nil {
				s.chatTransformer.SetNodeEntityID(s.nodeEntity.Id)
			}
			slog.Info("using existing node identity", "nodeID", s.nodeID, "entityID", e.Id)
			s.checkForUpdate()
			return
		}
	}

	s.nodeID = hardwareNodeID()

	hostname, _ := os.Hostname()
	numCPU := uint32(runtime.NumCPU())

	node := &pb.NodeDevice{
		Hostname: &hostname,
		NumCpu:   &numCPU,
	}
	s.fillNodeDeviceInfo(node)

	nodeEntityID := "node." + s.nodeID
	s.nodeEntity = &pb.Entity{
		Id:     nodeEntityID,
		Label:  &hostname,
		Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPUCI--------"},
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
			State:    pb.DeviceState_DeviceStateActive,
			Node:     node,
		},
		Controller: &pb.Controller{
			Node:   &s.nodeID,
			Origin: &nodeEntityID,
		},
	}

	s.setEntity(s.nodeEntity.Id, s.nodeEntity, nil)
	s.bus.Dirty(s.nodeEntity.Id, s.nodeEntity, pb.EntityChange_EntityChangeUpdated)

	slog.Info("created new node identity", "nodeID", s.nodeID, "entityID", s.nodeEntity.Id)

	if s.chatTransformer != nil {
		s.chatTransformer.SetNodeEntityID(s.nodeEntity.Id)
	}

	s.checkForUpdate()
}

// SetNodeID overrides the node identity. Used in tests to simulate distinct
// nodes on the same machine. Must be called after InitNodeIdentity.
func (s *WorldServer) SetNodeID(id string) {
	s.l.Lock()
	defer s.l.Unlock()
	s.nodeID = id
	if s.nodeEntity != nil && s.nodeEntity.Controller != nil {
		s.nodeEntity.Controller.Node = &s.nodeID
	}
}

// fillNodeDeviceInfo overwrites the runtime-derived fields of a NodeDevice
// with current values. Called both for freshly created and persisted nodes
// so that version info is always up to date.
func (s *WorldServer) fillNodeDeviceInfo(n *pb.NodeDevice) {
	n.Os = strPtr(runtime.GOOS)
	n.Arch = strPtr(runtime.GOARCH)
	n.HydrisVersion = strPtr(version.Version)
	n.HydrisUpdateAvailable = nil // clear stale value; checkForUpdate will re-set if needed
	if v := osVersion(); v != "" {
		n.OsVersion = &v
	}
}

// checkForUpdate fetches the plugin registry index in the background and
// sets hydris_update_available on the node entity when a newer version exists.
func (s *WorldServer) checkForUpdate() {
	if version.Version == "dev" {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		idx, err := plugins.FetchIndex(ctx)
		if err != nil {
			slog.Debug("update check: failed to fetch index", "error", err)
			return
		}
		if idx.HydrisVersion == "" {
			return
		}
		if version.IsNewerVersion(idx.HydrisVersion) {
			s.l.Lock()
			if s.nodeEntity != nil && s.nodeEntity.Device != nil && s.nodeEntity.Device.Node != nil {
				s.nodeEntity.Device.Node.HydrisUpdateAvailable = &idx.HydrisVersion
				s.bus.Dirty(s.nodeEntity.Id, s.nodeEntity, pb.EntityChange_EntityChangeUpdated)
			}
			s.l.Unlock()
			slog.Info("hydris update available", "current", version.Version, "latest", idx.HydrisVersion)
		}
	}()
}

func strPtr(s string) *string { return &s }

// colonHex renders bytes as colon-separated lowercase hex (e.g. "a1:b2:c3"),
// the conventional display form for certificate fingerprints.
func colonHex(b []byte) string {
	parts := make([]string, len(b))
	for i, v := range b {
		parts[i] = fmt.Sprintf("%02x", v)
	}
	return strings.Join(parts, ":")
}
