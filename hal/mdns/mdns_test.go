package mdns

import (
	"bytes"
	"sync"
	"testing"
	"time"

	"github.com/projectqai/hydris/hal"
)

// loopbackProbe reports whether multicast packets sent by this process are
// delivered back to it. A host firewall that drops inbound UDP 5353 (common
// default) makes mDNS impossible; tests skip instead of failing there.
// Run in a clean network namespace for a reliable environment, e.g.:
//
//	unshare -r -n sh -c 'ip link set lo up; ip link add v0 type veth peer name v1;
//	  ip link set v0 up; ip link set v1 up; ip addr add 192.168.77.1/24 dev v0;
//	  go test ./hal/mdns/'
type loopbackProbe struct {
	once sync.Once
	ch   chan struct{}
}

func (l *loopbackProbe) handlePacket(msg []byte, _ int) {
	if bytes.Equal(msg, []byte("hydris-mdns-loopback-probe")) {
		l.once.Do(func() { close(l.ch) })
	}
}

func multicastLoopbackWorks(t *testing.T) bool {
	t.Helper()
	tr, err := acquireTransport()
	if err != nil {
		return false
	}
	defer releaseTransport()
	probe := &loopbackProbe{ch: make(chan struct{})}
	tr.addHandler(probe)
	defer tr.removeHandler(probe)
	for range 3 {
		tr.send([]byte("hydris-mdns-loopback-probe"), 0)
		select {
		case <-probe.ch:
			return true
		case <-time.After(500 * time.Millisecond):
		}
	}
	return false
}

func TestAdvertiseBrowse(t *testing.T) {
	if testing.Short() {
		t.Skip("multicast network test")
	}
	if !multicastLoopbackWorks(t) {
		t.Skip("multicast loopback unavailable (firewall or no multicast-capable interface)")
	}

	const service = "_hydristest._tcp"
	stopAdv, err := Advertise("unittest-abcd1234", service, 50099, map[string]string{"fp": "deadbeef"})
	if err != nil {
		t.Skipf("advertise failed (no multicast-capable network?): %v", err)
	}
	defer stopAdv()

	found := make(chan hal.MDNSPeer, 8)
	stopBrowse, err := Browse(service, func(peers []hal.MDNSPeer) {
		for _, p := range peers {
			if p.Instance == "unittest-abcd1234" {
				select {
				case found <- p:
				default:
				}
			}
		}
	})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	defer stopBrowse()

	select {
	case p := <-found:
		if p.Port != 50099 {
			t.Errorf("port = %d, want 50099", p.Port)
		}
		if p.Txt["fp"] != "deadbeef" {
			t.Errorf("txt fp = %q, want deadbeef", p.Txt["fp"])
		}
		if len(p.Addrs) == 0 {
			t.Error("no addresses resolved")
		}
		if p.Hostname == "" {
			t.Error("no hostname resolved")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("peer not discovered within 10s")
	}
}
