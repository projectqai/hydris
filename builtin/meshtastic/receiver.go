package meshtastic

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"github.com/projectqai/hydris/builtin/meshtastic/meshpb"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

var meshtasticControllerName = "meshtastic"

func runReceiver(ctx context.Context, logger *slog.Logger, grpcConn *grpc.ClientConn, radio *Radio, trackerID string, radioEntityID string) error {
	client := pb.NewWorldServiceClient(grpcConn)

	var callsignsMu sync.RWMutex
	callsigns := make(map[uint32]string)

	fountain := newFTNReassembler()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		msg, err := radio.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if errors.Is(err, os.ErrDeadlineExceeded) {
				continue // read timed out, retry
			}
			return fmt.Errorf("recv: %w", err)
		}

		debugFromRadio(logger, msg)

		packet, ok := msg.GetMsg().(*meshpb.FromRadio_Packet)
		if !ok {
			if ni, ok := msg.GetMsg().(*meshpb.FromRadio_Node); ok {
				info := ni.Node
				if info == nil {
					continue
				}
				nodeNum := info.GetNum()
				if info.Peer != nil {
					callsignsMu.Lock()
					callsigns[nodeNum] = info.Peer.GetLongName()
					callsignsMu.Unlock()
				}

				if info.Position != nil {
					e := nodeInfoToEntity(info, trackerID, &callsignsMu, callsigns)
					if e != nil {
						if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{e}}); err != nil {
							logger.Error("Push node info entity failed", "error", err)
						} else {
							logger.Info("Pushed node from NodeDB",
								"nodeNum", fmt.Sprintf("!%08x", nodeNum),
								"label", *e.Label,
							)
						}
					}
				}
			}
			continue
		}

		decoded := packet.Packet.GetDecoded()
		if decoded == nil {
			continue
		}

		fromNode := packet.Packet.GetSrc()

		var entities []*pb.Entity

		switch decoded.GetPort() {
		case meshpb.Port_PORT_TAK:
			e, err := handleATAKPlugin(decoded.GetData(), fromNode, trackerID, &callsignsMu, callsigns, logger)
			if err != nil {
				logger.Debug("ATAK_PLUGIN decode error", "error", err, "from", fmt.Sprintf("!%08x", fromNode))
				continue
			}
			if e != nil {
				entities = append(entities, e)
			}

		case meshpb.Port_PORT_TAK_FORWARDER:
			e, err := handleATAKForwarder(decoded.GetData(), fromNode, trackerID, fountain, logger)
			if err != nil {
				logger.Debug("ATAK_FORWARDER decode error", "error", err, "from", fmt.Sprintf("!%08x", fromNode))
				continue
			}
			if e != nil {
				entities = append(entities, e...)
			}

		case meshpb.Port_PORT_POSITION:
			e, err := handlePositionApp(decoded.GetData(), fromNode, trackerID, &callsignsMu, callsigns)
			if err != nil {
				logger.Debug("POSITION_APP decode error", "error", err, "from", fmt.Sprintf("!%08x", fromNode))
				continue
			}
			if e != nil {
				entities = append(entities, e)
			}

		case meshpb.Port_PORT_NODEINFO:
			handleNodeInfoApp(decoded.GetData(), fromNode, &callsignsMu, callsigns, logger)
			continue

		case meshpb.Port_PORT_TELEMETRY:
			var tel meshpb.Telem
			if err := proto.Unmarshal(decoded.GetData(), &tel); err != nil {
				logger.Debug("TELEMETRY_APP unmarshal failed", "error", err, "from", fmt.Sprintf("!%08x", fromNode))
				continue
			}
			if dm := tel.GetDevice(); dm != nil {
				batteryCharge := float32(dm.GetBatteryLevel()) / 100.0
				voltage := float32(dm.GetVoltage())
				entityID := fmt.Sprintf("meshtastic.%08x", fromNode)
				healthEntity := &pb.Entity{
					Id: entityID,
					Controller: &pb.Controller{
						Id: &meshtasticControllerName,
					},
					Power: &pb.PowerComponent{
						BatteryChargeRemaining: &batteryCharge,
						Voltage:                &voltage,
					},
				}
				if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{healthEntity}}); err != nil {
					logger.Error("Push health failed", "error", err, "from", fmt.Sprintf("!%08x", fromNode))
				} else {
					logger.Info("Pushed device health",
						"from", fmt.Sprintf("!%08x", fromNode),
						"battery", dm.GetBatteryLevel(),
						"voltage", dm.GetVoltage(),
					)
				}
			}
			continue

		case meshpb.Port_PORT_HYDRIS:
			e, err := handleHydrisPacket(decoded.GetData(), fromNode, trackerID, logger)
			if err != nil {
				logger.Debug("HYDRIS decode error", "error", err, "from", fmt.Sprintf("!%08x", fromNode))
				continue
			}
			if e != nil {
				entities = append(entities, e...)
			}

		case meshpb.Port_PORT_TEXT:
			callsignsMu.RLock()
			name := callsigns[fromNode]
			callsignsMu.RUnlock()
			if name == "" {
				name = fmt.Sprintf("!%08x", fromNode)
			}
			logger.Info("Mesh text message",
				"from", name,
				"fromNode", fmt.Sprintf("!%08x", fromNode),
				"text", string(decoded.GetData()),
			)
			continue
		}

		// Attach LinkComponent to entities from this packet
		if len(entities) > 0 {
			rssi := packet.Packet.GetRxRssi()
			snr := int32(packet.Packet.GetRxSnr())
			linkStatus := pb.LinkStatus_LinkStatusConnected
			link := &pb.LinkComponent{
				Status:  &linkStatus,
				RssiDbm: &rssi,
				SnrDb:   &snr,
				Via:     &radioEntityID,
			}
			for _, e := range entities {
				e.Link = link
			}
		}

		if len(entities) > 0 {
			_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: entities})
			if err != nil {
				logger.Error("Push to hydris failed", "error", err, "count", len(entities))
			} else {
				logger.Info("Pushed mesh entities", "count", len(entities))
			}
		}
	}
}

func handleNodeInfoApp(payload []byte, fromNode uint32, mu *sync.RWMutex, callsigns map[uint32]string, logger *slog.Logger) {
	var user meshpb.Peer
	if err := proto.Unmarshal(payload, &user); err != nil {
		logger.Debug("NODEINFO unmarshal error", "error", err)
		return
	}

	name := user.GetLongName()
	if name == "" {
		return
	}

	mu.Lock()
	callsigns[fromNode] = name
	mu.Unlock()

	logger.Debug("Updated callsign",
		"nodeNum", fmt.Sprintf("!%08x", fromNode),
		"name", name,
	)
}
