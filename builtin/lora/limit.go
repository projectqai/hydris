package lora

import (
	"net"
	"net/netip"
	"time"
)

const (
	maxFrameSize   = 255 // largest LoRa PHY payload
	peerFrameRate  = 100 // frames per second
	peerFrameBurst = 200
	maxPeers       = 16
)

type peerBucket struct {
	tokens float64
	seen   time.Time
}

// peerLimiter is a token bucket per source address. The table is bounded, so
// spoofed sources cannot lift the total above maxPeers buckets.
type peerLimiter struct {
	peers map[netip.Addr]*peerBucket
}

func newPeerLimiter() *peerLimiter {
	return &peerLimiter{peers: make(map[netip.Addr]*peerBucket)}
}

func (l *peerLimiter) allow(peer netip.Addr, now time.Time) bool {
	b, ok := l.peers[peer]
	if !ok {
		if len(l.peers) >= maxPeers && !l.evictIdle(now) {
			return false
		}
		b = &peerBucket{tokens: peerFrameBurst, seen: now}
		l.peers[peer] = b
	}
	if elapsed := now.Sub(b.seen); elapsed > 0 {
		b.tokens = min(peerFrameBurst, b.tokens+elapsed.Seconds()*peerFrameRate)
		b.seen = now
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// evictIdle drops one peer whose bucket has had time to refill completely, so
// forgetting it hands out no extra tokens.
func (l *peerLimiter) evictIdle(now time.Time) bool {
	const refill = peerFrameBurst * time.Second / peerFrameRate
	for peer, b := range l.peers {
		if now.Sub(b.seen) >= refill {
			delete(l.peers, peer)
			return true
		}
	}
	return false
}

func peerAddr(addr net.Addr) netip.Addr {
	if udp, ok := addr.(*net.UDPAddr); ok {
		return udp.AddrPort().Addr().Unmap()
	}
	return netip.Addr{}
}
