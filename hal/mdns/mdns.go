// Package mdns is a minimal hand-made mDNS/DNS-SD implementation (RFC 6762,
// RFC 6763): the fallback on Linux and macOS when Avahi or mDNSResponder is
// unavailable, and the direct implementation on Windows. IPv4-only, one shared
// multicast socket, periodic re-queries, no conflict resolution.
package mdns

import (
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/projectqai/hydris/hal"
	"golang.org/x/net/dns/dnsmessage"
	"golang.org/x/net/ipv4"
)

var (
	mdnsGroup = net.IPv4(224, 0, 0, 251)
	mdnsAddr  = &net.UDPAddr{IP: mdnsGroup, Port: 5353}
)

const (
	recordTTL          = 120              // seconds, for all published records
	queryInterval      = 15 * time.Second // browse re-query cadence
	peerExpiry         = 50 * time.Second // drop peers not seen for ~3 queries
	reannounceInterval = 60 * time.Second // unsolicited refresh for lossy networks
	maxPacket          = 9000
)

// cache-flush bit on the RR class, set on unique (non-shared) records.
const classCacheFlush = dnsmessage.Class(0x8001)

// Advertise announces instance.service.local on all attached networks.
func Advertise(instance, service string, port int, txt map[string]string) (stop func(), err error) {
	r, err := newResponder(instance, service, port, txt)
	if err != nil {
		return nil, err
	}

	t, err := acquireTransport()
	if err != nil {
		return nil, err
	}
	r.t = t
	t.addHandler(r)

	// Announce now, again after a second (RFC 6762 startup), then refresh
	// periodically: multicast is lossy on real Wi-Fi and some browsers
	// (NsdManager caches) only hear unsolicited announcements reliably.
	stopCh := make(chan struct{})
	go func() {
		r.announce(recordTTL)
		next := time.NewTimer(time.Second)
		defer next.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-next.C:
				r.announce(recordTTL)
				next.Reset(reannounceInterval)
			}
		}
	}()

	var once sync.Once
	return func() {
		once.Do(func() {
			close(stopCh)
			r.announce(0) // goodbye
			t.removeHandler(r)
			releaseTransport()
		})
	}, nil
}

// Browse discovers instances of a DNS-SD service type; the callback receives
// a full snapshot whenever the visible set changes.
func Browse(service string, cb func([]hal.MDNSPeer)) (stop func(), err error) {
	b := &browser{
		cb:        cb,
		instances: make(map[string]*instanceState),
		stopCh:    make(chan struct{}),
	}
	if b.serviceName, err = serviceFQDN(service); err != nil {
		return nil, err
	}

	t, err := acquireTransport()
	if err != nil {
		return nil, err
	}
	b.t = t
	t.addHandler(b)
	go b.loop()

	var once sync.Once
	return func() {
		once.Do(func() {
			close(b.stopCh)
			t.removeHandler(b)
			releaseTransport()
		})
	}, nil
}

func serviceFQDN(service string) (dnsmessage.Name, error) {
	return name(strings.Trim(service, ".") + ".local.")
}

func name(s string) (dnsmessage.Name, error) {
	return dnsmessage.NewName(strings.ToLower(s))
}

// packetHandler receives every mDNS packet seen on the shared socket.
type packetHandler interface {
	handlePacket(msg []byte, ifIndex int)
}

// transport is the process-wide shared mDNS socket: mDNS requires everyone to
// share port 5353.
type transport struct {
	pc     *ipv4.PacketConn
	udp    net.PacketConn
	mu     sync.Mutex
	joined map[int]*net.Interface // ifindex -> joined interface
	hmu    sync.Mutex
	hs     map[packetHandler]struct{}
}

var (
	transportMu   sync.Mutex
	transportRefs int
	theTransport  *transport
)

func acquireTransport() (*transport, error) {
	transportMu.Lock()
	defer transportMu.Unlock()
	if transportRefs == 0 {
		t, err := openTransport()
		if err != nil {
			return nil, err
		}
		theTransport = t
	}
	transportRefs++
	return theTransport, nil
}

