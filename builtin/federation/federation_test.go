package federation

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/projectqai/hydris/engine"
	pb "github.com/projectqai/proto/go"
	_goconnect "github.com/projectqai/proto/go/_goconnect"

	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/projectqai/hydris/goclient"
)

// ---------------------------------------------------------------------------
// Test harness: real WorldServer instances connected via gRPC
// ---------------------------------------------------------------------------

type testNode struct {
	engine *engine.WorldServer
	server *http.Server
	addr   string // "host:port" for goclient.Connect
	nodeID string
}

// startTestNode creates a WorldServer with a unique synthetic node ID,
// starts an HTTP/2 server, and returns a testNode ready for federation tests.
func startTestNode(t *testing.T) *testNode {
	t.Helper()

	eng := engine.NewWorldServer()
	eng.InitNodeIdentity()

	// Override with a synthetic unique node ID so each test node is distinct.
	// On the same machine all WorldServers get the same hardware-derived ID.
	syntheticID := nextNodeID()
	eng.SetNodeID(syntheticID)

	mux := http.NewServeMux()
	worldPath, worldHandler := _goconnect.NewWorldServiceHandler(eng)
	mux.Handle(worldPath, worldHandler)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()

	srv := &http.Server{
		Handler: h2c.NewHandler(mux, &http2.Server{}),
	}
	go func() { _ = srv.Serve(listener) }()
	t.Cleanup(func() { _ = srv.Close() })

	return &testNode{engine: eng, server: srv, addr: addr, nodeID: syntheticID}
}

