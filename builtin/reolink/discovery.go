package reolink

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/netscan"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func isReolinkVendor(vendor string) bool {
	return strings.Contains(strings.ToLower(vendor), "reolink")
}

func watchNetscanForCameras(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn("reolink")
	if err != nil {
		logger.Error("netscan watcher: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50},
		},
	})
	if err != nil {
		logger.Error("netscan watcher: failed to watch", "error", err)
		return
	}

	known := make(map[string]string)

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
					Classification: &pb.ClassificationComponent{
						Taxonomy: []*pb.ClassificationTaxonomy{{
							Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
								Sensor: &pb.EquipmentTaxonomySensor{Kind: &pb.EquipmentTaxonomySensor_ElectroOptical{ElectroOptical: &pb.EquipmentTaxonomySensorElectroOptical{}}},
							}},
						}},
					},
				}},
			}); err != nil {
				logger.Error("failed to push reolink device", "entityID", entity.Id, "error", err)
				continue
			}

			known[entity.Id] = childEntityID

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			if _, exists := known[entity.Id]; exists {
				logger.Info("netscan device gone, forgetting mapping",
					"netscanEntity", entity.Id,
					"reolinkEntity", known[entity.Id],
				)
				delete(known, entity.Id)
			}
		}
	}
}

func watchDiscoveredCameras(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn("reolink")
	if err != nil {
		logger.Error("discovery watcher: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50},
		},
	})
	if err != nil {
		logger.Error("discovery watcher: failed to watch", "error", err)
		return
	}

	known := make(map[string]string)

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
			logger.Error("discovery watcher: stream error", "error", err)
			return
		}

		if event.Entity == nil {
			continue
		}

		entity := event.Entity

		if entity.Controller != nil && entity.Controller.GetId() == controllerName {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			if entity.Lifetime != nil && entity.Lifetime.Until != nil &&
				!entity.Lifetime.Until.AsTime().After(time.Now()) {
				continue
			}

			if entity.Device == nil || entity.Device.Ip == nil {
				continue
			}
			ip := entity.Device.Ip.GetHost()
			if ip == "" {
				continue
			}

			if _, exists := known[entity.Id]; exists {
				continue
			}

			// Skip if already identified as non-Reolink via MAC vendor.
			if entity.Device.Ethernet != nil && entity.Device.Ethernet.GetVendor() != "" &&
				!isReolinkVendor(entity.Device.Ethernet.GetVendor()) {
				continue
			}

			cfg := getServiceConfig()
			manufacturer, _, _, err := getDeviceInfo(ip, cfg.Username, cfg.Password)
			if err != nil {
				continue
			}
			if !isReolinkVendor(manufacturer) {
				continue
			}

			mac := ""
			if entity.Device.Ethernet != nil {
				mac = strings.ReplaceAll(strings.ToLower(entity.Device.Ethernet.GetMacAddress()), ":", "")
			}
			if mac == "" {
				mac = netscan.LookupMAC(ip)
			}
			name := mac
			if name == "" {
				name = strings.ReplaceAll(ip, ".", "_")
			}
			childEntityID := controllerName + ".device." + name

			logger.Info("Reolink camera found via discovery",
				"entityID", entity.Id,
				"ip", ip,
			)

			if _, err := client.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{{
					Id:    childEntityID,
					Label: proto.String("Reolink Camera " + ip),
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
					Classification: &pb.ClassificationComponent{
						Taxonomy: []*pb.ClassificationTaxonomy{{
							Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
								Sensor: &pb.EquipmentTaxonomySensor{Kind: &pb.EquipmentTaxonomySensor_ElectroOptical{ElectroOptical: &pb.EquipmentTaxonomySensorElectroOptical{}}},
							}},
						}},
					},
				}},
			}); err != nil {
				logger.Error("failed to push reolink device", "entityID", entity.Id, "error", err)
				continue
			}

			known[entity.Id] = childEntityID

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			if _, exists := known[entity.Id]; exists {
				logger.Info("discovered device gone, forgetting mapping",
					"discoveredEntity", entity.Id,
					"reolinkEntity", known[entity.Id],
				)
				delete(known, entity.Id)
			}
		}
	}
}
