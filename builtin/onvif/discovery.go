package onvif

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/netscan"
	onvifapi "github.com/projectqai/hydris/pkg/onvif"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func runWSDiscovery(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn("onvif")
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
		discovered := onvifapi.ProbeDevices(ctx, logger)

		var entities []*pb.Entity
		for _, xaddr := range discovered {
			ip := onvifapi.ExtractIPFromXAddr(xaddr)
			if ip == "" {
				continue
			}

			mac := netscan.LookupMAC(ip)
			name := mac
			if name == "" {
				name = strings.NewReplacer(".", "_", ":", "_", "[", "", "]", "").Replace(ip)
			}
			entityID := fmt.Sprintf("%s.device.%s", controllerName, name)

			if _, exists := known[entityID]; exists {
				continue
			}
			known[entityID] = struct{}{}

			entities = append(entities, &pb.Entity{
				Id:    entityID,
				Label: proto.String("ONVIF Camera " + ip),
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
				Classification: &pb.ClassificationComponent{
					Taxonomy: []*pb.ClassificationTaxonomy{{
						Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
							Sensor: &pb.EquipmentTaxonomySensor{Kind: &pb.EquipmentTaxonomySensor_ElectroOptical{ElectroOptical: &pb.EquipmentTaxonomySensorElectroOptical{}}},
						}},
					}},
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
