package mdns

import (
	"net"
	"slices"
	"sort"
	"testing"
	"time"

	"github.com/projectqai/hydris/hal"
	"golang.org/x/net/dns/dnsmessage"
)

// Browse tests feed hand-built responses to the browser, so records can be
// packed the way other responders do (Avahi, mDNSResponder, NsdManager) and
// not only the way ours does. Names are lower case and fully qualified, as
// on the wire.

type rrFn func(b *dnsmessage.Builder) error

func mustName(t *testing.T, s string) dnsmessage.Name {
	t.Helper()
	n, err := dnsmessage.NewName(s)
	if err != nil {
		t.Fatalf("name %q: %v", s, err)
	}
	return n
}

func ptrRR(t *testing.T, owner, target string, ttl uint32) rrFn {
	o, p := mustName(t, owner), mustName(t, target)
	return func(b *dnsmessage.Builder) error {
		return b.PTRResource(dnsmessage.ResourceHeader{Name: o, Class: dnsmessage.ClassINET, TTL: ttl},
			dnsmessage.PTRResource{PTR: p})
	}
}

func srvRR(t *testing.T, inst, host string, port uint16, ttl uint32) rrFn {
	i, h := mustName(t, inst), mustName(t, host)
	return func(b *dnsmessage.Builder) error {
		return b.SRVResource(dnsmessage.ResourceHeader{Name: i, Class: classCacheFlush, TTL: ttl},
			dnsmessage.SRVResource{Port: port, Target: h})
	}
}

func txtRR(t *testing.T, owner string, ttl uint32, kv ...string) rrFn {
	o := mustName(t, owner)
	if len(kv) == 0 {
		kv = []string{""}
	}
	return func(b *dnsmessage.Builder) error {
		return b.TXTResource(dnsmessage.ResourceHeader{Name: o, Class: classCacheFlush, TTL: ttl},
			dnsmessage.TXTResource{TXT: kv})
	}
}

func aRR(t *testing.T, host, ip string, ttl uint32) rrFn {
	h := mustName(t, host)
	var a [4]byte
	copy(a[:], net.ParseIP(ip).To4())
	return func(b *dnsmessage.Builder) error {
		return b.AResource(dnsmessage.ResourceHeader{Name: h, Class: classCacheFlush, TTL: ttl},
			dnsmessage.AResource{A: a})
	}
}

func response(t *testing.T, rrs ...rrFn) []byte {
	t.Helper()
	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{Response: true, Authoritative: true})
	b.EnableCompression()
	if err := b.StartAnswers(); err != nil {
		t.Fatal(err)
	}
	for _, rr := range rrs {
		if err := rr(&b); err != nil {
			t.Fatal(err)
		}
	}
	msg, err := b.Finish()
	if err != nil {
		t.Fatal(err)
	}
	return msg
}

const (
	svc   = "_hydris._tcp.local."
	nodeA = "node-a._hydris._tcp.local."
	nodeB = "node-b._hydris._tcp.local."
)

func newTestBrowser(t *testing.T) *browser {
	t.Helper()
	sn, err := serviceFQDN("_hydris._tcp")
	if err != nil {
		t.Fatal(err)
	}
	return &browser{serviceName: sn, instances: map[string]*instanceState{}, cb: func([]hal.MDNSPeer) {}}
}

func peersOf(b *browser) []hal.MDNSPeer {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.snapshotLocked()
}

func instanceNames(peers []hal.MDNSPeer) []string {
	names := make([]string, 0, len(peers))
	for _, p := range peers {
		names = append(names, p.Instance)
	}
	return names
}

// addrsOf returns the addresses of the only peer.
func addrsOf(t *testing.T, b *browser) []string {
	t.Helper()
	peers := peersOf(b)
	if len(peers) != 1 {
		t.Fatalf("want one peer, have %v", instanceNames(peers))
	}
	return peers[0].Addrs
}

// age pretends every address of host was last heard d ago.
func age(b *browser, host string, d time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if hs := b.hosts[host]; hs != nil {
		for k := range hs.addrs {
			hs.addrs[k] = time.Now().Add(-d)
		}
	}
}

