package platform

import (
	"fmt"
	"log/slog"
	"net"
	"sort"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
	"github.com/projectqai/hydris/hal"
	"golang.org/x/sys/unix"
)

// DNS-SD client for the system mDNSResponder (dns_sd.h in libSystem), so we
// cooperate with the host's zeroconf stack instead of sending raw multicast,
// which macOS can refuse per binary; hal/mdns is the fallback.

const (
	dnssdLibrary = "/usr/lib/libSystem.B.dylib"
	dnssdDomain  = "local."

	dnssdFlagAdd     = uint32(0x2)
	dnssdProtoIPv4   = uint32(0x1) // IPv4 only, matching the hand-made fallback
	dnssdIfaceAny    = uint32(0)
	dnssdNoError     = int32(0)
	dnssdPolicyError = int32(-65570) // kDNSServiceErr_PolicyDenied

	dnssdRetryInterval = 5 * time.Second
	dnssdMaxTXTEntry   = 255
)

var dnssd struct {
	once sync.Once
	err  error

	register func(ref *uintptr, flags, ifIndex uint32, name, regtype, domain string, host uintptr, port, txtLen uint16, txt *byte, cb, ctx uintptr) int32
	browse   func(ref *uintptr, flags, ifIndex uint32, regtype, domain string, cb, ctx uintptr) int32
	resolve  func(ref *uintptr, flags, ifIndex uint32, name, regtype, domain string, cb, ctx uintptr) int32
	addrInfo func(ref *uintptr, flags, ifIndex, protocol uint32, host string, cb, ctx uintptr) int32
	sockFD   func(ref uintptr) int32
	process  func(ref uintptr) int32
	dealloc  func(ref uintptr)

	registerCB, browseCB, resolveCB, addrInfoCB uintptr
}

// Handlers are looked up by the context id passed through C, because purego
// callbacks are never freed and Go pointers must not be handed to C.
type (
	dnssdRegisterFunc func(errCode int32, name string)
	dnssdBrowseFunc   func(flags, ifIndex uint32, errCode int32, name, regtype, domain string)
	dnssdResolveFunc  func(errCode int32, host string, port uint16, txt []byte)
	dnssdAddrFunc     func(flags uint32, errCode int32, sockaddr *[8]byte)
)

var (
	dnssdHandlersMu sync.Mutex
	dnssdHandlers   = make(map[uintptr]any)
	dnssdNextID     uintptr
)

func dnssdHandler[T any](ctx uintptr) (T, bool) {
	dnssdHandlersMu.Lock()
	defer dnssdHandlersMu.Unlock()
	h, ok := dnssdHandlers[ctx].(T)
	return h, ok
}

func dnssdLoad() error {
	dnssd.once.Do(func() {
		lib, err := purego.Dlopen(dnssdLibrary, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			dnssd.err = fmt.Errorf("load %s: %w", dnssdLibrary, err)
			return
		}
		purego.RegisterLibFunc(&dnssd.register, lib, "DNSServiceRegister")
		purego.RegisterLibFunc(&dnssd.browse, lib, "DNSServiceBrowse")
		purego.RegisterLibFunc(&dnssd.resolve, lib, "DNSServiceResolve")
		purego.RegisterLibFunc(&dnssd.addrInfo, lib, "DNSServiceGetAddrInfo")
		purego.RegisterLibFunc(&dnssd.sockFD, lib, "DNSServiceRefSockFD")
		purego.RegisterLibFunc(&dnssd.process, lib, "DNSServiceProcessResult")
		purego.RegisterLibFunc(&dnssd.dealloc, lib, "DNSServiceRefDeallocate")

		dnssd.registerCB = purego.NewCallback(func(_ uintptr, _ uint32, errCode int32, name, _, _ *byte, ctx uintptr) uintptr {
			if h, ok := dnssdHandler[dnssdRegisterFunc](ctx); ok {
				h(errCode, cString(name))
			}
			return 0
		})
		dnssd.browseCB = purego.NewCallback(func(_ uintptr, flags, ifIndex uint32, errCode int32, name, regtype, domain *byte, ctx uintptr) uintptr {
			if h, ok := dnssdHandler[dnssdBrowseFunc](ctx); ok {
				h(flags, ifIndex, errCode, cString(name), cString(regtype), cString(domain))
			}
			return 0
		})
		dnssd.resolveCB = purego.NewCallback(func(_ uintptr, _, _ uint32, errCode int32, _, host *byte, port, txtLen uint16, txt *byte, ctx uintptr) uintptr {
			if h, ok := dnssdHandler[dnssdResolveFunc](ctx); ok {
				var record []byte
				if txt != nil && txtLen > 0 {
					record = unsafe.Slice(txt, int(txtLen))
				}
				h(errCode, cString(host), port>>8|port<<8, record)
			}
			return 0
		})
		dnssd.addrInfoCB = purego.NewCallback(func(_ uintptr, flags, _ uint32, errCode int32, _ *byte, sockaddr *[8]byte, _ uint32, ctx uintptr) uintptr {
			if h, ok := dnssdHandler[dnssdAddrFunc](ctx); ok {
				h(flags, errCode, sockaddr)
			}
			return 0
		})
	})
	return dnssd.err
}