func releaseTransport() {
	transportMu.Lock()
	defer transportMu.Unlock()
	transportRefs--
	if transportRefs == 0 {
		_ = theTransport.udp.Close()
		theTransport = nil
	}
}

func openTransport() (*transport, error) {
	udp, err := listenMDNS()
	if err != nil {
		return nil, fmt.Errorf("mdns listen: %w", err)
	}
	pc := ipv4.NewPacketConn(udp)
	_ = pc.SetControlMessage(ipv4.FlagInterface, true)
	_ = pc.SetMulticastTTL(255)
	_ = pc.SetMulticastLoopback(true)

	t := &transport{
		pc:     pc,
		udp:    udp,
		joined: make(map[int]*net.Interface),
		hs:     make(map[packetHandler]struct{}),
	}
	t.joinAll()
	go t.readLoop()
	return t, nil
}

func (t *transport) addHandler(h packetHandler) {
	t.hmu.Lock()
	t.hs[h] = struct{}{}
	t.hmu.Unlock()
}

func (t *transport) removeHandler(h packetHandler) {
	t.hmu.Lock()
	delete(t.hs, h)
	t.hmu.Unlock()
}

// joinAll joins the mDNS group on every eligible interface not yet joined;
// called at startup and before each periodic send to pick up new interfaces.
func (t *transport) joinAll() {
	ifaces, err := net.Interfaces()
	if err != nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	for i := range ifaces {
		ifi := ifaces[i]
		if ifi.Flags&net.FlagUp == 0 || ifi.Flags&net.FlagMulticast == 0 {
			continue
		}
		if _, ok := t.joined[ifi.Index]; ok {
			continue
		}
		if err := t.pc.JoinGroup(&ifi, &net.UDPAddr{IP: mdnsGroup}); err == nil {
			t.joined[ifi.Index] = &ifi
		}
	}
}

// send multicasts msg on the given interface, or all joined ones when ifIndex is 0.
func (t *transport) send(msg []byte, ifIndex int) {
	t.joinAll()
	t.mu.Lock()
	var targets []*net.Interface
	if ifIndex != 0 {
		if ifi, ok := t.joined[ifIndex]; ok {
			targets = []*net.Interface{ifi}
		}
	}
	if targets == nil {
		for _, ifi := range t.joined {
			targets = append(targets, ifi)
		}
	}
	t.mu.Unlock()
	for _, ifi := range targets {
		_ = t.pc.SetMulticastInterface(ifi)
		_, _ = t.pc.WriteTo(msg, nil, mdnsAddr)
	}
}

func (t *transport) readLoop() {
	buf := make([]byte, maxPacket)
	for {
		n, cm, _, err := t.pc.ReadFrom(buf)
		if err != nil {
			return // socket closed
		}
		msg := make([]byte, n)
		copy(msg, buf[:n])
		ifIndex := 0
		if cm != nil {
			ifIndex = cm.IfIndex
		}
		t.hmu.Lock()
		hs := make([]packetHandler, 0, len(t.hs))
		for h := range t.hs {
			hs = append(hs, h)
		}
		t.hmu.Unlock()
		for _, h := range hs {
			h.handlePacket(msg, ifIndex)
		}
	}
}

// ifaceIPv4s returns the IPv4 addresses of the given interface, or of all
// joined interfaces when ifIndex is 0 or unknown.
func (t *transport) ifaceIPv4s(ifIndex int) []net.IP {
	t.mu.Lock()
	var ifaces []*net.Interface
	if ifi, ok := t.joined[ifIndex]; ok {
		ifaces = []*net.Interface{ifi}
	} else {
		for _, ifi := range t.joined {
			ifaces = append(ifaces, ifi)
		}
	}
	t.mu.Unlock()

	var ips []net.IP
	for _, ifi := range ifaces {
		addrs, err := ifi.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			if ip4 := ipnet.IP.To4(); ip4 != nil && !ip4.IsLoopback() {
				ips = append(ips, ip4)
			}
		}
	}
	return ips
}

