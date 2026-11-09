package platform

import (
	"fmt"
	"net"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/projectqai/hydris/hal"
	"golang.org/x/sys/unix"
)

func TestTXTRoundTrip(t *testing.T) {
	in := map[string]string{"fp": "deadbeef", "node": "a=b", "empty": ""}
	out := decodeTXT(mustEncodeTXT(t, in))
	if !reflect.DeepEqual(in, out) {
		t.Errorf("got %v, want %v", out, in)
	}
	if got := mustEncodeTXT(t, nil); len(got) != 0 {
		t.Errorf("empty map encoded to %q", got)
	}
}

func TestEncodeTXTRejectsOversizedEntry(t *testing.T) {
	if _, err := encodeTXT(map[string]string{"k": strings.Repeat("x", dnssdMaxTXTEntry)}); err == nil {
		t.Error("oversized entry accepted")
	}
}

func TestDecodeTXTMalformed(t *testing.T) {
	tests := []struct {
		name string
		in   []byte
		want map[string]string
	}{
		{"truncated", []byte("\x09fp=ab"), map[string]string{}},
		{"valid then truncated", []byte("\x03a=b\x09x"), map[string]string{"a": "b"}},
		{"empty entries", []byte("\x00\x03a=b\x00"), map[string]string{"a": "b"}},
		{"key only", []byte("\x03key"), map[string]string{"key": ""}},
		{"no key", []byte("\x02=x"), map[string]string{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := decodeTXT(tt.in); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSockaddrIPv4(t *testing.T) {
	sa := [8]byte{16, unix.AF_INET, 0, 0, 192, 168, 1, 2}
	if got := sockaddrIPv4(&sa); got.String() != "192.168.1.2" {
		t.Errorf("got %v", got)
	}
	sa[1] = unix.AF_INET6
	if got := sockaddrIPv4(&sa); got != nil {
		t.Errorf("IPv6 sockaddr parsed as %v", got)
	}
	if got := sockaddrIPv4(nil); got != nil {
		t.Errorf("nil sockaddr parsed as %v", got)
	}
}

func TestSnapshot(t *testing.T) {
	b := &dnssdBrowser{instances: map[string]map[uint32]*dnssdSighting{
		"unresolved": {1: {addrs: map[string]uint64{}}},
		"expired":    {1: {host: "gone.local.", addrs: map[string]uint64{}}},
		"multihomed": {
			1: {host: "old.local.", port: 1, resolvedAt: 1, addrs: map[string]uint64{"10.0.0.1": 5, "10.0.0.2": 2}},
			2: {host: "new.local.", port: 2, resolvedAt: 9, txt: map[string]string{"fp": "ab"}, addrs: map[string]uint64{"10.0.0.2": 7, "10.0.0.3": 1}},
		},
	}}
	want := []hal.MDNSPeer{{
		Instance: "multihomed",
		Hostname: "new.local",
		Addrs:    []string{"10.0.0.2", "10.0.0.1", "10.0.0.3"},
		Port:     2,
		Txt:      map[string]string{"fp": "ab"},
	}}
	if got := b.snapshot(); !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func mustEncodeTXT(t *testing.T, txt map[string]string) []byte {
	t.Helper()
	record, err := encodeTXT(txt)
	if err != nil {
		t.Fatal(err)
	}
	return record
}

// testPeers collects browse snapshots for one uniquely named instance, so
// anything else on the network cannot affect the test.
type testPeers struct {
	instance string
	ch       chan *hal.MDNSPeer
}

func newTestPeers(instance string) *testPeers {
	return &testPeers{instance: instance, ch: make(chan *hal.MDNSPeer, 64)}
}

func (p *testPeers) onSnapshot(peers []hal.MDNSPeer) {
	var found *hal.MDNSPeer
	for i := range peers {
		if peers[i].Instance == p.instance {
			found = &peers[i]
		}
	}
	p.ch <- found
}

func (p *testPeers) waitFor(t *testing.T, want bool) *hal.MDNSPeer {
	t.Helper()
	deadline := time.After(20 * time.Second)
	for {
		select {
		case peer := <-p.ch:
			if (peer != nil) == want {
				return peer
			}
		case <-deadline:
			t.Fatalf("timed out waiting for visible=%v", want)
		}
	}
}

func skipWithoutResponder(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("mDNSResponder test")
	}
	addrs, err := net.InterfaceAddrs()
	if err == nil {
		for _, a := range addrs {
			if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && !n.IP.IsLoopback() {
				return
			}
		}
	}
	t.Skip("no non-loopback IPv4 address, nothing to discover on")
}

func uniqueInstance(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("unittest-%d-%d", os.Getpid(), time.Now().UnixNano())
}

func TestDNSSDAdvertiseBrowse(t *testing.T) {
	skipWithoutResponder(t)
	const service = "_hydristest._tcp"
	instance := uniqueInstance(t)
	peers := newTestPeers(instance)

	stopBrowse, err := dnssdBrowse(service, peers.onSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer stopBrowse()

	stopAdv, err := dnssdAdvertise(instance, service, 50099, map[string]string{"fp": "deadbeef", "node": "n1"})
	if err != nil {
		t.Fatal(err)
	}
	defer stopAdv()

	peer := peers.waitFor(t, true)
	if peer.Port != 50099 {
		t.Errorf("port = %d, want 50099", peer.Port)
	}
	if want := map[string]string{"fp": "deadbeef", "node": "n1"}; !reflect.DeepEqual(peer.Txt, want) {
		t.Errorf("txt = %v, want %v", peer.Txt, want)
	}
	if peer.Hostname == "" || strings.HasSuffix(peer.Hostname, ".") {
		t.Errorf("hostname = %q", peer.Hostname)
	}
	if len(peer.Addrs) == 0 {
		t.Fatal("no addresses resolved")
	}
	for _, a := range peer.Addrs {
		if ip := net.ParseIP(a); ip == nil || ip.To4() == nil || ip.IsLoopback() {
			t.Errorf("unusable address %q", a)
		}
	}

	// Goodbye: stopping the advertiser removes the peer without waiting on a TTL.
	stopAdv()
	peers.waitFor(t, false)
}

// The daemon going away is simulated by shutting down the operation's socket,
// which reads as EOF just as a real restart does.
func TestDNSSDRecoversFromLostDaemon(t *testing.T) {
	skipWithoutResponder(t)
	const service = "_hydristest._tcp"
	instance := uniqueInstance(t)
	peers := newTestPeers(instance)

	adv, err := newDNSSDAdvertiser(instance, service, 50098, nil)
	if err != nil {
		t.Fatal(err)
	}
	advFDs := startForTest(t, adv)

	b, err := newDNSSDBrowser(service, peers.onSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	browseFDs := startForTest(t, b.s)
	peers.waitFor(t, true)

	for _, fd := range append(browseFDs, advFDs...) {
		if err := unix.Shutdown(int(fd), unix.SHUT_RDWR); err != nil {
			t.Fatal(err)
		}
	}
	peers.waitFor(t, false)
	peers.waitFor(t, true)
}

func TestDNSSDStopIsIdempotentAndQuiet(t *testing.T) {
	skipWithoutResponder(t)
	calls := make(chan struct{}, 64)
	stop, err := dnssdBrowse("_hydristest._tcp", func([]hal.MDNSPeer) { calls <- struct{}{} })
	if err != nil {
		t.Fatal(err)
	}
	stop()
	stop()
	for len(calls) > 0 {
		<-calls
	}
	time.Sleep(200 * time.Millisecond)
	if len(calls) != 0 {
		t.Error("callback ran after stop returned")
	}
}

func TestDNSSDReleasesResources(t *testing.T) {
	skipWithoutResponder(t)
	const service = "_hydristest._tcp"
	before := countOpenFDs(t)
	for i := range 3 {
		instance := fmt.Sprintf("%s-%d", uniqueInstance(t), i)
		peers := newTestPeers(instance)
		stopBrowse, err := dnssdBrowse(service, peers.onSnapshot)
		if err != nil {
			t.Fatal(err)
		}
		stopAdv, err := dnssdAdvertise(instance, service, 50097, nil)
		if err != nil {
			t.Fatal(err)
		}
		peers.waitFor(t, true)
		stopAdv()
		stopBrowse()
	}
	if after := countOpenFDs(t); after > before {
		t.Errorf("leaked file descriptors: %d before, %d after", before, after)
	}
	dnssdHandlersMu.Lock()
	defer dnssdHandlersMu.Unlock()
	if n := len(dnssdHandlers); n != 0 {
		t.Errorf("%d handlers left registered", n)
	}
}

// startForTest opens a session and returns its socket fds, read before the
// session goroutine takes ownership of them.
func startForTest(t *testing.T, s *dnssdSession) []int32 {
	t.Helper()
	if err := s.open(); err != nil {
		t.Fatal(err)
	}
	var fds []int32
	for r := range s.refs {
		fds = append(fds, r.fd)
	}
	go s.run()
	t.Cleanup(s.stop)
	return fds
}

func countOpenFDs(t *testing.T) int {
	t.Helper()
	open := 0
	for fd := range 4096 {
		if _, err := unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0); err == nil {
			open++
		}
	}
	return open
}
