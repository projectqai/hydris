package engine

import (
	"context"
	"log/slog"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"
	"github.com/projectqai/hydris/pkg/timesync"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type peerEntityKeyType struct{}

var peerEntityKey peerEntityKeyType

type builtinNameKeyType struct{}

var builtinNameKey builtinNameKeyType

type builtinConnKeyType struct{}

var builtinConnKey builtinConnKeyType

func BuiltinConnContext(ctx context.Context, _ net.Conn) context.Context {
	return context.WithValue(ctx, builtinConnKey, true)
}

type peerConn struct {
	entityID  string
	pushCount atomic.Uint64
	ts        timesync.Tracker
	prevT1Us  atomic.Int64 // previous exchange T1 (unix microseconds)
	prevT2Us  atomic.Int64 // previous exchange T2 (unix microseconds)
	prevT3Us  atomic.Int64 // previous exchange T3 (unix microseconds)
}

type trackedConn struct {
	net.Conn
	once   sync.Once
	closed chan struct{}
}

func (c *trackedConn) Close() error {
	c.once.Do(func() { close(c.closed) })
	return c.Conn.Close()
}

type trackingListener struct {
	net.Listener
}

func (l *trackingListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &trackedConn{Conn: c, closed: make(chan struct{})}, nil
}

func (s *WorldServer) ConnContext(ctx context.Context, c net.Conn) context.Context {
	peer := parsePeer(c.RemoteAddr().String())
	if peer.local {
		return ctx
	}

	slog.Info("remote connection", "addr", c.RemoteAddr())

	tc, _ := c.(*trackedConn)

	pc := &peerConn{entityID: "conn." + peer.address + ":" + peer.port}
	host := peer.address
	port, _ := strconv.ParseUint(peer.port, 10, 32)
	portU32 := uint32(port)
	nodeEntityID := s.nodeEntity.GetId()

	pushConn := func() {
		now := time.Now()
		pushes := pc.pushCount.Load()
		offset := pc.ts.Offset()
		rtt := pc.ts.RTT()
		avgRTT := pc.ts.AvgRTT()

		metrics := []*pb.Metric{
			{
				Kind:  pb.MetricKind_MetricKindCount.Enum(),
				Unit:  pb.MetricUnit_MetricUnitCount,
				Label: proto.String("Received pushes"),
				Id:    proto.Uint32(1),
				Val:   &pb.Metric_Uint64{Uint64: pushes},
			},
		}
		if offset != 0 {
			metrics = append(metrics, &pb.Metric{
				Kind:  pb.MetricKind_MetricKindDuration.Enum(),
				Unit:  pb.MetricUnit_MetricUnitMillisecond,
				Label: proto.String("Clock offset"),
				Id:    proto.Uint32(2),
				Val:   &pb.Metric_Float{Float: float32(offset.Microseconds()) / 1000},
			})
		}
		if rtt != 0 {
			metrics = append(metrics, &pb.Metric{
				Kind:  pb.MetricKind_MetricKindLatency.Enum(),
				Unit:  pb.MetricUnit_MetricUnitMillisecond,
				Label: proto.String("RTT"),
				Id:    proto.Uint32(3),
				Val:   &pb.Metric_Float{Float: float32(rtt.Microseconds()) / 1000},
			})
		}
		if avgRTT != 0 {
			metrics = append(metrics, &pb.Metric{
				Kind:  pb.MetricKind_MetricKindLatency.Enum(),
				Unit:  pb.MetricUnit_MetricUnitMillisecond,
				Label: proto.String("RTT avg"),
				Id:    proto.Uint32(4),
				Val:   &pb.Metric_Float{Float: float32(avgRTT.Microseconds()) / 1000},
			})
		}

		if _, err := s.Push(context.Background(), connect.NewRequest(&pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: pc.entityID,
				Device: &pb.DeviceComponent{
					Parent:   proto.String(nodeEntityID),
					Category: proto.String("Network"),
					State:    pb.DeviceState_DeviceStateActive,
					Ip:       &pb.IpDevice{Host: &host, Port: &portU32},
				},
				Metric: &pb.MetricComponent{Metrics: metrics},
				Lifetime: &pb.Lifetime{
					Fresh: timestamppb.New(now),
					Until: timestamppb.New(now.Add(30 * time.Second)),
				},
			}},
		})); err != nil {
			slog.Warn("failed to push connection entity", "id", pc.entityID, "error", err)
		}
	}

	pushConn()

	if tc != nil {
		go func() {
			ticker := time.NewTicker(10 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-tc.closed:
					slog.Info("remote disconnected", "addr", c.RemoteAddr())
					_, _ = s.ExpireEntity(context.Background(), connect.NewRequest(&pb.ExpireEntityRequest{Id: pc.entityID}))
					return
				case <-ticker.C:
					pushConn()
				}
			}
		}()
	}

	return context.WithValue(ctx, peerEntityKey, pc)
}

type peerContext struct {
	address string
	port    string
	local   bool
}

func parsePeer(addr string) peerContext {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return peerContext{address: addr, local: true}
	}
	ip := net.ParseIP(host)
	local := ip != nil && ip.IsLoopback()
	return peerContext{address: host, port: port, local: local}
}
