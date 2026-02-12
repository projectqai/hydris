package meshtastic

import (
	"context"
	"encoding/hex"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin/meshtastic/meshpb"
	"github.com/projectqai/hydris/cot"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
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

func handleATAKPlugin(payload []byte, fromNode uint32, trackerID string, mu *sync.RWMutex, callsigns map[uint32]string, logger *slog.Logger) (*pb.Entity, error) {
	var tp meshpb.TAKPacket
	if err := proto.Unmarshal(payload, &tp); err != nil {
		return nil, fmt.Errorf("unmarshal TAKPacket: %w", err)
	}

	if chat := tp.GetChat(); chat != nil {
		callsign := ""
		if tp.Contact != nil {
			callsign = tp.Contact.GetCallsign()
		}
		if callsign == "" {
			mu.RLock()
			callsign = callsigns[fromNode]
			mu.RUnlock()
		}
		if callsign == "" {
			callsign = fmt.Sprintf("!%08x", fromNode)
		}
		logger.Info("Mesh GeoChat",
			"from", callsign,
			"fromNode", fmt.Sprintf("!%08x", fromNode),
			"to", chat.GetTo(),
			"message", chat.GetMessage(),
		)
		return nil, nil
	}

	pli := tp.GetPli()
	if pli == nil {
		return nil, nil
	}

	lat := float64(pli.GetLatI()) * 1e-7
	lon := float64(pli.GetLonI()) * 1e-7
	alt := float64(pli.GetAlt())

	contact := tp.GetContact()
	callsign := contact.GetCallsign()
	deviceCallsign := contact.GetDeviceCallsign()

	entityID := fmt.Sprintf("meshtastic.%s", deviceCallsign)
	if deviceCallsign == "" {
		entityID = fmt.Sprintf("meshtastic.%08x", fromNode)
	}

	label := callsign
	if label == "" {
		mu.RLock()
		label = callsigns[fromNode]
		mu.RUnlock()
	}
	if label == "" {
		label = fmt.Sprintf("!%08x", fromNode)
	}

	now := time.Now()
	stale := now.Add(10 * time.Minute)
	sidc := "SFGPU----------"

	return &pb.Entity{
		Id:    entityID,
		Label: &label,
		Geo: &pb.GeoSpatialComponent{
			Latitude:  lat,
			Longitude: lon,
			Altitude:  &alt,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: sidc,
		},
		Controller: &pb.Controller{
			Id: &meshtasticControllerName,
		},
		Track: &pb.TrackComponent{
			Tracker: &trackerID,
		},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(now),
			Until: timestamppb.New(stale),
		},
	}, nil
}

func handleATAKForwarder(payload []byte, fromNode uint32, trackerID string, fountain *ftnReassembler, logger *slog.Logger) ([]*pb.Entity, error) {
	if !isFTNPacket(payload) {
		return nil, fmt.Errorf("not a FTN packet")
	}

	block, err := parseFTNDataBlock(payload)
	if err != nil {
		return nil, fmt.Errorf("parse FTN block: %w", err)
	}

	logger.Debug("ATAK_FORWARDER FTN block",
		"from", fmt.Sprintf("!%08x", fromNode),
		"xferID", block.transferID,
		"seed", block.seed,
		"K", block.sourceBlockCount,
		"totalLen", block.totalLength,
		"payloadLen", len(block.payload),
	)

	cotXML, complete := fountain.addBlock(block)
	if !complete {
		return nil, nil
	}

	logger.Info("ATAK_FORWARDER fountain reassembly complete",
		"from", fmt.Sprintf("!%08x", fromNode),
		"xferID", block.transferID,
		"cotLen", len(cotXML),
		"cotXML", string(cotXML),
	)

	entity, err := cot.CoTToEntity(cotXML, "meshtastic", trackerID)
	if err != nil {
		return nil, fmt.Errorf("CoT to entity: %w", err)
	}
	if entity == nil {
		logger.Warn("ATAK_FORWARDER CoTToEntity returned nil")
		return nil, nil
	}

	entity.Id = fmt.Sprintf("meshtastic.%s", entity.Id)
	entity.Controller = &pb.Controller{
		Id: &meshtasticControllerName,
	}
	entity.Track = &pb.TrackComponent{
		Tracker: &trackerID,
	}

	var lat, lon float64
	var alt float64
	if entity.Geo != nil {
		lat = entity.Geo.Latitude
		lon = entity.Geo.Longitude
		if entity.Geo.Altitude != nil {
			alt = *entity.Geo.Altitude
		}
	}
	label := ""
	if entity.Label != nil {
		label = *entity.Label
	}
	sidc := ""
	if entity.Symbol != nil {
		sidc = entity.Symbol.MilStd2525C
	}
	logger.Info("ATAK_FORWARDER entity created",
		"id", entity.Id,
		"label", label,
		"lat", lat,
		"lon", lon,
		"alt", alt,
		"sidc", sidc,
		"hasLifetime", entity.Lifetime != nil,
	)

	return []*pb.Entity{entity}, nil
}