func cString(p *byte) string {
	if p == nil {
		return ""
	}
	return unix.BytePtrToString(p)
}

func dnssdError(code int32) error {
	switch code {
	case dnssdPolicyError:
		return fmt.Errorf("denied by policy, check Local Network access (dnssd error %d)", code)
	case -65563:
		return fmt.Errorf("mDNSResponder not running (dnssd error %d)", code)
	}
	return fmt.Errorf("dnssd error %d", code)
}

// dnssdRef is one in-flight DNS-SD operation with its own daemon socket.
type dnssdRef struct {
	ref uintptr
	fd  int32
	id  uintptr
}

// dnssdSession owns a set of operations and services them from one goroutine,
// which is what makes them safe: refs are not thread-safe and handlers run on
// that goroutine, so they may add and close other refs without locking.
type dnssdSession struct {
	open    func() error // creates the root operations, again after a lost connection
	reset   func()       // forgets everything learned over the lost connection
	deliver func()       // runs between batches, outside any C callback

	refs     map[*dnssdRef]struct{}
	wakeR    int
	wakeW    int
	stopOnce sync.Once
	done     chan struct{}
}

func newDNSSDSession() (*dnssdSession, error) {
	if err := dnssdLoad(); err != nil {
		return nil, err
	}
	var wake [2]int
	if err := unix.Pipe(wake[:]); err != nil {
		return nil, fmt.Errorf("dnssd wake pipe: %w", err)
	}
	unix.CloseOnExec(wake[0])
	unix.CloseOnExec(wake[1])
	return &dnssdSession{
		reset:   func() {},
		deliver: func() {},
		refs:    make(map[*dnssdRef]struct{}),
		wakeR:   wake[0],
		wakeW:   wake[1],
		done:    make(chan struct{}),
	}, nil
}

// addRef starts an operation; start receives the context id for the callback.
func (s *dnssdSession) addRef(handler any, start func(ref *uintptr, ctx uintptr) int32) (*dnssdRef, error) {
	dnssdHandlersMu.Lock()
	dnssdNextID++
	id := dnssdNextID
	dnssdHandlers[id] = handler
	dnssdHandlersMu.Unlock()

	r := &dnssdRef{id: id}
	if code := start(&r.ref, id); code != dnssdNoError {
		dnssdForget(id)
		return nil, dnssdError(code)
	}
	r.fd = dnssd.sockFD(r.ref)
	if r.fd < 0 {
		dnssd.dealloc(r.ref)
		dnssdForget(id)
		return nil, fmt.Errorf("dnssd: no socket for operation")
	}
	// Plugins are spawned as child processes and must not inherit the socket,
	// or the daemon would keep our registrations alive after we stop.
	unix.CloseOnExec(int(r.fd))
	s.refs[r] = struct{}{}
	return r, nil
}

func dnssdForget(id uintptr) {
	dnssdHandlersMu.Lock()
	delete(dnssdHandlers, id)
	dnssdHandlersMu.Unlock()
}

// closeRef stops an operation. Must not be called from that ref's own handler.
func (s *dnssdSession) closeRef(r *dnssdRef) {
	if r == nil {
		return
	}
	if _, ok := s.refs[r]; !ok {
		return
	}
	delete(s.refs, r)
	dnssd.dealloc(r.ref)
	dnssdForget(r.id)
}

func (s *dnssdSession) closeAll() {
	for r := range s.refs {
		s.closeRef(r)
	}
}

func (s *dnssdSession) closePipe() {
	_ = unix.Close(s.wakeR)
	_ = unix.Close(s.wakeW)
}