// responder answers queries for one advertised service instance.
type responder struct {
	t            *transport
	instance     string
	service      string
	port         int
	txt          map[string]string
	serviceName  dnsmessage.Name
	instanceName dnsmessage.Name
	hostName     dnsmessage.Name
}

func newResponder(instance, service string, port int, txt map[string]string) (*responder, error) {
	r := &responder{
		instance: instance,
		service:  service,
		port:     port,
		txt:      txt,
	}
	var err error
	if r.serviceName, err = serviceFQDN(service); err != nil {
		return nil, err
	}
	if r.instanceName, err = name(instance + "." + strings.Trim(service, ".") + ".local."); err != nil {
		return nil, err
	}
	// Publish under a hostname derived from the instance so we never fight a
	// system responder over the machine's own <hostname>.local.
	if r.hostName, err = name(instance + ".local."); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *responder) handlePacket(msg []byte, ifIndex int) {
	var p dnsmessage.Parser
	h, err := p.Start(msg)
	if err != nil || h.Response {
		return
	}
	asked := false
	for {
		q, err := p.Question()
		if err != nil {
			break
		}
		qn := strings.ToLower(q.Name.String())
		switch q.Type {
		case dnsmessage.TypePTR, dnsmessage.TypeALL:
			if qn == r.serviceName.String() {
				asked = true
			}
		}
		switch q.Type {
		case dnsmessage.TypeSRV, dnsmessage.TypeTXT, dnsmessage.TypeALL:
			if qn == r.instanceName.String() {
				asked = true
			}
		}
		switch q.Type {
		case dnsmessage.TypeA, dnsmessage.TypeALL:
			if qn == r.hostName.String() {
				asked = true
			}
		}
	}
	if asked {
		if out := r.buildResponse(recordTTL, ifIndex); out != nil {
			r.t.send(out, ifIndex)
		}
	}
}

// announce multicasts an unsolicited response on all interfaces; ttl 0 is the
// goodbye packet.
func (r *responder) announce(ttl uint32) {
	// Per-interface so each network only sees that network's addresses.
	r.t.joinAll()
	r.t.mu.Lock()
	indexes := make([]int, 0, len(r.t.joined))
	for idx := range r.t.joined {
		indexes = append(indexes, idx)
	}
	r.t.mu.Unlock()
	for _, idx := range indexes {
		if out := r.buildResponse(ttl, idx); out != nil {
			r.t.send(out, idx)
		}
	}
}

func (r *responder) buildResponse(ttl uint32, ifIndex int) []byte {
	return r.encode(ttl, r.t.ifaceIPv4s(ifIndex))
}