func (n *testNode) push(t *testing.T, entities ...*pb.Entity) {
	t.Helper()
	conn, err := goclient.Connect(n.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)
	_, err = client.Push(context.Background(), &pb.EntityChangeRequest{
		Changes: entities,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func (n *testNode) get(t *testing.T, id string) *pb.Entity {
	t.Helper()
	conn, err := goclient.Connect(n.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)
	resp, err := client.GetEntity(context.Background(), &pb.GetEntityRequest{Id: id})
	if err != nil {
		return nil
	}
	return resp.Entity
}

func (n *testNode) has(t *testing.T, id string) bool {
	return n.get(t, id) != nil
}

// simulatePushSync performs one push federation cycle: read all entities from
// src, apply filterForFederation with srcNodeID, push accepted ones to dst.
func simulatePushSync(t *testing.T, src, dst *testNode, srcNodeID string, ttl time.Duration) {
	t.Helper()
	conn, err := goclient.Connect(src.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()

	dstConn, err := goclient.Connect(dst.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dstConn.Close() }()

	srcClient := pb.NewWorldServiceClient(conn)
	dstClient := pb.NewWorldServiceClient(dstConn)

	resp, err := srcClient.ListEntities(context.Background(), &pb.ListEntitiesRequest{})
	if err != nil {
		t.Fatal(err)
	}

	for _, e := range resp.Entities {
		clone := proto.Clone(e).(*pb.Entity)
		if filterForFederation(clone, srcNodeID, ttl) {
			_, err := dstClient.Push(context.Background(), &pb.EntityChangeRequest{
				Changes: []*pb.Entity{clone},
			})
			if err != nil {
				t.Logf("push failed: %v", err)
			}
		}
	}
}

// simulatePullSync performs one pull federation cycle: read all entities from
// remote, apply filterForFederation with remoteNodeID, push accepted to local.
func simulatePullSync(t *testing.T, local, remote *testNode, remoteNodeID string, ttl time.Duration) {
	t.Helper()
	simulatePushSync(t, remote, local, remoteNodeID, ttl)
}

// syntheticNodeID returns a unique synthetic node ID for testing.
// All WorldServer instances on the same machine share the real hardware
// node ID, so we use synthetic IDs to simulate distinct nodes.
var syntheticCounter int

func nextNodeID() string {
	syntheticCounter++
	return fmt.Sprintf("test-node-%d", syntheticCounter)
}

// makeEntity creates a test entity with the given parameters.
func makeEntity(id, node string, geo float64, fresh time.Time) *pb.Entity {
	e := &pb.Entity{
		Id:  id,
		Geo: &pb.GeoSpatialComponent{Latitude: geo},
		Routing: &pb.Routing{
			Channels: []*pb.Channel{{}},
		},
		Controller: &pb.Controller{
			Node: proto.String(node),
		},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(fresh),
			Fresh: timestamppb.New(fresh),
		},
	}
	return e
}

func getFresh(t *testing.T, n *testNode, id string) time.Time {
	t.Helper()
	e := n.get(t, id)
	if e == nil {
		t.Fatalf("entity %s not found", id)
		return time.Time{}
	}
	if e.Lifetime == nil || e.Lifetime.Fresh == nil {
		t.Fatalf("entity %s has no fresh", id)
	}
	return e.Lifetime.Fresh.AsTime()
}

// ---------------------------------------------------------------------------
// Filter edge case tests
// ---------------------------------------------------------------------------

func TestFilter_SkipsEntitiesWithoutRouting(t *testing.T) {
	e := &pb.Entity{
		Id:  "no-routing",
		Geo: &pb.GeoSpatialComponent{Latitude: 52},
		Controller: &pb.Controller{
			Node: proto.String("some-node"),
		},
		Lifetime: &pb.Lifetime{
			Fresh: timestamppb.Now(),
		},
	}
	if filterForFederation(e, "some-node", 60*time.Second) {
		t.Error("entity without Routing should be skipped")
	}
}

func TestFilter_SkipsEntitiesWithoutController(t *testing.T) {
	e := &pb.Entity{
		Id:  "no-controller",
		Geo: &pb.GeoSpatialComponent{Latitude: 52},
		Routing: &pb.Routing{
			Channels: []*pb.Channel{{}},
		},
		Lifetime: &pb.Lifetime{
			Fresh: timestamppb.Now(),
		},
	}
	if filterForFederation(e, "some-node", 60*time.Second) {
		t.Error("entity without Controller should be skipped")
	}
}

func TestFilter_SkipsEntitiesWithNilControllerNode(t *testing.T) {
	e := &pb.Entity{
		Id:  "nil-node",
		Geo: &pb.GeoSpatialComponent{Latitude: 52},
		Routing: &pb.Routing{
			Channels: []*pb.Channel{{}},
		},
		Controller: &pb.Controller{},
		Lifetime: &pb.Lifetime{
			Fresh: timestamppb.Now(),
		},
	}
	if filterForFederation(e, "some-node", 60*time.Second) {
		t.Error("entity with nil Controller.Node should be skipped")
	}
}

func TestFilter_SkipsNilEntity(t *testing.T) {
	if filterForFederation(nil, "some-node", 60*time.Second) {
		t.Error("nil entity should be skipped")
	}
}

func TestFilter_ForwardsThirdPartyEntity(t *testing.T) {
	// Entity from node "X" should be forwarded regardless of sourceNodeID.
	// This is the core "no node-based reject" behavior that enables relay.
	e := makeEntity("e1", "unknown-node-X", 52, time.Now())
	clone := proto.Clone(e).(*pb.Entity)

	if !filterForFederation(clone, "local-node", 60*time.Second) {
		t.Error("entity from third-party node should be forwarded (relay)")
	}

	// Fresh should NOT be bumped (unknown-node-X != local-node)
	if !clone.Lifetime.Fresh.AsTime().Equal(e.Lifetime.Fresh.AsTime()) {
		t.Errorf("relayed third-party entity should preserve fresh: got %v, want %v",
			clone.Lifetime.Fresh.AsTime(), e.Lifetime.Fresh.AsTime())
	}
}

func TestFilter_ScrubsLeaseAndConfig(t *testing.T) {
	e := makeEntity("e1", "node-a", 52, time.Now())
	e.Lease = &pb.Lease{Controller: "some-controller"}
	e.Config = &pb.ConfigurationComponent{}

	filterForFederation(e, "node-a", 60*time.Second)

	if e.Lease != nil {
		t.Error("Lease should be scrubbed")
	}
	if e.Config != nil {
		t.Error("Config should be scrubbed")
	}
}

// ---------------------------------------------------------------------------
// Filter behavior tests
// ---------------------------------------------------------------------------

func TestFilter_OriginBumpsFresh(t *testing.T) {
	a := startTestNode(t)
	b := startTestNode(t)

	original := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	a.push(t, makeEntity("e1", a.nodeID, 52, original))

	simulatePushSync(t, a, b, a.nodeID, 60*time.Second)

	fresh := getFresh(t, b, "e1")
	if !fresh.After(original) {
		t.Errorf("origin push should bump fresh: got %v, want after %v", fresh, original)
	}
}

func TestFilter_RelayPreservesFresh(t *testing.T) {
	a := startTestNode(t)
	b := startTestNode(t)
	c := startTestNode(t)

	original := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	// Push entity from A to B (origin, bumps fresh)
	a.push(t, makeEntity("e1", a.nodeID, 52, original))
	simulatePushSync(t, a, b, a.nodeID, 60*time.Second)
	freshOnB := getFresh(t, b, "e1")

	// B relays to C (not origin, should preserve fresh)
	simulatePushSync(t, b, c, b.nodeID, 60*time.Second)

	freshOnC := getFresh(t, c, "e1")
	if !freshOnC.Equal(freshOnB) {
		t.Errorf("relay should preserve fresh: got %v, want %v", freshOnC, freshOnB)
	}
}

func TestFilter_PullOriginBumps(t *testing.T) {
	a := startTestNode(t)
	b := startTestNode(t)

	original := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	a.push(t, makeEntity("e1", a.nodeID, 52, original))

	// B pulls from A using A's nodeID as source → origin bumps
	simulatePullSync(t, b, a, a.nodeID, 60*time.Second)

	fresh := getFresh(t, b, "e1")
	if !fresh.After(original) {
		t.Errorf("pull from origin should bump fresh: got %v, want after %v", fresh, original)
	}
}

func TestFilter_PullRelayPreserves(t *testing.T) {
	a := startTestNode(t)
	b := startTestNode(t)
	c := startTestNode(t)

	original := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	a.push(t, makeEntity("e1", a.nodeID, 52, original))

	// A pushes to B (origin bump)
	simulatePushSync(t, a, b, a.nodeID, 60*time.Second)
	freshOnB := getFresh(t, b, "e1")

	// C pulls from B using B's nodeID → e1 is not B's origin → preserve fresh
	simulatePullSync(t, c, b, b.nodeID, 60*time.Second)

	freshOnC := getFresh(t, c, "e1")
	if !freshOnC.Equal(freshOnB) {
		t.Errorf("pull relay should preserve fresh: got %v, want %v", freshOnC, freshOnB)
	}
}

// ---------------------------------------------------------------------------
// Star topology tests
// ---------------------------------------------------------------------------

func TestStar_SpokeToSpokeViaHub(t *testing.T) {
	hub := startTestNode(t)
	spokeA := startTestNode(t)
	spokeB := startTestNode(t)

	// Spoke A creates entity and pushes to hub
	spokeA.push(t, makeEntity("ea", spokeA.nodeID, 10, time.Now()))
	simulatePushSync(t, spokeA, hub, spokeA.nodeID, 60*time.Second)

	if !hub.has(t, "ea") {
		t.Fatal("hub should have ea after spoke A push")
	}

	// Spoke B pulls from hub — should get A's entity
	simulatePullSync(t, spokeB, hub, hub.nodeID, 60*time.Second)

	if !spokeB.has(t, "ea") {
		t.Fatal("spoke B should have ea after pull from hub")
	}
}

func TestStar_EchoPrevention(t *testing.T) {
	hub := startTestNode(t)
	spokeA := startTestNode(t)

	original := time.Now()
	spokeA.push(t, makeEntity("ea", spokeA.nodeID, 10, original))

	// Spoke A pushes to hub (origin, bumps fresh)
	simulatePushSync(t, spokeA, hub, spokeA.nodeID, 60*time.Second)

	freshOnHub := getFresh(t, hub, "ea")

	// Spoke A pulls from hub — ea comes back with hub's fresh (which was
	// bumped by push). Pull uses hub.nodeID as source, so node=spokeA ≠ hub
	// → relay → preserve fresh. spokeA already has ea. If fresh is same or
	// older, LWW rejects. Since hub's copy was bumped, it's newer, so spokeA
	// accepts the update (this is correct — it's just catching up to what it pushed).
	simulatePullSync(t, spokeA, hub, hub.nodeID, 60*time.Second)

	freshOnA := getFresh(t, spokeA, "ea")
	// After pull, A should have the same fresh as hub (accepted the bumped version)
	if !freshOnA.Equal(freshOnHub) {
		t.Errorf("spoke A should catch up to hub's fresh: got %v, want %v", freshOnA, freshOnHub)
	}

	// Another pull cycle — no change (same fresh, LWW no-op)
	simulatePullSync(t, spokeA, hub, hub.nodeID, 60*time.Second)
	freshAfter := getFresh(t, spokeA, "ea")
	if !freshAfter.Equal(freshOnA) {
		t.Errorf("second pull should be no-op: got %v, want %v", freshAfter, freshOnA)
	}
}

func TestStar_ThreeSpokes(t *testing.T) {
	hub := startTestNode(t)
	spokeA := startTestNode(t)
	spokeB := startTestNode(t)
	spokeC := startTestNode(t)

	spokeA.push(t, makeEntity("ea", spokeA.nodeID, 10, time.Now()))
	spokeB.push(t, makeEntity("eb", spokeB.nodeID, 20, time.Now()))
	spokeC.push(t, makeEntity("ec", spokeC.nodeID, 30, time.Now()))

	// All spokes push to hub
	simulatePushSync(t, spokeA, hub, spokeA.nodeID, 60*time.Second)
	simulatePushSync(t, spokeB, hub, spokeB.nodeID, 60*time.Second)
	simulatePushSync(t, spokeC, hub, spokeC.nodeID, 60*time.Second)

	// All spokes pull from hub
	simulatePullSync(t, spokeA, hub, hub.nodeID, 60*time.Second)
	simulatePullSync(t, spokeB, hub, hub.nodeID, 60*time.Second)
	simulatePullSync(t, spokeC, hub, hub.nodeID, 60*time.Second)

	// Each spoke should have all three entities
	for name, spoke := range map[string]*testNode{"A": spokeA, "B": spokeB, "C": spokeC} {
		for _, id := range []string{"ea", "eb", "ec"} {
			if !spoke.has(t, id) {
				t.Errorf("spoke %s should have %s", name, id)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Chain / relay tests
// ---------------------------------------------------------------------------

func TestChain_Relay(t *testing.T) {
	a := startTestNode(t)
	b := startTestNode(t)
	c := startTestNode(t)

	a.push(t, makeEntity("e1", a.nodeID, 52, time.Now()))

	// A pushes to B (origin)
	simulatePushSync(t, a, b, a.nodeID, 60*time.Second)
	// B pushes to C (relay — B forwards all, including A's entity)
	simulatePushSync(t, b, c, b.nodeID, 60*time.Second)

	if !c.has(t, "e1") {
		t.Fatal("C should have e1 via B relay")
	}
}

func TestChain_NoLoop(t *testing.T) {
	a := startTestNode(t)
	b := startTestNode(t)
	c := startTestNode(t)

	original := time.Now()
	a.push(t, makeEntity("e1", a.nodeID, 52, original))

	// A → B (origin, bump)
	simulatePushSync(t, a, b, a.nodeID, 60*time.Second)
	// B → C (relay, preserve)
	simulatePushSync(t, b, c, b.nodeID, 60*time.Second)

	freshOnB := getFresh(t, b, "e1")
	freshOnC := getFresh(t, c, "e1")

	// C → B (pull, relay — preserve fresh since node=A ≠ C)
	simulatePullSync(t, b, c, c.nodeID, 60*time.Second)

	freshOnBAfter := getFresh(t, b, "e1")
	// B's fresh should not change (C has same fresh, LWW no-op)
	if !freshOnBAfter.Equal(freshOnB) {
		t.Errorf("chain loop should be no-op: B fresh was %v, now %v (C had %v)",
			freshOnB, freshOnBAfter, freshOnC)
	}

	// Run multiple cycles to prove convergence
	for i := 0; i < 5; i++ {
		simulatePushSync(t, b, c, b.nodeID, 60*time.Second)
		simulatePullSync(t, b, c, c.nodeID, 60*time.Second)
	}

	freshFinal := getFresh(t, b, "e1")
	if !freshFinal.Equal(freshOnB) {
		t.Errorf("after 5 cycles, B fresh should be unchanged: was %v, now %v", freshOnB, freshFinal)
	}
}

// ---------------------------------------------------------------------------
// Bidirectional tests
// ---------------------------------------------------------------------------

func TestBidirectional_NoLoop(t *testing.T) {
	a := startTestNode(t)
	b := startTestNode(t)

	a.push(t, makeEntity("ea", a.nodeID, 10, time.Now()))
	b.push(t, makeEntity("eb", b.nodeID, 20, time.Now()))

	// A pushes to B, B pushes to A
	simulatePushSync(t, a, b, a.nodeID, 60*time.Second)
	simulatePushSync(t, b, a, b.nodeID, 60*time.Second)

	// Both have both entities
	if !a.has(t, "eb") {
		t.Fatal("A should have eb")
	}
	if !b.has(t, "ea") {
		t.Fatal("B should have ea")
	}

	freshEaOnA := getFresh(t, a, "ea")
	freshEbOnB := getFresh(t, b, "eb")

	// Run 5 more bidirectional cycles
	for i := 0; i < 5; i++ {
		simulatePushSync(t, a, b, a.nodeID, 60*time.Second)
		simulatePushSync(t, b, a, b.nodeID, 60*time.Second)
	}

	// Origin entities keep getting bumped (each push cycle bumps fresh)
	// but relayed entities should stay stable after first delivery
	freshEaOnAAfter := getFresh(t, a, "ea")
	freshEbOnBAfter := getFresh(t, b, "eb")

	// Origin entities may have bumped (that's correct — keepalive)
	if freshEaOnAAfter.Before(freshEaOnA) {
		t.Error("A's own entity fresh should not go backwards")
	}
	if freshEbOnBAfter.Before(freshEbOnB) {
		t.Error("B's own entity fresh should not go backwards")
	}

	// The relayed copies on each node should match what the origin last pushed
	freshEaOnB := getFresh(t, b, "ea")
	freshEbOnA := getFresh(t, a, "eb")
	freshEaOnAFinal := getFresh(t, a, "ea")
	freshEbOnBFinal := getFresh(t, b, "eb")

	// ea on B should reflect A's latest bump
	if freshEaOnB.After(freshEaOnAFinal) {
		t.Errorf("ea on B (%v) should not be after ea on A (%v)", freshEaOnB, freshEaOnAFinal)
	}
	if freshEbOnA.After(freshEbOnBFinal) {
		t.Errorf("eb on A (%v) should not be after eb on B (%v)", freshEbOnA, freshEbOnBFinal)
	}
}

// ---------------------------------------------------------------------------
// Lifecycle tests
// ---------------------------------------------------------------------------

func TestKeepalive_OriginRefreshes(t *testing.T) {
	hub := startTestNode(t)
	spoke := startTestNode(t)

	spoke.push(t, makeEntity("e1", spoke.nodeID, 52, time.Now()))

	// First push cycle
	simulatePushSync(t, spoke, hub, spoke.nodeID, 60*time.Second)
	fresh1 := getFresh(t, hub, "e1")

	// Simulate time passing + another keepalive push
	time.Sleep(10 * time.Millisecond)
	simulatePushSync(t, spoke, hub, spoke.nodeID, 60*time.Second)
	fresh2 := getFresh(t, hub, "e1")

	if !fresh2.After(fresh1) {
		t.Errorf("keepalive should bump fresh: first=%v, second=%v", fresh1, fresh2)
	}
}
