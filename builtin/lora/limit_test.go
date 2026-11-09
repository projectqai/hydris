package lora

import (
	"bytes"
	"net"
	"net/netip"
	"testing"
	"time"
)

func allowed(l *peerLimiter, peer netip.Addr, now time.Time, attempts int) int {
	n := 0
	for range attempts {
		if l.allow(peer, now) {
			n++
		}
	}
	return n
}

func TestPeerLimiterCapsBurstAndRefills(t *testing.T) {
	l := newPeerLimiter()
	peer := netip.MustParseAddr("192.0.2.1")
	now := time.Unix(1700000000, 0)

	if got := allowed(l, peer, now, 10*peerFrameBurst); got != peerFrameBurst {
		t.Fatalf("burst allowed %d frames, want %d", got, peerFrameBurst)
	}
	now = now.Add(time.Second)
	if got := allowed(l, peer, now, 10*peerFrameBurst); got != peerFrameRate {
		t.Errorf("after one second allowed %d frames, want %d", got, peerFrameRate)
	}
	now = now.Add(time.Hour)
	if got := allowed(l, peer, now, 10*peerFrameBurst); got != peerFrameBurst {
		t.Errorf("after a long idle allowed %d frames, want %d", got, peerFrameBurst)
	}
}

func TestPeerLimiterIsPerPeer(t *testing.T) {
	l := newPeerLimiter()
	now := time.Unix(1700000000, 0)
	noisy := netip.MustParseAddr("192.0.2.1")
	quiet := netip.MustParseAddr("192.0.2.2")

	allowed(l, noisy, now, 10*peerFrameBurst)
	if l.allow(noisy, now) {
		t.Error("noisy peer must be limited")
	}
	if !l.allow(quiet, now) {
		t.Error("a second peer must not be limited by the first")
	}
}

func TestPeerLimiterBoundsThePeerTable(t *testing.T) {
	l := newPeerLimiter()
	now := time.Unix(1700000000, 0)
	addr := func(i int) netip.Addr { return netip.AddrFrom4([4]byte{10, 0, byte(i >> 8), byte(i)}) }

	total := 0
	for i := range 1000 {
		total += allowed(l, addr(i), now, 10*peerFrameBurst)
	}
	if want := maxPeers * peerFrameBurst; total != want {
		t.Errorf("allowed %d frames across spoofed peers, want %d", total, want)
	}
	if len(l.peers) != maxPeers {
		t.Errorf("peer table holds %d entries, want %d", len(l.peers), maxPeers)
	}

	now = now.Add(time.Hour)
	if !l.allow(addr(5000), now) {
		t.Error("a new peer must get in once an old one went idle")
	}
	if len(l.peers) > maxPeers {
		t.Errorf("peer table holds %d entries, want at most %d", len(l.peers), maxPeers)
	}
}

func TestPeerAddrIgnoresThePort(t *testing.T) {
	a := peerAddr(&net.UDPAddr{IP: net.ParseIP("192.0.2.1"), Port: 1000})
	b := peerAddr(&net.UDPAddr{IP: net.ParseIP("192.0.2.1"), Port: 2000})
	if a != b || !a.IsValid() {
		t.Errorf("peerAddr = %v and %v, want the same valid address", a, b)
	}
}

func TestDecodePushDataCapsFrameSize(t *testing.T) {
	fits := bytes.Repeat([]byte{0x4F}, maxFrameSize)
	if entities := decodePushData(rxpkEnvelope(t, fits, -80, 5, 1), "gw-1"); len(entities) != 1 {
		t.Errorf("got %d entities, want one for a %d byte frame", len(entities), len(fits))
	}
	for _, size := range []int{maxFrameSize + 1, 60000} {
		frame := bytes.Repeat([]byte{0x4F}, size)
		if entities := decodePushData(rxpkEnvelope(t, frame, -80, 5, 1), "gw-1"); entities != nil {
			t.Errorf("got %d entities, want none for a %d byte frame", len(entities), size)
		}
	}
}
