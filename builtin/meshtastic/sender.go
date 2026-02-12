package meshtastic

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sync/atomic"
	"time"

	"github.com/projectqai/hydris/builtin/meshtastic/meshpb"
	"github.com/projectqai/hydris/cot"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

const (
	maxPayloadSize = 231
	broadcastNum   = 0xFFFFFFFF
)

var xferIDCounter uint32

func runSender(ctx context.Context, logger *slog.Logger, grpcConn *grpc.ClientConn, radio *Radio, channel, hopLimit uint32, sendFormat string, localNodeID string) error {
	client := pb.NewWorldServiceClient(grpcConn)

	// Send announce for CoT mode so TAK clients see us.
	if sendFormat == "cot" {
		announce := &meshpb.ToRadio{
			Msg: &meshpb.ToRadio_Packet{
				Packet: &meshpb.Packet{
					Dst:      broadcastNum,
					Ch:       channel,
					HopLimit: hopLimit,
					Id:       rand.Uint32(),
					Body: &meshpb.Packet_Decoded{
						Decoded: &meshpb.Payload{
							Data: []byte("Hydris online"),
							Port: meshpb.Port_PORT_TEXT,
						},
					},
				},
			},
		}
		if err := radio.Send(announce); err != nil {
			logger.Warn("Failed to send announce", "error", err)
		}
	}

	maxRateHz := float32(10)
	keepaliveMs := uint32(10 * 60 * 1000)
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Behaviour: &pb.WatchBehavior{
			MaxRateHz:           &maxRateHz,
			KeepaliveIntervalMs: &keepaliveMs,
		},
	})
	if err != nil {
		return fmt.Errorf("watch entities: %w", err)
	}

	logger.Info("Sender started", "maxRateHz", maxRateHz, "format", sendFormat)

	for {
		event, err := stream.Recv()
		if err != nil {
			return fmt.Errorf("recv: %w", err)
		}

		entity := event.Entity
		if entity == nil {
			continue
		}

		// Only send entities owned by the local node.
		if entity.Controller == nil || entity.Controller.GetNode() != localNodeID {
			continue
		}

		// Handle delete/expiry (only relevant for cot format)
		if event.T == pb.EntityChange_EntityChangeExpired {
			if sendFormat == "cot" {
				logger.Info("Sending delete to mesh", "entityID", entity.Id)
				if err := sendDeleteCoT(ctx, logger, radio, entity, channel, hopLimit); err != nil {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					logger.Error("Failed to send forcedelete to mesh", "entityID", entity.Id, "error", err)
				}
			}
			continue
		}

		// Need geo
		if entity.Geo == nil {
			continue
		}

		logger.Info("Sending entity to mesh", "entityID", entity.Id,
			"controller", entity.Controller.GetId(),
			"lat", entity.Geo.Latitude,
			"lon", entity.Geo.Longitude,
			"format", sendFormat,
		)

		var sendErr error
		switch sendFormat {
		case "cot":
			sendErr = sendEntityAsCoT(ctx, logger, radio, entity, channel, hopLimit)
		case "pli":
			sendErr = sendEntityAsPLI(ctx, logger, radio, entity, channel, hopLimit)
		case "hydris":
			sendErr = sendEntityAsHydris(ctx, logger, radio, entity, channel, hopLimit)
		}
		if sendErr != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			logger.Error("Failed to send to mesh", "entityID", entity.Id, "error", sendErr)
			continue
		}
	}
}

func sendEntityAsCoT(ctx context.Context, logger *slog.Logger, radio *Radio, entity *pb.Entity, channel, hopLimit uint32) error {
	cotXML, err := cot.EntityToCoT(entity)
	if err != nil {
		return fmt.Errorf("entity to CoT: %w", err)
	}
	if cotXML == nil {
		return fmt.Errorf("entity produced nil CoT")
	}

	logger.Info("CoT XML outbound", "entityID", entity.Id, "xml", string(cotXML))

	compressed, err := zlibCompress(cotXML)
	if err != nil {
		return fmt.Errorf("zlib compress: %w", err)
	}

	data := make([]byte, 1+len(compressed))
	data[0] = transferTypeCot
	copy(data[1:], compressed)

	transferID := int(atomic.AddUint32(&xferIDCounter, 1)) & 0xFFFFFF
	packets := ftnEncode(data, transferID)

	logger.Info("Sending CoT via fountain",
		"entityID", entity.Id,
		"cotLen", len(cotXML),
		"compressedLen", len(compressed),
		"packets", len(packets),
		"transferID", transferID,
	)

	return sendPackets(ctx, radio, packets, meshpb.Port_PORT_TAK_FORWARDER, channel, hopLimit)
}