func handlePositionApp(payload []byte, fromNode uint32, trackerID string, mu *sync.RWMutex, callsigns map[uint32]string) (*pb.Entity, error) {
	var pos meshpb.Pos
	if err := proto.Unmarshal(payload, &pos); err != nil {
		return nil, fmt.Errorf("unmarshal Position: %w", err)
	}

	lat := float64(pos.GetLatI()) * 1e-7
	lon := float64(pos.GetLonI()) * 1e-7
	alt := float64(pos.GetAlt())

	if lat == 0 && lon == 0 {
		return nil, nil
	}

	entityID := fmt.Sprintf("meshtastic.%08x", fromNode)

	mu.RLock()
	label := callsigns[fromNode]
	mu.RUnlock()
	if label == "" {
		label = fmt.Sprintf("!%08x", fromNode)
	}

	now := time.Now()
	stale := now.Add(10 * time.Minute)
	sidc := "SUGPU----------"

	return &pb.Entity{
		Id:    entityID,
		Label: &label,
		Geo: &pb.GeoSpatialComponent{
			Latitude:  lat,
			Longitude: lon,
			Altitude:  &alt,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: sidc,
		},
		Controller: &pb.Controller{
			Id: &meshtasticControllerName,
		},
		Track: &pb.TrackComponent{
			Tracker: &trackerID,
		},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(now),
			Until: timestamppb.New(stale),
		},
	}, nil
}

func nodeInfoToEntity(info *meshpb.NodeEntry, trackerID string, mu *sync.RWMutex, callsigns map[uint32]string) *pb.Entity {
	pos := info.Position
	lat := float64(pos.GetLatI()) * 1e-7
	lon := float64(pos.GetLonI()) * 1e-7
	if lat == 0 && lon == 0 {
		return nil
	}
	alt := float64(pos.GetAlt())

	nodeNum := info.GetNum()
	entityID := fmt.Sprintf("meshtastic.%08x", nodeNum)

	mu.RLock()
	label := callsigns[nodeNum]
	mu.RUnlock()
	if label == "" {
		label = fmt.Sprintf("!%08x", nodeNum)
	}

	now := time.Now()
	stale := now.Add(10 * time.Minute)
	sidc := "SUGPU----------"

	return &pb.Entity{
		Id:    entityID,
		Label: &label,
		Geo: &pb.GeoSpatialComponent{
			Latitude:  lat,
			Longitude: lon,
			Altitude:  &alt,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: sidc,
		},
		Controller: &pb.Controller{
			Id: &meshtasticControllerName,
		},
		Track: &pb.TrackComponent{
			Tracker: &trackerID,
		},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(now),
			Until: timestamppb.New(stale),
		},
	}
}