// nodeAAnswer is node-a's answer to a PTR query as our responder sends it,
// published at ip on host node-a.local.
func nodeAAnswer(t *testing.T, ip string) []byte {
	return response(t,
		ptrRR(t, svc, nodeA, 120),
		srvRR(t, nodeA, "node-a.local.", 50051, 120),
		txtRR(t, nodeA, 120, "fp=aaaa"),
		aRR(t, "node-a.local.", ip, 120),
	)
}

// Avahi publishes every service under the machine's own hostname, so nodes
// sharing a box share an SRV target, and a response carries that host's A
// record once, wherever the responder's jitter put it, or not at all when it
// went out moments ago.
func TestBrowseInstancesSharingHost(t *testing.T) {
	ptrA, ptrB := ptrRR(t, svc, nodeA, 120), ptrRR(t, svc, nodeB, 120)
	srvA, txtA := srvRR(t, nodeA, "devbox.local.", 50051, 120), txtRR(t, nodeA, 120, "fp=aaaa")
	srvB, txtB := srvRR(t, nodeB, "devbox.local.", 50061, 120), txtRR(t, nodeB, 120, "fp=bbbb")
	addr := aRR(t, "devbox.local.", "192.168.1.10", 120)

	for _, tc := range []struct {
		name    string
		packets [][]rrFn
	}{
		{"one response, address last", [][]rrFn{{ptrA, ptrB, srvA, txtA, srvB, txtB, addr}}},
		{"one response, address first", [][]rrFn{{addr, ptrA, ptrB, srvA, txtA, srvB, txtB}}},
		{"address only in the first response", [][]rrFn{{ptrA, srvA, txtA, addr}, {ptrB, srvB, txtB}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b := newTestBrowser(t)
			for _, rrs := range tc.packets {
				b.handlePacket(response(t, rrs...), 1)
			}
			peers := peersOf(b)
			if names := instanceNames(peers); !slices.Equal(names, []string{"node-a", "node-b"}) {
				t.Fatalf("peers %v, want [node-a node-b]", names)
			}
			for i, port := range []int{50051, 50061} {
				if p := peers[i]; p.Port != port || !slices.Equal(p.Addrs, []string{"192.168.1.10"}) {
					t.Errorf("%s: port %d addrs %v, want port %d addrs [192.168.1.10]", p.Instance, p.Port, p.Addrs, port)
				}
			}
		})
	}
}

// Every mDNS packet on the link reaches the browser. Another service on the
// node's host answering someone else's query must neither join the
// _hydris._tcp snapshot nor keep the host's fresh A record from counting for
// the node.
func TestBrowseIgnoresOtherServices(t *testing.T) {
	const ws = "devbox [00:11:22:33:44:55]._workstation._tcp.local."
	b := newTestBrowser(t)
	b.handlePacket(response(t,
		ptrRR(t, svc, nodeA, 120),
		srvRR(t, nodeA, "devbox.local.", 50051, 120),
		txtRR(t, nodeA, 120, "fp=aaaa"),
		aRR(t, "devbox.local.", "192.168.1.10", 120),
	), 1)
	age(b, "devbox.local.", 40*time.Second)

	b.handlePacket(response(t,
		ptrRR(t, "_workstation._tcp.local.", ws, 120),
		srvRR(t, ws, "devbox.local.", 9, 120),
		txtRR(t, ws, 120),
		txtRR(t, "devbox._device-info._tcp.local.", 120, "model=Xserve"),
		ptrRR(t, svc, "stray._other._tcp.local.", 120),
		aRR(t, "devbox.local.", "192.168.1.10", 120),
	), 1)

	if names := instanceNames(peersOf(b)); !slices.Equal(names, []string{"node-a"}) {
		t.Errorf("peers %v, want [node-a]", names)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.instances) != 1 {
		t.Errorf("tracking %d instances, want 1", len(b.instances))
	}
	hs := b.hosts["devbox.local."]
	if hs == nil {
		t.Fatal("devbox's addresses are gone")
	}
	if since := time.Since(hs.addrs[addrKey{ip: "192.168.1.10", ifIndex: 1}]); since > time.Second {
		t.Errorf("devbox's fresh A record left node-a's address %s old", since.Round(time.Second))
	}
}

