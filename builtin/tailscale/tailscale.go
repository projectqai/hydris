package tailscale

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	pollInterval   = 60 * time.Second
	absentInterval = 5 * time.Minute
	peerTTL        = 2 * pollInterval
	probeDelay     = 200 * time.Millisecond
	socketPath     = "/var/run/tailscale/tailscaled.sock"
	hydrisPort     = "50051"
)

func init() {
	builtin.Register("tailscale", Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	grpcConn, err := builtin.BuiltinClientConn("tailscale")
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	resp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return fmt.Errorf("get local node: %w", err)
	}
	nodeEntityID := resp.Entity.Id

	controllerName := "tailscale"

	if err := controller.Push(ctx, controllerName, &pb.Entity{
		Id:    "tailscale.service",
		Label: proto.String("Tailscale"),
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
		},
		Interactivity: &pb.InteractivityComponent{},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	logger.Info("tailscale peer discovery started", "nodeEntityID", nodeEntityID)

	httpClient := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
			},
		},
	}

	absent := false
	return controller.RunPolled(ctx, controllerName, "tailscale.service", func(ctx context.Context, entity *pb.Entity) (time.Duration, error) {
		if _, err := os.Stat(socketPath); errors.Is(err, fs.ErrNotExist) {
			if !absent {
				logger.Info("tailscaled not running, will retry periodically", "socket", socketPath)
				absent = true
			}
			return absentInterval, nil
		}

		status, err := fetchStatus(ctx, httpClient)
		if err != nil {
			return 0, fmt.Errorf("fetch tailscale status: %w", err)
		}

		if absent {
			logger.Info("tailscaled now reachable")
			absent = false
		}

		reconcile(ctx, logger, client, nodeEntityID, status)
		return pollInterval, nil
	})
}

func reconcile(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient,
	nodeEntityID string, status *tsStatus,
) {
	now := time.Now()
	controllerName := "tailscale"
	serviceID := "tailscale.service"

	type peerInfo struct {
		id    string
		label string
		ip    string
		peer  tsPeer
	}

	var entities []*pb.Entity
	var onlinePeers []peerInfo

	for _, peer := range status.Peer {
		label := peer.HostName
		if label == "" {
			label = peer.DNSName
		}
		label = strings.TrimSuffix(label, ".")

		var ip string
		if len(peer.TailscaleIPs) > 0 {
			ip = peer.TailscaleIPs[0]
		}

		linkStatus := pb.LinkStatus_LinkStatusLost
		if peer.Online {
			linkStatus = pb.LinkStatus_LinkStatusConnected
		}

		id := controllerName + ".peer." + nodeEntityID + "." + peer.ID

		peerLabel := label
		if peer.OS != "" {
			peerLabel += " (" + peer.OS + ")"
		}

		entities = append(entities, &pb.Entity{
			Id:         id,
			Label:      proto.String(peerLabel),
			Controller: &pb.Controller{Id: &controllerName},
			Device: &pb.DeviceComponent{
				Parent:   &serviceID,
				Category: proto.String("Network"),
				State:    pb.DeviceState_DeviceStateActive,
				Ip:       &pb.IpDevice{Host: &ip},
			},
			Link: &pb.LinkComponent{
				Status: &linkStatus,
			},
			Lifetime: &pb.Lifetime{
				Fresh: timestamppb.New(now),
				Until: timestamppb.New(now.Add(peerTTL)),
			},
		})

		if peer.Online && ip != "" {
			onlinePeers = append(onlinePeers, peerInfo{id: id, label: label, ip: ip, peer: peer})
		}
	}

	// Push all peers immediately so the UI populates right away.
	if len(entities) > 0 {
		if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: entities}); err != nil {
			logger.Error("failed to push tailscale peer entities", "error", err)
		}
	}

	logger.Debug("tailscale peers pushed", "count", len(entities))

	// Probe online peers for hydris and update with NodeDevice where found.
	for _, p := range onlinePeers {
		if ctx.Err() != nil {
			return
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(probeDelay):
		}

		remoteEntity := probeHydris(ctx, p.ip)
		if remoteEntity == nil {
			continue
		}

		logger.Info("discovered hydris peer via tailscale", "host", p.label, "ip", p.ip)

		var nodeDevice *pb.NodeDevice
		if remoteEntity.Device != nil {
			nodeDevice = remoteEntity.Device.Node
		}

		if _, err := client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: p.id,
				Device: &pb.DeviceComponent{
					Parent:   &serviceID,
					Category: proto.String("Network"),
					State:    pb.DeviceState_DeviceStateActive,
					Ip:       &pb.IpDevice{Host: &p.ip},
					Node:     nodeDevice,
				},
			}},
		}); err != nil {
			logger.Error("failed to update peer with node info", "id", p.id, "error", err)
		}
	}
}

// probeHydris attempts a GetLocalNode call against ip:50051.
// Returns the remote entity if the peer is running hydris, nil otherwise.
func probeHydris(ctx context.Context, ip string) *pb.Entity {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	addr := net.JoinHostPort(ip, hydrisPort)
	conn, err := goclient.Connect(addr)
	if err != nil {
		return nil
	}
	defer func() { _ = conn.Close() }()

	client := pb.NewWorldServiceClient(conn)
	resp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return nil
	}

	return resp.Entity
}

type tsStatus struct {
	Self tsPeer            `json:"Self"`
	Peer map[string]tsPeer `json:"Peer"`
}

type tsPeer struct {
	ID           string   `json:"ID"`
	HostName     string   `json:"HostName"`
	DNSName      string   `json:"DNSName"`
	TailscaleIPs []string `json:"TailscaleIPs"`
	Online       bool     `json:"Online"`
	OS           string   `json:"OS"`
}

func fetchStatus(ctx context.Context, client *http.Client) (*tsStatus, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "http://local-tailscaled.sock/localapi/v0/status", nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tailscale API returned %d", resp.StatusCode)
	}

	var status tsStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, fmt.Errorf("decode status: %w", err)
	}
	return &status, nil
}