func debugFromRadio(logger *slog.Logger, msg *meshpb.FromRadio) {
	switch v := msg.GetMsg().(type) {
	case *meshpb.FromRadio_Packet:
		p := v.Packet
		decoded := p.GetDecoded()
		if decoded != nil {
			portName := decoded.GetPort().String()
			logger.Debug("FromRadio packet",
				"from", fmt.Sprintf("!%08x", p.GetSrc()),
				"to", fmt.Sprintf("!%08x", p.GetDst()),
				"id", p.GetId(),
				"channel", p.GetCh(),
				"hopLimit", p.GetHopLimit(),
				"hopStart", p.GetHopStart(),
				"rxSnr", p.GetRxSnr(),
				"rxRssi", p.GetRxRssi(),
				"port", portName,
				"payloadLen", len(decoded.GetData()),
				"payloadHex", hex.EncodeToString(decoded.GetData()),
			)
			debugDecodedPayload(logger, decoded)
		} else if enc := p.GetEncrypted(); len(enc) > 0 {
			logger.Debug("FromRadio encrypted packet",
				"from", fmt.Sprintf("!%08x", p.GetSrc()),
				"to", fmt.Sprintf("!%08x", p.GetDst()),
				"id", p.GetId(),
				"channel", p.GetCh(),
				"encLen", len(enc),
			)
		}
	case *meshpb.FromRadio_Self:
		logger.Debug("FromRadio MyInfo",
			"myNodeNum", fmt.Sprintf("!%08x", v.Self.GetNodeNum()),
		)
	case *meshpb.FromRadio_Node:
		info := v.Node
		attrs := []any{
			"num", fmt.Sprintf("!%08x", info.GetNum()),
			"lastHeard", info.GetLastHeard(),
		}
		if info.Peer != nil {
			attrs = append(attrs,
				"longName", info.Peer.GetLongName(),
				"shortName", info.Peer.GetShortName(),
				"macaddr", info.Peer.GetMac(),
				"hwModel", info.Peer.GetHw(),
			)
		}
		if info.Position != nil {
			attrs = append(attrs,
				"lat", float64(info.Position.GetLatI())*1e-7,
				"lon", float64(info.Position.GetLonI())*1e-7,
				"alt", info.Position.GetAlt(),
			)
		}
		logger.Debug("FromRadio NodeInfo", attrs...)
	case *meshpb.FromRadio_Config:
		logger.Debug("FromRadio Config", "config", fmt.Sprintf("%T", v.Config.GetSection()))
	case *meshpb.FromRadio_ModConfig:
		logger.Debug("FromRadio ModuleConfig", "config", fmt.Sprintf("%T", v.ModConfig.GetSection()))
	case *meshpb.FromRadio_Channel:
		ch := v.Channel
		logger.Debug("FromRadio Channel",
			"index", ch.GetIndex(),
			"role", ch.GetRole(),
		)
	case *meshpb.FromRadio_ConfigCompleteId:
		logger.Debug("FromRadio ConfigComplete", "id", v.ConfigCompleteId)
	case *meshpb.FromRadio_Log:
		logger.Debug("FromRadio Log", "message", v.Log.GetMessage(), "level", v.Log.GetLevel())
	case *meshpb.FromRadio_Queue:
		logger.Debug("FromRadio QueueStatus",
			"free", v.Queue.GetFree(),
			"maxlen", v.Queue.GetMaxlen(),
		)
	default:
		logger.Debug("FromRadio unknown variant", "type", fmt.Sprintf("%T", v))
	}
}