func sendEntityAsPLI(ctx context.Context, logger *slog.Logger, radio *Radio, entity *pb.Entity, channel, hopLimit uint32) error {
	callsign := entity.Id
	if entity.Label != nil && *entity.Label != "" {
		callsign = *entity.Label
	}

	pli := &meshpb.TAKPLI{
		LatI: int32(entity.Geo.Latitude * 1e7),
		LonI: int32(entity.Geo.Longitude * 1e7),
	}
	if entity.Geo.Altitude != nil {
		pli.Alt = int32(*entity.Geo.Altitude)
	}

	tp := &meshpb.TAKPacket{
		Contact: &meshpb.TAKContact{
			Callsign:       callsign,
			DeviceCallsign: entity.Id,
		},
		Body: &meshpb.TAKPacket_Pli{Pli: pli},
	}

	data, err := proto.Marshal(tp)
	if err != nil {
		return fmt.Errorf("marshal TAKPacket: %w", err)
	}

	logger.Info("PLI outbound", "entityID", entity.Id, "callsign", callsign, "len", len(data))

	toRadio := &meshpb.ToRadio{
		Msg: &meshpb.ToRadio_Packet{
			Packet: &meshpb.Packet{
				Dst:      broadcastNum,
				Ch:       channel,
				HopLimit: hopLimit,
				Id:       rand.Uint32(),
				WantAck:  false,
				Body: &meshpb.Packet_Decoded{
					Decoded: &meshpb.Payload{
						Data: data,
						Port: meshpb.Port_PORT_TAK,
					},
				},
			},
		},
	}

	return radio.Send(toRadio)
}

const (
	hydrisFlagGzip   = 1 << 0
	hydrisTypeEntity = 0 << 1
	hydrisTypeMask   = 0b00001110
)

func sendEntityAsHydris(ctx context.Context, logger *slog.Logger, radio *Radio, entity *pb.Entity, channel, hopLimit uint32) error {
	raw, err := proto.Marshal(entity)
	if err != nil {
		return fmt.Errorf("marshal entity: %w", err)
	}

	// Try zlib — use whichever is smaller.
	flags := byte(hydrisTypeEntity)
	payload := raw
	if compressed, err := zlibCompress(raw); err == nil && len(compressed) < len(raw) {
		flags |= hydrisFlagGzip
		payload = compressed
	}

	data := make([]byte, 1+len(payload))
	data[0] = flags
	copy(data[1:], payload)

	if len(data) > maxPayloadSize {
		logger.Warn("Entity too large for single mesh packet, dropping",
			"entityID", entity.Id, "len", len(data), "max", maxPayloadSize)
		return nil
	}

	logger.Info("Hydris proto outbound", "entityID", entity.Id,
		"rawLen", len(raw), "wireLen", len(data), "gzip", flags&hydrisFlagGzip != 0)

	toRadio := &meshpb.ToRadio{
		Msg: &meshpb.ToRadio_Packet{
			Packet: &meshpb.Packet{
				Dst:      broadcastNum,
				Ch:       channel,
				HopLimit: hopLimit,
				Id:       rand.Uint32(),
				WantAck:  false,
				Body: &meshpb.Packet_Decoded{
					Decoded: &meshpb.Payload{
						Data: data,
						Port: meshpb.Port_PORT_HYDRIS,
					},
				},
			},
		},
	}
	return radio.Send(toRadio)
}

func sendDeleteCoT(ctx context.Context, logger *slog.Logger, radio *Radio, entity *pb.Entity, channel, hopLimit uint32) error {
	cotXML, err := cot.EntityDeleteCoT(entity)
	if err != nil {
		return fmt.Errorf("entity delete CoT: %w", err)
	}

	logger.Info("CoT XML delete outbound", "entityID", entity.Id, "xml", string(cotXML))

	compressed, err := zlibCompress(cotXML)
	if err != nil {
		return fmt.Errorf("zlib compress: %w", err)
	}

	data := make([]byte, 1+len(compressed))
	data[0] = transferTypeCot
	copy(data[1:], compressed)

	transferID := int(atomic.AddUint32(&xferIDCounter, 1)) & 0xFFFFFF
	packets := ftnEncode(data, transferID)

	return sendPackets(ctx, radio, packets, meshpb.Port_PORT_TAK_FORWARDER, channel, hopLimit)
}

// sendPackets sends multiple fountain-encoded packets with pacing.
func sendPackets(ctx context.Context, radio *Radio, packets [][]byte, port meshpb.Port, channel, hopLimit uint32) error {
	for _, pkt := range packets {
		toRadio := &meshpb.ToRadio{
			Msg: &meshpb.ToRadio_Packet{
				Packet: &meshpb.Packet{
					Dst:      broadcastNum,
					Ch:       channel,
					HopLimit: hopLimit,
					Id:       rand.Uint32(),
					WantAck:  false,
					Body: &meshpb.Packet_Decoded{
						Decoded: &meshpb.Payload{
							Data: pkt,
							Port: port,
						},
					},
				},
			},
		}

		if err := radio.Send(toRadio); err != nil {
			return fmt.Errorf("send FTN block: %w", err)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}

	return nil
}
