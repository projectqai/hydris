package reolink

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/netscan"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func isReolinkVendor(vendor string) bool {
	return strings.Contains(strings.ToLower(vendor), "reolink")
}

// watchNetscanForCameras watches all DeviceComponent entities and creates
// reolink.device.* child entities for those matching the Reolink vendor.
func watchNetscanForCameras(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		logger.Error("netscan watcher: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50}, // DeviceComponent
		},
	})
	if err != nil {
		logger.Error("netscan watcher: failed to watch", "error", err)
		return
	}

	known := make(map[string]string) // netscan entity ID -> reolink device entity ID

	defer func() {
		for _, childID := range known {
			expCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, _ = client.ExpireEntity(expCtx, &pb.ExpireEntityRequest{Id: childID})
			cancel()
		}
	}()

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Error("netscan watcher: stream error", "error", err)
			return
		}

		if event.Entity == nil {
			continue
		}

		entity := event.Entity

		// Skip entities owned by this controller.
		if entity.Controller != nil && entity.Controller.GetId() == controllerName {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			if entity.Lifetime != nil && entity.Lifetime.Until != nil &&
				!entity.Lifetime.Until.AsTime().After(time.Now()) {
				continue
			}

			if entity.Device == nil || entity.Device.Ethernet == nil {
				continue
			}
			if !isReolinkVendor(entity.Device.Ethernet.GetVendor()) {
				continue
			}

			if _, exists := known[entity.Id]; exists {
				continue
			}

			ip := ""
			if entity.Device.Ip != nil {
				ip = entity.Device.Ip.GetHost()
			}
			if ip == "" {
				continue
			}

			mac := strings.ReplaceAll(entity.Device.Ethernet.GetMacAddress(), ":", "")
			if mac == "" {
				mac = strings.ReplaceAll(ip, ".", "_")
			}
			childEntityID := controllerName + ".device." + mac
			logger.Info("Reolink camera found via netscan",
				"entityID", entity.Id,
				"ip", ip,
			)

			label := "Reolink Camera " + ip
			if entity.Label != nil && *entity.Label != "" {
				label = *entity.Label
			}

			if _, err := client.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{{
					Id:    childEntityID,
					Label: proto.String(label),
					Controller: &pb.Controller{
						Id: proto.String(controllerName),
					},
					Device: &pb.DeviceComponent{
						Parent:      proto.String(controllerName + ".service"),
						Composition: []string{entity.Id},
						Class:       proto.String("camera"),
						Category:    proto.String("Cameras"),
						State:       pb.DeviceState_DeviceStatePending,
						Ip: &pb.IpDevice{
							Host: proto.String(ip),
						},
					},
					Symbol: &pb.SymbolComponent{
						MilStd2525C: "SFGPE-----",
					},
				}},
			}); err != nil {
				logger.Error("failed to push reolink device", "entityID", entity.Id, "error", err)
				continue
			}

			known[entity.Id] = childEntityID

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			if _, exists := known[entity.Id]; exists {
				// Only forget the mapping so the device can be re-discovered
				// if netscan picks it up again. Don't expire the reolink device
				// — netscan can be unreliable and the camera controller manages
				// its own lifecycle.
				logger.Info("netscan device gone, forgetting mapping",
					"netscanEntity", entity.Id,
					"reolinkEntity", known[entity.Id],
				)
				delete(known, entity.Id)
			}
		}
	}
}

const (
	wsDiscoveryAddr = "239.255.255.250:3702"
	wsDiscoveryTTL  = 120 * time.Second
)

func wsDiscoveryProbeMessage() string {
	msgID := uuid.New().String()
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:%s</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`, msgID)
}

func parseXAddrsFromResponse(data string) []string {
	var addrs []string
	for _, chunk := range strings.Split(data, "XAddrs>") {
		if !strings.Contains(chunk, "http") {
			continue
		}
		idx := strings.Index(chunk, "</")
		if idx < 0 {
			idx = len(chunk)
		}
		for _, addr := range strings.Fields(chunk[:idx]) {
			addr = strings.TrimSpace(addr)
			if strings.HasPrefix(addr, "http://") || strings.HasPrefix(addr, "https://") {
				addrs = append(addrs, addr)
			}
		}
	}
	return addrs
}

func extractIPFromXAddr(xaddr string) string {
	xaddr = strings.TrimPrefix(xaddr, "http://")
	xaddr = strings.TrimPrefix(xaddr, "https://")
	host, _, _ := net.SplitHostPort(xaddr)
	if host != "" {
		return host
	}
	if idx := strings.Index(xaddr, "/"); idx > 0 {
		return xaddr[:idx]
	}
	return xaddr
}

// runWSDiscovery sends periodic WS-Discovery multicast probes and creates
// device entities for discovered cameras. Only cameras whose MAC resolves
// to a Reolink vendor via netscan are kept.
func runWSDiscovery(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		logger.Error("ws-discovery: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	known := make(map[string]struct{})

	for {
		discovered := probeOnvifDevices(ctx, logger)

		var entities []*pb.Entity
		for _, xaddr := range discovered {
			ip := extractIPFromXAddr(xaddr)
			if ip == "" {
				continue
			}

			mac := netscan.LookupMAC(ip)
			name := mac
			if name == "" {
				name = strings.ReplaceAll(ip, ".", "_")
			}
			entityID := fmt.Sprintf("%s.device.%s", controllerName, name)

			if _, exists := known[entityID]; exists {
				continue
			}
			known[entityID] = struct{}{}

			entities = append(entities, &pb.Entity{
				Id:    entityID,
				Label: proto.String("Reolink Camera " + ip),
				Controller: &pb.Controller{
					Id: proto.String(controllerName),
				},
				Device: &pb.DeviceComponent{
					Parent:   proto.String(controllerName + ".service"),
					Class:    proto.String("camera"),
					Category: proto.String("Cameras"),
					State:    pb.DeviceState_DeviceStatePending,
					Ip: &pb.IpDevice{
						Host: proto.String(ip),
					},
				},
				Symbol: &pb.SymbolComponent{
					MilStd2525C: "SFGPE-----",
				},
			})
		}

		if len(entities) > 0 {
			if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: entities}); err != nil {
				logger.Error("ws-discovery: failed to push entities", "error", err)
			} else {
				logger.Info("ws-discovery: pushed discovered cameras", "count", len(entities))
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func probeOnvifDevices(ctx context.Context, logger *slog.Logger) []string {
	addr, err := net.ResolveUDPAddr("udp4", wsDiscoveryAddr)
	if err != nil {
		logger.Error("ws-discovery: resolve addr", "error", err)
		return nil
	}

	conn, err := net.ListenUDP("udp4", nil)
	if err != nil {
		logger.Error("ws-discovery: listen", "error", err)
		return nil
	}
	defer conn.Close()

	msg := []byte(wsDiscoveryProbeMessage())
	if _, err := conn.WriteToUDP(msg, addr); err != nil {
		logger.Error("ws-discovery: send probe", "error", err)
		return nil
	}

	deadline := time.Now().Add(3 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetReadDeadline(deadline)

	seen := make(map[string]bool)
	var xaddrs []string
	buf := make([]byte, 8192)

	for {
		n, _, err := conn.ReadFromUDP(buf)
		if err != nil {
			break
		}
		for _, xaddr := range parseXAddrsFromResponse(string(buf[:n])) {
			ip := extractIPFromXAddr(xaddr)
			if !seen[ip] {
				seen[ip] = true
				xaddrs = append(xaddrs, xaddr)
			}
		}
	}

	return xaddrs
}