func debugDecodedPayload(logger *slog.Logger, decoded *meshpb.Payload) {
	payload := decoded.GetData()
	switch decoded.GetPort() {
	case meshpb.Port_PORT_TAK:
		var tp meshpb.TAKPacket
		if err := proto.Unmarshal(payload, &tp); err != nil {
			logger.Debug("  ATAK_PLUGIN unmarshal failed", "error", err)
			return
		}
		attrs := []any{}
		if tp.Contact != nil {
			attrs = append(attrs, "callsign", tp.Contact.GetCallsign(), "deviceCallsign", tp.Contact.GetDeviceCallsign())
		}
		if tp.Group != nil {
			attrs = append(attrs, "role", tp.Group.GetRole(), "team", tp.Group.GetTeam())
		}
		if tp.Status != nil {
			attrs = append(attrs, "battery", tp.Status.GetBattery())
		}
		if pli := tp.GetPli(); pli != nil {
			attrs = append(attrs,
				"variant", "PLI",
				"lat", float64(pli.GetLatI())*1e-7,
				"lon", float64(pli.GetLonI())*1e-7,
				"alt", pli.GetAlt(),
				"speed", pli.GetSpeed(),
				"course", pli.GetCourse(),
			)
		} else if chat := tp.GetChat(); chat != nil {
			attrs = append(attrs,
				"variant", "GeoChat",
				"message", chat.GetMessage(),
				"to", chat.GetTo(),
			)
		} else {
			attrs = append(attrs, "variant", "unknown")
		}
		logger.Debug("  ATAK_PLUGIN decoded", attrs...)

	case meshpb.Port_PORT_POSITION:
		var pos meshpb.Pos
		if err := proto.Unmarshal(payload, &pos); err != nil {
			logger.Debug("  POSITION_APP unmarshal failed", "error", err)
			return
		}
		logger.Debug("  POSITION_APP decoded",
			"lat", float64(pos.GetLatI())*1e-7,
			"lon", float64(pos.GetLonI())*1e-7,
			"alt", pos.GetAlt(),
			"time", pos.GetTime(),
			"satsInView", pos.GetSats(),
		)

	case meshpb.Port_PORT_NODEINFO:
		var user meshpb.Peer
		if err := proto.Unmarshal(payload, &user); err != nil {
			logger.Debug("  NODEINFO_APP unmarshal failed", "error", err)
			return
		}
		logger.Debug("  NODEINFO_APP decoded",
			"longName", user.GetLongName(),
			"shortName", user.GetShortName(),
			"hwModel", user.GetHw(),
			"role", user.GetRole(),
		)

	case meshpb.Port_PORT_TEXT:
		logger.Debug("  TEXT_MESSAGE_APP decoded", "text", string(payload))

	case meshpb.Port_PORT_TELEMETRY:
		var tel meshpb.Telem
		if err := proto.Unmarshal(payload, &tel); err != nil {
			logger.Debug("  TELEMETRY_APP unmarshal failed", "error", err)
			return
		}
		if dm := tel.GetDevice(); dm != nil {
			logger.Debug("  TELEMETRY_APP DeviceMetrics",
				"batteryLevel", dm.GetBatteryLevel(),
				"voltage", dm.GetVoltage(),
				"channelUtilization", dm.GetChUtil(),
				"airUtilTx", dm.GetAirUtilTx(),
				"uptimeSeconds", dm.GetUptime(),
			)
		} else {
			logger.Debug("  TELEMETRY_APP decoded", "variant", fmt.Sprintf("%T", tel.GetReading()))
		}

	case meshpb.Port_PORT_TAK_FORWARDER:
		if isFTNPacket(payload) {
			block, err := parseFTNDataBlock(payload)
			if err != nil {
				logger.Debug("  ATAK_FORWARDER FTN parse failed", "error", err)
				return
			}
			logger.Debug("  ATAK_FORWARDER FTN block",
				"xferID", block.transferID,
				"seed", block.seed,
				"K", block.sourceBlockCount,
				"totalLen", block.totalLength,
				"payloadLen", len(block.payload),
			)
		} else {
			logger.Debug("  ATAK_FORWARDER non-FTN", "len", len(payload), "hex", hex.EncodeToString(payload))
		}

	default:
		logger.Debug("  payload not decoded", "port", decoded.GetPort().String(), "len", len(payload))
	}
}

func handleHydrisPacket(payload []byte, fromNode uint32, trackerID string, logger *slog.Logger) ([]*pb.Entity, error) {
	if len(payload) < 2 {
		return nil, fmt.Errorf("too short: %d", len(payload))
	}

	flags := payload[0]
	body := payload[1:]

	if flags&hydrisFlagGzip != 0 {
		decompressed, err := zlibDecompress(body)
		if err != nil {
			return nil, fmt.Errorf("decompress: %w", err)
		}
		body = decompressed
	}

	msgType := flags & hydrisTypeMask

	switch msgType {
	case hydrisTypeEntity:
		var entity pb.Entity
		if err := proto.Unmarshal(body, &entity); err != nil {
			return nil, fmt.Errorf("unmarshal entity: %w", err)
		}

		entity.Id = fmt.Sprintf("meshtastic.%s", entity.Id)

		logger.Info("HYDRIS entity received",
			"from", fmt.Sprintf("!%08x", fromNode),
			"entityID", entity.Id,
			"controller.id", entity.Controller.GetId(),
			"controller.node", entity.Controller.GetNode(),
		)

		return []*pb.Entity{&entity}, nil
	default:
		logger.Debug("HYDRIS unknown message type", "type", msgType, "from", fmt.Sprintf("!%08x", fromNode))
		return nil, nil
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