// start opens the root operations and begins servicing them. The returned stop
// waits for the goroutine, so handlers never run afterwards; a snapshot callback
// must therefore not call stop itself.
func (s *dnssdSession) start() (stop func(), err error) {
	if err := s.open(); err != nil {
		s.closeAll()
		s.closePipe()
		return nil, err
	}
	go s.run()
	return s.stop, nil
}

func (s *dnssdSession) stop() {
	s.stopOnce.Do(func() {
		_, _ = unix.Write(s.wakeW, []byte{0})
	})
	<-s.done
}

func (s *dnssdSession) run() {
	defer close(s.done)
	defer s.closePipe()
	defer s.closeAll()

	var retryAt time.Time
	for {
		refs := make([]*dnssdRef, 0, len(s.refs))
		fds := make([]unix.PollFd, 0, len(s.refs)+1)
		fds = append(fds, unix.PollFd{Fd: int32(s.wakeR), Events: unix.POLLIN})
		for r := range s.refs {
			refs = append(refs, r)
			fds = append(fds, unix.PollFd{Fd: r.fd, Events: unix.POLLIN})
		}

		timeout := -1
		if !retryAt.IsZero() {
			timeout = max(int(time.Until(retryAt).Milliseconds()), 0)
		}
		_, err := unix.Poll(fds, timeout)
		if err == unix.EINTR || err == unix.EAGAIN {
			continue
		}
		if err == nil && fds[0].Revents != 0 {
			return
		}

		lost := err
		if err == nil {
			for i, r := range refs {
				if fds[i+1].Revents == 0 {
					continue
				}
				if _, ok := s.refs[r]; !ok {
					continue // closed by an earlier handler in this batch
				}
				if code := dnssd.process(r.ref); code != dnssdNoError {
					lost = dnssdError(code)
					break
				}
			}
		}

		switch {
		case lost != nil:
			slog.Warn("lost connection to mDNSResponder, reconnecting", "error", lost)
			s.closeAll()
			s.reset()
			retryAt = time.Now().Add(dnssdRetryInterval)
		case !retryAt.IsZero() && !time.Now().Before(retryAt):
			if err := s.open(); err != nil {
				slog.Debug("mDNSResponder reconnect failed", "error", err)
				s.closeAll()
				retryAt = time.Now().Add(dnssdRetryInterval)
			} else {
				retryAt = time.Time{}
			}
		}
		s.deliver()
	}
}

// dnssdLogCallbackError reports a failure delivered through a callback. Local
// Network denials arrive this way rather than from the initial call, and clear
// by themselves once the user grants access.
func dnssdLogCallbackError(op string, code int32) {
	if code == dnssdPolicyError {
		slog.Warn("mDNS blocked, grant Hydris Local Network access in System Settings", "op", op)
		return
	}
	slog.Debug("mDNS operation failed", "op", op, "error", dnssdError(code))
}

func dnssdAdvertise(instance, service string, port int, txt map[string]string) (stop func(), err error) {
	s, err := newDNSSDAdvertiser(instance, service, port, txt)
	if err != nil {
		return nil, err
	}
	return s.start()
}

func newDNSSDAdvertiser(instance, service string, port int, txt map[string]string) (*dnssdSession, error) {
	record, err := encodeTXT(txt)
	if err != nil {
		return nil, err
	}
	s, err := newDNSSDSession()
	if err != nil {
		return nil, err
	}

	var handler dnssdRegisterFunc = func(errCode int32, name string) {
		if errCode != dnssdNoError {
			dnssdLogCallbackError("register", errCode)
			return
		}
		if name != instance {
			slog.Info("mDNS instance renamed after a conflict", "requested", instance, "registered", name)
		}
	}
	networkPort := uint16(port)>>8 | uint16(port)<<8
	s.open = func() error {
		_, err := s.addRef(handler, func(ref *uintptr, ctx uintptr) int32 {
			var txtPtr *byte
			if len(record) > 0 {
				txtPtr = &record[0]
			}
			return dnssd.register(ref, 0, dnssdIfaceAny, instance, service, dnssdDomain, 0,
				networkPort, uint16(len(record)), txtPtr, dnssd.registerCB, ctx)
		})
		return err
	}
	return s, nil
}

