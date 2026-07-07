package engine

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

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

// federationNodeKey carries the remote node id a federation connection relays on
// behalf of, declared by the federation builtin over the trusted bufconn.
type federationNodeKeyType struct{}

var federationNodeKey federationNodeKeyType

func BuiltinConnContext(ctx context.Context, _ net.Conn) context.Context {
	return context.WithValue(ctx, builtinConnKey, true)
}

func NewBuiltinServer(handler http.Handler) *http.Server {
	var protos http.Protocols
	protos.SetHTTP1(true)
	protos.SetUnencryptedHTTP2(true)
	return &http.Server{
		Handler:     handler,
		ConnContext: BuiltinConnContext,
		Protocols:   &protos,
	}
}

// peerConn holds per-connection state for a remote peer: time-sync tracking, the
// underlying net.Conn (so authn.policy can read the mTLS peer certificate), and
// the actor identity resolved once for the connection by authn.policy.
type peerConn struct {
	ts       timesync.Tracker
	prevT1Us atomic.Int64 // previous exchange T1 (unix microseconds)
	prevT2Us atomic.Int64 // previous exchange T2 (unix microseconds)
	prevT3Us atomic.Int64 // previous exchange T3 (unix microseconds)

	conn   net.Conn  // underlying connection, for mTLS peer-cert inspection
	idOnce sync.Once // resolves the connection identity exactly once
	actor  string    // identity assigned by authn.policy ("" = denied)
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

// Unwrap exposes the wrapped connection so the policy layer can traverse the
// wrapper chain (trackedConn → peekedConn → *tls.Conn) to the mTLS peer cert.
func (c *trackedConn) Unwrap() net.Conn { return c.Conn }

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

	if s.connTracker != nil {
		// Only count connections we can also observe closing, so connect()
		// and disconnect() stay balanced.
		if tc, ok := c.(*trackedConn); ok {
			s.connTracker.connect()
			go func() {
				<-tc.closed
				slog.Info("remote disconnected", "addr", c.RemoteAddr())
				s.connTracker.disconnect()
			}()
		}
	}

	return context.WithValue(ctx, peerEntityKey, &peerConn{conn: c})
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

// connTracker aggregates connection telemetry: a live count of remote
// connections (the "connected clients" gauge on authz.service) and per-actor
// activity. Per-actor entries are evicted once stale, so the maps stay bounded.
type connTracker struct {
	server    *WorldServer
	startedAt time.Time
	active    atomic.Int64

	mu     sync.Mutex
	actors map[string]*actorStat
}

type actorStat struct {
	pushes   uint64
	lastSeen time.Time
}

const actorStatTTL = 5 * time.Minute

func newConnTracker(s *WorldServer) *connTracker {
	return &connTracker{server: s, startedAt: time.Now(), actors: make(map[string]*actorStat)}
}

func (ct *connTracker) connect() {
	if ct == nil {
		return
	}
	ct.active.Add(1)
	ct.pushService()
}

func (ct *connTracker) disconnect() {
	if ct == nil {
		return
	}
	ct.active.Add(-1)
	ct.pushService()
}

// addPush records a push from actor, updating its activity, and refreshes that
// actor's telemetry. Called from the Push handler with the authenticated actor.
func (ct *connTracker) addPush(actor string) {
	if ct == nil || actor == "" {
		return
	}
	now := time.Now()
	ct.mu.Lock()
	st := ct.actors[actor]
	if st == nil {
		st = &actorStat{}
		ct.actors[actor] = st
	}
	st.pushes++
	st.lastSeen = now
	pushes, lastSeen := st.pushes, st.lastSeen
	// Drop actors idle past the TTL so the in-memory map stays bounded. The
	// telemetry already pushed for them stays on their entity until it expires
	// with the entity itself.
	for id, s := range ct.actors {
		if now.Sub(s.lastSeen) > actorStatTTL {
			delete(ct.actors, id)
		}
	}
	ct.mu.Unlock()

	ct.pushActor(actor, pushes, lastSeen)
}

// serviceMetricInterval is the refresh cadence for the authz.service gauges
// (uptime, connected clients). It only touches the service entity — per-actor
// stats stay event-driven — so it can never extend a credential's lifetime.
const serviceMetricInterval = 30 * time.Second

// start refreshes the authz.service gauges on a slow ticker. Per-actor stats are
// not refreshed here; they are re-pushed only on activity (addPush). Each push
// writes directly to head without touching Lifetime, so no entity expiry is
// extended. The first push may be a no-op — authz.service is owned by the authz
// builtin and may not exist yet — but the ticker retries, so it appears shortly.
func (ct *connTracker) start(ctx context.Context) {
	if ct == nil {
		return
	}
	go func() {
		ct.pushService()
		ticker := time.NewTicker(serviceMetricInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				ct.pushService()
			}
		}
	}()
}

// pushService re-emits the authz.service gauges (live client count, uptime).
// Called from connect/disconnect/start, none of which hold the world lock.
func (ct *connTracker) pushService() {
	now := time.Now()
	ct.server.setEntityMetrics(authzServiceEntity, []*pb.Metric{
		{
			Kind:  pb.MetricKind_MetricKindCount.Enum(),
			Unit:  pb.MetricUnit_MetricUnitCount,
			Label: proto.String("Connected clients"),
			Id:    proto.Uint32(1),
			Val:   &pb.Metric_Uint64{Uint64: uint64(max(ct.active.Load(), 0))},
		},
		{
			Kind:  pb.MetricKind_MetricKindDuration.Enum(),
			Unit:  pb.MetricUnit_MetricUnitSecond,
			Label: proto.String("Uptime"),
			Id:    proto.Uint32(2),
			Val:   &pb.Metric_Float{Float: float32(now.Sub(ct.startedAt).Seconds())},
		},
	})
}

// pushActor re-emits a single actor's telemetry onto its identity entity. Last
// seen is carried as MeasuredAt so the UI can render the elapsed time live
// without us re-pushing on a timer. Called from addPush, which holds s.l.
func (ct *connTracker) pushActor(id string, pushes uint64, lastSeen time.Time) {
	ct.server.setEntityMetricsLocked(id, []*pb.Metric{
		{
			Kind:  pb.MetricKind_MetricKindCount.Enum(),
			Unit:  pb.MetricUnit_MetricUnitCount,
			Label: proto.String("Received pushes"),
			Id:    proto.Uint32(1),
			Val:   &pb.Metric_Uint64{Uint64: pushes},
		},
		{
			Kind:       pb.MetricKind_MetricKindDuration.Enum(),
			Unit:       pb.MetricUnit_MetricUnitSecond,
			Label:      proto.String("Last seen"),
			Id:         proto.Uint32(2),
			MeasuredAt: timestamppb.New(lastSeen),
			Val:        &pb.Metric_Float{Float: 0},
		},
	})
}
