package lora

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net"
	"slices"
	"sync/atomic"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultListenAddress = "127.0.0.1:1700"
	captureTTL           = 5 * time.Second
	dropLogInterval      = 10 * time.Second
	frameHeaderSize      = 1
	captureContentType   = "application/vnd.hydris.lora-frame"
)

// CaptureEntity records one received frame, whatever its port, for decoder
// plugins to pick up; it stays local (no Routing) and expires quickly.
func CaptureEntity(gatewayID string, port byte, payload []byte, rssi, lsnr *float64, now time.Time) *pb.Entity {
	sum := sha256.Sum256(append([]byte{port}, payload...))
	return &pb.Entity{
		Id:         gatewayID + ".rx." + hex.EncodeToString(sum[:6]),
		Controller: &pb.Controller{Id: proto.String(controllerName), Origin: proto.String(gatewayID)},
		Capture: &pb.CaptureComponent{
			Payload:     payload,
			Port:        proto.Uint32(uint32(port)),
			ContentType: proto.String(captureContentType),
			CapturedBy:  proto.String(gatewayID),
			CapturedAt:  timestamppb.New(now),
		},
		Link: linkFrom(rssi, lsnr, gatewayID),
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(now),
			Until: timestamppb.New(now.Add(captureTTL)),
		},
	}
}

func decodeFrame(frame []byte) (port byte, rest []byte, ok bool) {
	if len(frame) < frameHeaderSize {
		return 0, nil, false
	}
	return frame[0], frame[frameHeaderSize:], true
}

const (
	gwmpPushData = 0x00
	gwmpPushAck  = 0x01
	gwmpPullData = 0x02
	gwmpPullAck  = 0x04
)

type gwmpPacket struct {
	version uint8
	token   [2]byte
	kind    uint8
	body    []byte // JSON payload, for PUSH_DATA only
}

func parseGWMP(b []byte) (gwmpPacket, error) {
	if len(b) < 4 {
		return gwmpPacket{}, fmt.Errorf("packet shorter than the GWMP header: %d bytes", len(b))
	}
	p := gwmpPacket{version: b[0], kind: b[3]}
	copy(p.token[:], b[1:3])
	if p.kind == gwmpPushData || p.kind == gwmpPullData {
		if len(b) < 12 {
			return gwmpPacket{}, fmt.Errorf("packet shorter than the GWMP gateway-EUI header: %d bytes", len(b))
		}
		p.body = b[12:]
	}
	return p, nil
}

func (p gwmpPacket) ack(kind uint8) []byte {
	return []byte{p.version, p.token[0], p.token[1], kind}
}

func (p gwmpPacket) reply() []byte {
	switch p.kind {
	case gwmpPushData:
		return p.ack(gwmpPushAck)
	case gwmpPullData:
		return p.ack(gwmpPullAck)
	}
	return nil
}

func cfgString(cfg *structpb.Struct, key string) string {
	if cfg == nil {
		return ""
	}
	if v, ok := cfg.Fields[key]; ok {
		return v.GetStringValue()
	}
	return ""
}

func linkFrom(rssi, lsnr *float64, via string) *pb.LinkComponent {
	link := &pb.LinkComponent{Status: pb.LinkStatus_LinkStatusConnected.Enum()}
	if rssi != nil {
		link.RssiDbm = proto.Int32(int32(*rssi))
	}
	if lsnr != nil {
		link.SnrDb = proto.Int32(int32(math.Round(*lsnr)))
	}
	if via != "" {
		link.Via = proto.String(via)
	}
	return link
}

func runInstance(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg := entity.Config.GetValue()
	listenAddress := defaultListenAddress
	if v := cfgString(cfg, "listen_address"); v != "" {
		listenAddress = v
	}
	grpcConn, err := builtin.BuiltinClientConn(controllerName)
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	pushState := func(ctx context.Context, state pb.DeviceState) {
		dev := &pb.DeviceComponent{State: state}
		if entity.Device != nil {
			dev = proto.Clone(entity.Device).(*pb.DeviceComponent)
			dev.State = state
		}
		_ = controller.Push(ctx, controllerName, &pb.Entity{
			Id:         entity.Id,
			Controller: &pb.Controller{Id: proto.String(controllerName)},
			Device:     dev,
		})
	}

	conn, err := net.ListenPacket("udp", listenAddress)
	if err != nil {
		return fmt.Errorf("listen udp %s: %w", listenAddress, err)
	}
	defer func() { _ = conn.Close() }()
	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		pushState(shutdownCtx, pb.DeviceState_DeviceStatePending)
	}()

	pushState(ctx, pb.DeviceState_DeviceStateActive)
	ready()

	var uplinksReceived atomic.Uint64
	limiter := newPeerLimiter()
	var dropped int
	var droppedLogged time.Time
	buf := make([]byte, 65507)
	for {
		n, raddr, err := conn.ReadFrom(buf)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("gwmp read: %w", err)
		}

		pkt, err := parseGWMP(buf[:n])
		if err != nil {
			logger.Warn("gwmp: dropping malformed packet", "peer", raddr, "error", err)
			continue
		}
		if reply := pkt.reply(); reply != nil {
			if _, err := conn.WriteTo(reply, raddr); err != nil {
				logger.Warn("gwmp: ack failed", "peer", raddr, "kind", reply[3], "error", err)
			}
		}
		if pkt.kind != gwmpPushData {
			continue
		}

		entities := decodePushData(pkt.body, entity.Id)
		now := time.Now()
		peer := peerAddr(raddr)
		decoded := len(entities)
		entities = slices.DeleteFunc(entities, func(*pb.Entity) bool { return !limiter.allow(peer, now) })
		if dropped += decoded - len(entities); dropped > 0 && now.Sub(droppedLogged) >= dropLogInterval {
			logger.Warn("gwmp: rate limit exceeded, dropping frames", "peer", raddr, "dropped", dropped)
			dropped, droppedLogged = 0, now
		}
		if len(entities) == 0 {
			continue
		}
		count := uplinksReceived.Add(1)
		metric := &pb.Entity{
			Id: entity.Id,
			Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
				{
					Kind:  pb.MetricKind_MetricKindCount.Enum(),
					Unit:  pb.MetricUnit_MetricUnitCount,
					Label: proto.String("uplinks received"),
					Id:    proto.Uint32(1),
					Val:   &pb.Metric_Uint64{Uint64: count},
				},
			}},
		}
		if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: append(entities, metric)}); err != nil {
			logger.Error("push lora entity failed", "error", err)
		}
	}
}

func decodePushData(body []byte, gatewayID string) []*pb.Entity {
	var pushData struct {
		Rxpk []struct {
			Data string   `json:"data"`
			Rssi *float64 `json:"rssi"`
			Lsnr *float64 `json:"lsnr"`
			Stat int      `json:"stat"`
		} `json:"rxpk"`
	}
	if err := json.Unmarshal(body, &pushData); err != nil {
		return nil
	}

	var entities []*pb.Entity
	for _, rxpk := range pushData.Rxpk {
		if rxpk.Stat != 1 {
			continue
		}
		if len(rxpk.Data) > base64.StdEncoding.EncodedLen(maxFrameSize) {
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(rxpk.Data)
		if err != nil {
			continue
		}
		port, rest, ok := decodeFrame(raw)
		if !ok {
			continue
		}
		entities = append(entities, CaptureEntity(gatewayID, port, rest, rxpk.Rssi, rxpk.Lsnr, time.Now()))
	}
	return entities
}