// encodeTXT builds the DNS-SD TXT record: length-prefixed key=value strings.
func encodeTXT(txt map[string]string) ([]byte, error) {
	keys := make([]string, 0, len(txt))
	for k := range txt {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var record []byte
	for _, k := range keys {
		entry := k + "=" + txt[k]
		if len(entry) > dnssdMaxTXTEntry {
			return nil, fmt.Errorf("mDNS TXT entry %q exceeds %d bytes", k, dnssdMaxTXTEntry)
		}
		record = append(record, byte(len(entry)))
		record = append(record, entry...)
	}
	if len(record) > 65535 {
		return nil, fmt.Errorf("mDNS TXT record exceeds 65535 bytes")
	}
	return record, nil
}

func decodeTXT(record []byte) map[string]string {
	txt := make(map[string]string)
	for len(record) > 0 {
		n := int(record[0])
		record = record[1:]
		if n > len(record) {
			break // truncated
		}
		if k, v, _ := strings.Cut(string(record[:n]), "="); k != "" {
			txt[k] = v
		}
		record = record[n:]
	}
	return txt
}

func dnssdBrowse(service string, cb func([]hal.MDNSPeer)) (stop func(), err error) {
	b, err := newDNSSDBrowser(service, cb)
	if err != nil {
		return nil, err
	}
	return b.s.start()
}

// dnssdBrowser tracks instances per interface: the daemon reports each one once
// per network it is visible on. It relies on a long-lived address query per
// instance. A peer that dies without a goodbye keeps its long-lived PTR record
// in the daemon's cache, but its short-lived address record expires, and
// snapshotting only instances with addresses is what drops it.
type dnssdBrowser struct {
	s       *dnssdSession
	service string
	cb      func([]hal.MDNSPeer)

	instances map[string]map[uint32]*dnssdSighting // instance name -> ifindex
	seq       uint64                               // orders updates, newest highest
	dirty     bool
}

// dnssdSighting is one instance as seen on one interface.
type dnssdSighting struct {
	resolve    *dnssdRef
	addr       *dnssdRef
	host       string
	port       int
	txt        map[string]string
	addrs      map[string]uint64 // address -> seq when added
	resolvedAt uint64
}

func newDNSSDBrowser(service string, cb func([]hal.MDNSPeer)) (*dnssdBrowser, error) {
	s, err := newDNSSDSession()
	if err != nil {
		return nil, err
	}
	b := &dnssdBrowser{
		s:         s,
		service:   service,
		cb:        cb,
		instances: make(map[string]map[uint32]*dnssdSighting),
	}
	s.open = func() error {
		_, err := s.addRef(dnssdBrowseFunc(b.onBrowse), func(ref *uintptr, ctx uintptr) int32 {
			return dnssd.browse(ref, 0, dnssdIfaceAny, service, dnssdDomain, dnssd.browseCB, ctx)
		})
		return err
	}
	s.reset = func() {
		if len(b.instances) > 0 {
			b.instances = make(map[string]map[uint32]*dnssdSighting)
			b.dirty = true
		}
	}
	s.deliver = func() {
		if b.dirty {
			b.dirty = false
			b.cb(b.snapshot())
		}
	}
	return b, nil
}

func (b *dnssdBrowser) onBrowse(flags, ifIndex uint32, errCode int32, name, regtype, domain string) {
	if errCode != dnssdNoError {
		dnssdLogCallbackError("browse", errCode)
		return
	}
	if flags&dnssdFlagAdd == 0 {
		b.forget(name, ifIndex)
		return
	}
	if !dnssdUsableInterface(ifIndex) {
		return
	}
	if _, ok := b.instances[name][ifIndex]; ok {
		return
	}

	sighting := &dnssdSighting{addrs: make(map[string]uint64)}
	var handler dnssdResolveFunc = func(errCode int32, host string, port uint16, txt []byte) {
		b.onResolve(sighting, ifIndex, errCode, host, port, txt)
	}
	r, err := b.s.addRef(handler, func(ref *uintptr, ctx uintptr) int32 {
		return dnssd.resolve(ref, 0, ifIndex, name, regtype, domain, dnssd.resolveCB, ctx)
	})
	if err != nil {
		slog.Debug("mDNS resolve failed", "name", name, "error", err)
		return
	}
	sighting.resolve = r
	if b.instances[name] == nil {
		b.instances[name] = make(map[uint32]*dnssdSighting)
	}
	b.instances[name][ifIndex] = sighting
}

// dnssdUsableInterface excludes loopback: our own and same-host services are
// also reported there, with an address no remote consumer can use.
func dnssdUsableInterface(ifIndex uint32) bool {
	ifi, err := net.InterfaceByIndex(int(ifIndex))
	return err == nil && ifi.Flags&net.FlagLoopback == 0
}

func (b *dnssdBrowser) forget(name string, ifIndex uint32) {
	sightings := b.instances[name]
	sighting, ok := sightings[ifIndex]
	if !ok {
		return
	}
	b.s.closeRef(sighting.addr)
	b.s.closeRef(sighting.resolve)
	delete(sightings, ifIndex)
	if len(sightings) == 0 {
		delete(b.instances, name)
	}
	b.dirty = true
}

func (b *dnssdBrowser) onResolve(sighting *dnssdSighting, ifIndex uint32, errCode int32, host string, port uint16, record []byte) {
	if errCode != dnssdNoError {
		dnssdLogCallbackError("resolve", errCode)
		return
	}
	txt := decodeTXT(record)
	if sighting.port != int(port) || !stringMapsEqual(sighting.txt, txt) || sighting.host != host {
		b.dirty = true
	}
	b.seq++
	sighting.resolvedAt = b.seq
	sighting.port = int(port)
	sighting.txt = txt
	if sighting.host == host {
		return
	}

	b.s.closeRef(sighting.addr)
	sighting.addr = nil
	sighting.host = host
	sighting.addrs = make(map[string]uint64)

	var handler dnssdAddrFunc = func(flags uint32, errCode int32, sockaddr *[8]byte) {
		b.onAddr(sighting, flags, errCode, sockaddr)
	}
	r, err := b.s.addRef(handler, func(ref *uintptr, ctx uintptr) int32 {
		return dnssd.addrInfo(ref, 0, ifIndex, dnssdProtoIPv4, host, dnssd.addrInfoCB, ctx)
	})
	if err != nil {
		slog.Debug("mDNS address lookup failed", "host", host, "error", err)
		return
	}
	sighting.addr = r
}

func (b *dnssdBrowser) onAddr(sighting *dnssdSighting, flags uint32, errCode int32, sockaddr *[8]byte) {
	if errCode != dnssdNoError {
		dnssdLogCallbackError("addrinfo", errCode)
		return
	}
	ip := sockaddrIPv4(sockaddr)
	if ip == nil || ip.IsLoopback() {
		return
	}
	addr := ip.String()
	if flags&dnssdFlagAdd == 0 {
		if _, ok := sighting.addrs[addr]; ok {
			delete(sighting.addrs, addr)
			b.dirty = true
		}
		return
	}
	b.seq++
	sighting.addrs[addr] = b.seq
	b.dirty = true
}

// sockaddrIPv4 reads a BSD sockaddr_in: len, family, port, then the address.
func sockaddrIPv4(sa *[8]byte) net.IP {
	if sa == nil || sa[1] != unix.AF_INET {
		return nil
	}
	return net.IPv4(sa[4], sa[5], sa[6], sa[7])
}

func (b *dnssdBrowser) snapshot() []hal.MDNSPeer {
	peers := make([]hal.MDNSPeer, 0, len(b.instances))
	for name, sightings := range b.instances {
		var latest *dnssdSighting
		addrs := make(map[string]uint64)
		for _, sighting := range sightings {
			if latest == nil || sighting.resolvedAt > latest.resolvedAt {
				latest = sighting
			}
			for addr, seq := range sighting.addrs {
				addrs[addr] = max(addrs[addr], seq)
			}
		}
		if latest == nil || latest.host == "" || len(addrs) == 0 {
			continue // not fully resolved yet, or its address records expired
		}
		txt := make(map[string]string, len(latest.txt))
		for k, v := range latest.txt {
			txt[k] = v
		}
		peers = append(peers, hal.MDNSPeer{
			Instance: name,
			Hostname: strings.TrimSuffix(latest.host, "."),
			Addrs:    freshestFirst(addrs),
			Port:     latest.port,
			Txt:      txt,
		})
	}
	sort.Slice(peers, func(i, j int) bool { return peers[i].Instance < peers[j].Instance })
	return peers
}

func freshestFirst(addrs map[string]uint64) []string {
	out := make([]string, 0, len(addrs))
	for addr := range addrs {
		out = append(out, addr)
	}
	sort.Slice(out, func(i, j int) bool {
		if addrs[out[i]] != addrs[out[j]] {
			return addrs[out[i]] > addrs[out[j]]
		}
		return out[i] < out[j]
	})
	return out
}

func stringMapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if other, ok := b[k]; !ok || other != v {
			return false
		}
	}
	return true
}