// A peer on two networks answers each query only on the network it was asked
// on. A node on one of them asking must not cost the peer its address on the
// other, while a changed address on the same network still replaces the old
// one at once.
func TestBrowseCacheFlushPerInterface(t *testing.T) {
	const eth, wifi = 1, 2
	b := newTestBrowser(t)
	// Our own query went out on both networks: both answers arrive together.
	b.handlePacket(nodeAAnswer(t, "10.0.0.5"), eth)
	b.handlePacket(nodeAAnswer(t, "192.168.1.5"), wifi)

	age(b, "node-a.local.", 5*time.Second)
	b.handlePacket(nodeAAnswer(t, "192.168.1.5"), wifi) // a wifi-only node asked
	if got := addrsOf(t, b); !slices.Equal(got, []string{"192.168.1.5", "10.0.0.5"}) {
		t.Errorf("after a wifi-only query: addrs %v, want [192.168.1.5 10.0.0.5]", got)
	}

	age(b, "node-a.local.", 2*time.Second)
	b.handlePacket(nodeAAnswer(t, "192.168.1.6"), wifi) // node-a moved on wifi
	if got := addrsOf(t, b); !slices.Equal(got, []string{"192.168.1.6", "10.0.0.5"}) {
		t.Errorf("after an address change on wifi: addrs %v, want [192.168.1.6 10.0.0.5]", got)
	}
}

// A multi-homed host on our network answers once per interface, each answer
// flushing; the second must not evict the first.
func TestBrowseCacheFlushGrace(t *testing.T) {
	b := newTestBrowser(t)
	b.handlePacket(nodeAAnswer(t, "192.168.1.5"), 1)
	b.handlePacket(nodeAAnswer(t, "192.168.1.7"), 1)
	got := addrsOf(t, b)
	sort.Strings(got)
	if !slices.Equal(got, []string{"192.168.1.5", "192.168.1.7"}) {
		t.Errorf("addrs %v, want both", got)
	}
}

// RFC 6762 §10.1: TTL 0 withdraws a record. Our responder's goodbye is PTR,
// SRV, TXT and A, all TTL 0; none of them may bring the instance back.
func TestBrowseGoodbye(t *testing.T) {
	r, err := newResponder("node-a", "_hydris._tcp", 50051, map[string]string{"fp": "aaaa"})
	if err != nil {
		t.Fatal(err)
	}
	ip10, ip11 := net.IPv4(192, 168, 1, 10).To4(), net.IPv4(192, 168, 1, 11).To4()

	t.Run("instance withdrawn", func(t *testing.T) {
		var last []hal.MDNSPeer
		b := newTestBrowser(t)
		b.cb = func(peers []hal.MDNSPeer) { last = peers }
		b.handlePacket(r.encode(recordTTL, []net.IP{ip10}), 1)
		b.sweep()
		if names := instanceNames(last); !slices.Equal(names, []string{"node-a"}) {
			t.Fatalf("before goodbye: peers %v, want [node-a]", names)
		}

		b.handlePacket(r.encode(0, []net.IP{ip10}), 1)
		b.sweep()
		if len(last) != 0 {
			t.Errorf("after goodbye: peers %v, want none", instanceNames(last))
		}
		if len(b.instances) != 0 {
			t.Errorf("after goodbye: %d instances still tracked", len(b.instances))
		}
		if len(b.hosts) != 0 {
			t.Errorf("after goodbye: %d hosts still tracked", len(b.hosts))
		}
	})

	t.Run("late goodbye for a replaced SRV", func(t *testing.T) {
		b := newTestBrowser(t)
		b.handlePacket(r.encode(recordTTL, []net.IP{ip10}), 1)
		b.handlePacket(response(t, srvRR(t, nodeA, "node-a.local.", 50052, 120)), 1)
		b.handlePacket(response(t, srvRR(t, nodeA, "node-a.local.", 50051, 0)), 1)
		peers := peersOf(b)
		if len(peers) != 1 || peers[0].Port != 50052 {
			t.Errorf("peers %+v, want node-a on port 50052", peers)
		}
	})

	t.Run("one address withdrawn", func(t *testing.T) {
		b := newTestBrowser(t)
		b.handlePacket(r.encode(recordTTL, []net.IP{ip10, ip11}), 1)
		b.handlePacket(response(t, aRR(t, "node-a.local.", "192.168.1.11", 0)), 1)
		if got := addrsOf(t, b); !slices.Equal(got, []string{"192.168.1.10"}) {
			t.Errorf("addrs %v, want [192.168.1.10]", got)
		}
	})
}
