package meshtastic

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin/meshtastic/meshpb"
	"github.com/projectqai/hydris/pkg/cot"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func handleATAKPlugin(ctx context.Context, payload []byte, fromNode uint32, rxTime uint32, trackerID string, mu *sync.RWMutex, callsigns map[uint32]string, client pb.WorldServiceClient, logger *slog.Logger) (*pb.Entity, error) {
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

		now := time.Now()
		senderEntityID := fmt.Sprintf("meshtastic.%08x", fromNode)
		chatEntityID := fmt.Sprintf("meshtastic.chat.%08x.%d", fromNode, now.UnixNano())

		fromTime := now
		if rxTime > 0 {
			fromTime = time.Unix(int64(rxTime), 0)
		}

		entity := &pb.Entity{
			Id:      chatEntityID,
			Label:   &callsign,
			Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
			Controller: &pb.Controller{
				Id:     &meshtasticControllerName,
				Origin: &trackerID,
			},
			Track: &pb.TrackComponent{
				Tracker: &trackerID,
			},
			Chat: &pb.ChatComponent{
				Sender:  &senderEntityID,
				To:      proto.String(chat.GetTo()),
				Message: chat.GetMessage(),
			},
			Lifetime: &pb.Lifetime{
				From:  timestamppb.New(fromTime),
				Until: timestamppb.New(fromTime.Add(3 * time.Hour)),
				Fresh: timestamppb.New(now),
			},
		}

		// Snapshot sender's position if known
		if resp, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: senderEntityID}); err == nil && resp.Entity != nil && resp.Entity.Geo != nil {
			entity.Geo = resp.Entity.Geo
		}

		return entity, nil
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
		Id:      entityID,
		Label:   &label,
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
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
	entity.Routing = &pb.Routing{Channels: []*pb.Channel{{}}}
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
	sidc := "SFGPU----------"

	return &pb.Entity{
		Id:      entityID,
		Label:   &label,
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
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
	sidc := "SFGPU----------"

	return &pb.Entity{
		Id:      entityID,
		Label:   &label,
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
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