// encode builds the response publishing the instance at ips; ttl 0 makes it
// the goodbye.
func (r *responder) encode(ttl uint32, ips []net.IP) []byte {
	if len(ips) == 0 {
		return nil
	}

	b := dnsmessage.NewBuilder(make([]byte, 0, 512), dnsmessage.Header{
		Response:      true,
		Authoritative: true,
	})
	b.EnableCompression()
	if err := b.StartAnswers(); err != nil {
		return nil
	}
	hdr := func(n dnsmessage.Name, cls dnsmessage.Class) dnsmessage.ResourceHeader {
		return dnsmessage.ResourceHeader{Name: n, Class: cls, TTL: ttl}
	}
	if err := b.PTRResource(hdr(r.serviceName, dnsmessage.ClassINET),
		dnsmessage.PTRResource{PTR: r.instanceName}); err != nil {
		return nil
	}
	if err := b.SRVResource(hdr(r.instanceName, classCacheFlush),
		dnsmessage.SRVResource{Port: uint16(r.port), Target: r.hostName}); err != nil {
		return nil
	}
	var txts []string
	for _, k := range sortedKeys(r.txt) {
		txts = append(txts, k+"="+r.txt[k])
	}
	if len(txts) == 0 {
		txts = []string{""}
	}
	if err := b.TXTResource(hdr(r.instanceName, classCacheFlush),
		dnsmessage.TXTResource{TXT: txts}); err != nil {
		return nil
	}
	for _, ip := range ips {
		var a [4]byte
		copy(a[:], ip.To4())
		if err := b.AResource(hdr(r.hostName, classCacheFlush),
			dnsmessage.AResource{A: a}); err != nil {
			return nil
		}
	}
	out, err := b.Finish()
	if err != nil {
		return nil
	}
	return out
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// instanceState is one discovered instance of the browsed service.
type instanceState struct {
	hostname string
	port     int
	txt      map[string]string
	lastSeen time.Time
}

// addrKey is an A record as heard on one interface. Caching per interface,
// as mDNSResponder and Avahi do, lets a cache-flush replace only what that
// network reported.
type addrKey struct {
	ip      string
	ifIndex int
}

// hostState holds the A records of one host name. Addresses belong to the
// host, not to an instance: instances can share a host, e.g. everything
// Avahi publishes under the machine's own hostname.
type hostState struct {
	addrs map[addrKey]time.Time // last seen, so changed IPs age out
}

func (h *hostState) has(ip string) bool {
	for k := range h.addrs {
		if k.ip == ip {
			return true
		}
	}
	return false
}

// byRecency lists the host's addresses most recently seen first, so
// consumers that take the first address follow the host to a new one as soon
// as it announces.
func (h *hostState) byRecency() []string {
	latest := make(map[string]time.Time, len(h.addrs))
	for k, seen := range h.addrs {
		if seen.After(latest[k.ip]) {
			latest[k.ip] = seen
		}
	}
	addrs := make([]string, 0, len(latest))
	for a := range latest {
		addrs = append(addrs, a)
	}
	sort.Slice(addrs, func(i, j int) bool {
		ti, tj := latest[addrs[i]], latest[addrs[j]]
		if !ti.Equal(tj) {
			return ti.After(tj)
		}
		return addrs[i] < addrs[j]
	})
	return addrs
}

// browser queries for a service type and tracks visible instances.
type browser struct {
	t           *transport
	serviceName dnsmessage.Name
	cb          func([]hal.MDNSPeer)
	stopCh      chan struct{}

	mu        sync.Mutex
	instances map[string]*instanceState // instance FQDN -> state
	hosts     map[string]*hostState     // host FQDN -> addresses
	dirty     bool
}

func (b *browser) loop() {
	b.query()
	queryT := time.NewTicker(queryInterval)
	sweepT := time.NewTicker(2 * time.Second)
	defer queryT.Stop()
	defer sweepT.Stop()
	for {
		select {
		case <-b.stopCh:
			return
		case <-queryT.C:
			b.query()
		case <-sweepT.C:
			b.sweep()
		}
	}
}

func (b *browser) query() {
	bld := dnsmessage.NewBuilder(make([]byte, 0, 64), dnsmessage.Header{})
	bld.EnableCompression()
	if err := bld.StartQuestions(); err != nil {
		return
	}
	if err := bld.Question(dnsmessage.Question{
		Name:  b.serviceName,
		Type:  dnsmessage.TypePTR,
		Class: dnsmessage.ClassINET,
	}); err != nil {
		return
	}
	msg, err := bld.Finish()
	if err != nil {
		return
	}
	b.t.send(msg, 0)
}

func (b *browser) handlePacket(msg []byte, ifIndex int) {
	var p dnsmessage.Parser
	h, err := p.Start(msg)
	if err != nil || !h.Response {
		return
	}
	if err := p.SkipAllQuestions(); err != nil {
		return
	}
	rrs := readRecords(&p)

	now := time.Now()
	b.mu.Lock()
	defer b.mu.Unlock()
	// An A record is kept only for a host some instance points at, and
	// responders do not order records (Avahi jitters them), so apply the A
	// records after the SRVs of the same packet.
	for _, rr := range rrs {
		if rr.Header.Type != dnsmessage.TypeA {
			b.record(rr, ifIndex, now)
		}
	}
	for _, rr := range rrs {
		if rr.Header.Type == dnsmessage.TypeA {
			b.record(rr, ifIndex, now)
		}
	}
}

// readRecords returns the PTR, SRV, TXT and A records of the answer and
// additional sections, which both carry usable records. A parse error leaves
// the parser on the same record, so reading stops at the first one.
func readRecords(p *dnsmessage.Parser) []dnsmessage.Resource {
	var rrs []dnsmessage.Resource
	read := func(next func() (dnsmessage.ResourceHeader, error)) bool {
		for {
			rh, err := next()
			if errors.Is(err, dnsmessage.ErrSectionDone) {
				return true
			}
			if err != nil {
				return false
			}
			body, err := readBody(p, rh.Type)
			if err != nil {
				return false
			}
			if body != nil {
				rrs = append(rrs, dnsmessage.Resource{Header: rh, Body: body})
			}
		}
	}
	if !read(p.AnswerHeader) {
		return rrs
	}
	if err := p.SkipAllAuthorities(); err != nil {
		return rrs
	}
	read(p.AdditionalHeader)
	return rrs
}

// readBody parses the body of a record the browser uses and skips any other.
func readBody(p *dnsmessage.Parser, typ dnsmessage.Type) (dnsmessage.ResourceBody, error) {
	switch typ {
	case dnsmessage.TypePTR:
		r, err := p.PTRResource()
		return &r, err
	case dnsmessage.TypeSRV:
		r, err := p.SRVResource()
		return &r, err
	case dnsmessage.TypeTXT:
		r, err := p.TXTResource()
		return &r, err
	case dnsmessage.TypeA:
		r, err := p.AResource()
		return &r, err
	default:
		_, err := p.UnknownResource()
		return nil, err
	}
}

// record folds one resource record into the instance and host tables.
func (b *browser) record(rr dnsmessage.Resource, ifIndex int, now time.Time) {
	rname := strings.ToLower(rr.Header.Name.String())
	// TTL 0 is a goodbye (RFC 6762 §10.1): it withdraws a record and must
	// never create or refresh state.
	goodbye := rr.Header.TTL == 0
	switch body := rr.Body.(type) {
	case *dnsmessage.PTRResource:
		inst := strings.ToLower(body.PTR.String())
		if rname != b.serviceName.String() || !b.ownInstance(inst) {
			return
		}
		if goodbye {
			b.removeInstance(inst)
			return
		}
		b.instance(inst).lastSeen = now
	case *dnsmessage.SRVResource:
		// Every mDNS packet on the link reaches us; other services' records
		// must not join the snapshot.
		if !b.ownInstance(rname) {
			return
		}
		host := strings.ToLower(body.Target.String())
		port := int(body.Port)
		if goodbye {
			// Only the withdrawal of the SRV we hold ends the instance, not a
			// late goodbye for the one it replaced.
			if st, ok := b.instances[rname]; ok && st.hostname == host && st.port == port {
				b.removeInstance(rname)
			}
			return
		}
		st := b.instance(rname)
		if st.hostname != host || st.port != port {
			st.hostname = host
			st.port = port
			b.dirty = true
		}
		st.lastSeen = now
	case *dnsmessage.TXTResource:
		if goodbye || !b.ownInstance(rname) {
			return
		}
		st := b.instance(rname)
		txt := make(map[string]string, len(body.TXT))
		for _, s := range body.TXT {
			if s == "" {
				continue
			}
			k, v, _ := strings.Cut(s, "=")
			txt[k] = v
		}
		if !mapsEqual(st.txt, txt) {
			st.txt = txt
			b.dirty = true
		}
		st.lastSeen = now
	case *dnsmessage.AResource:
		ip := net.IP(body.A[:]).String()
		b.address(rname, ip, rr.Header.Class&0x8000 != 0, goodbye, ifIndex, now)
	}
}

// ownInstance reports whether fqdn names an instance of the browsed service,
// <instance>.<service>.local.
func (b *browser) ownInstance(fqdn string) bool {
	inst, ok := strings.CutSuffix(fqdn, "."+b.serviceName.String())
	return ok && inst != ""
}

func (b *browser) instance(fqdn string) *instanceState {
	st, ok := b.instances[fqdn]
	if !ok {
		st = &instanceState{}
		b.instances[fqdn] = st
		b.dirty = true
	}
	return st
}

func (b *browser) removeInstance(fqdn string) {
	if _, ok := b.instances[fqdn]; ok {
		delete(b.instances, fqdn)
		b.dirty = true
	}
}

// address folds one A record into its host's address set. Only hosts that an
// instance points at are tracked.
func (b *browser) address(host, ip string, flush, goodbye bool, ifIndex int, now time.Time) {
	if !b.hostInUse(host) {
		return
	}
	hs := b.hosts[host]
	if hs == nil {
		if goodbye {
			return
		}
		if b.hosts == nil {
			b.hosts = make(map[string]*hostState)
		}
		hs = &hostState{addrs: make(map[addrKey]time.Time)}
		b.hosts[host] = hs
	}
	key := addrKey{ip: ip, ifIndex: ifIndex}
	if goodbye {
		b.dropAddr(hs, key)
		return
	}
	// RFC 6762 §10.2: the cache-flush bit replaces all records of this name
	// and type older than one second, so a host that changed address sheds
	// the old one immediately instead of after expiry. The flush stays on the
	// interface the record arrived on: a peer on two networks answers each
	// query only where it was asked, and must not lose its other address
	// whenever a node on just one network asks. The one-second grace keeps a
	// multi-homed host's addresses, which arrive in separate per-interface
	// responses on the same network, from evicting each other.
	if flush {
		for k, seen := range hs.addrs {
			if k.ifIndex == ifIndex && k.ip != ip && now.Sub(seen) > time.Second {
				b.dropAddr(hs, k)
			}
		}
	}
	if !hs.has(ip) {
		b.dirty = true
	}
	hs.addrs[key] = now
}

func (b *browser) dropAddr(hs *hostState, k addrKey) {
	if _, ok := hs.addrs[k]; !ok {
		return
	}
	delete(hs.addrs, k)
	if !hs.has(k.ip) {
		b.dirty = true
	}
}

func (b *browser) hostInUse(host string) bool {
	for _, st := range b.instances {
		if st.hostname == host {
			return true
		}
	}
	return false
}

// sweep expires stale instances and addresses and delivers a snapshot when
// anything changed.
func (b *browser) sweep() {
	now := time.Now()
	b.mu.Lock()
	for inst, st := range b.instances {
		if now.Sub(st.lastSeen) > peerExpiry {
			delete(b.instances, inst)
			b.dirty = true
		}
	}
	for host, hs := range b.hosts {
		if !b.hostInUse(host) {
			delete(b.hosts, host) // its instances are gone
			continue
		}
		for k, seen := range hs.addrs {
			if now.Sub(seen) > peerExpiry {
				b.dropAddr(hs, k)
			}
		}
		if len(hs.addrs) == 0 {
			delete(b.hosts, host)
		}
	}
	if !b.dirty {
		b.mu.Unlock()
		return
	}
	b.dirty = false
	peers := b.snapshotLocked()
	b.mu.Unlock()
	b.cb(peers)
}

func (b *browser) snapshotLocked() []hal.MDNSPeer {
	peers := make([]hal.MDNSPeer, 0, len(b.instances))
	suffix := "." + b.serviceName.String()
	for fqdn, st := range b.instances {
		hs := b.hosts[st.hostname]
		if st.hostname == "" || hs == nil || len(hs.addrs) == 0 {
			continue // not fully resolved yet
		}
		peers = append(peers, hal.MDNSPeer{
			Instance: strings.TrimSuffix(fqdn, suffix),
			Hostname: strings.TrimSuffix(st.hostname, "."),
			Addrs:    hs.byRecency(),
			Port:     st.port,
			Txt:      st.txt,
		})
	}
	sort.Slice(peers, func(i, j int) bool { return peers[i].Instance < peers[j].Instance })
	return peers
}

func mapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}
