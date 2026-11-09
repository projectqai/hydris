package platform

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/projectqai/hydris/hal"
)

// Avahi D-Bus client, used for mDNS when the daemon is running so we
// cooperate with the host's zeroconf stack; hal/mdns is the fallback.

const (
	avahiService    = "org.freedesktop.Avahi"
	avahiServerIntf = "org.freedesktop.Avahi.Server"
	avahiGroupIntf  = "org.freedesktop.Avahi.EntryGroup"
	avahiBrowseIntf = "org.freedesktop.Avahi.ServiceBrowser"

	avahiIfUnspec    = int32(-1)
	avahiProtoInet   = int32(0) // IPv4 only, matching the hand-made fallback
	avahiProtoUnspec = int32(-1)
)

// avahiBus returns the shared system bus if Avahi is reachable on it.
// The shared bus must never be closed.
func avahiBus() (*dbus.Conn, error) {
	conn, err := dbus.SystemBus()
	if err != nil {
		return nil, err
	}
	var hasOwner bool
	if err := conn.BusObject().Call("org.freedesktop.DBus.NameHasOwner", 0, avahiService).Store(&hasOwner); err != nil {
		return nil, err
	}
	if !hasOwner {
		return nil, fmt.Errorf("avahi not running")
	}
	return conn, nil
}

func avahiAdvertise(conn *dbus.Conn, instance, service string, port int, txt map[string]string) (stop func(), err error) {
	server := conn.Object(avahiService, "/")

	var groupPath dbus.ObjectPath
	if err := server.Call(avahiServerIntf+".EntryGroupNew", 0).Store(&groupPath); err != nil {
		return nil, fmt.Errorf("avahi EntryGroupNew: %w", err)
	}
	group := conn.Object(avahiService, groupPath)

	keys := make([]string, 0, len(txt))
	for k := range txt {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var txtRecords [][]byte
	for _, k := range keys {
		txtRecords = append(txtRecords, []byte(k+"="+txt[k]))
	}

	if err := group.Call(avahiGroupIntf+".AddService", 0,
		avahiIfUnspec, avahiProtoUnspec, uint32(0),
		instance, service, "", "", uint16(port), txtRecords).Err; err != nil {
		_ = group.Call(avahiGroupIntf+".Free", 0).Err
		return nil, fmt.Errorf("avahi AddService: %w", err)
	}
	if err := group.Call(avahiGroupIntf+".Commit", 0).Err; err != nil {
		_ = group.Call(avahiGroupIntf+".Free", 0).Err
		return nil, fmt.Errorf("avahi Commit: %w", err)
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			_ = group.Call(avahiGroupIntf+".Free", 0).Err
		})
	}, nil
}

func avahiBrowse(conn *dbus.Conn, service string, cb func([]hal.MDNSPeer)) (stop func(), err error) {
	server := conn.Object(avahiService, "/")

	// Subscribe before creating the browser: Avahi emits the initial burst immediately.
	sigCh := make(chan *dbus.Signal, 256)
	conn.Signal(sigCh)
	if err := conn.AddMatchSignal(dbus.WithMatchInterface(avahiBrowseIntf)); err != nil {
		conn.RemoveSignal(sigCh)
		return nil, fmt.Errorf("avahi AddMatchSignal: %w", err)
	}

	var browserPath dbus.ObjectPath
	if err := server.Call(avahiServerIntf+".ServiceBrowserNew", 0,
		avahiIfUnspec, avahiProtoInet, service, "local", uint32(0)).Store(&browserPath); err != nil {
		_ = conn.RemoveMatchSignal(dbus.WithMatchInterface(avahiBrowseIntf))
		conn.RemoveSignal(sigCh)
		return nil, fmt.Errorf("avahi ServiceBrowserNew: %w", err)
	}

	b := newAvahiBrowser(conn, server, browserPath, service, cb)
	go b.loop(sigCh)

	var once sync.Once
	return func() {
		once.Do(func() {
			close(b.stopCh)
			_ = conn.Object(avahiService, browserPath).Call(avahiBrowseIntf+".Free", 0).Err
			_ = conn.RemoveMatchSignal(dbus.WithMatchInterface(avahiBrowseIntf))
			conn.RemoveSignal(sigCh)
		})
	}, nil
}

type avahiBrowser struct {
	conn    *dbus.Conn
	server  dbus.BusObject
	path    dbus.ObjectPath
	service string
	cb      func([]hal.MDNSPeer)
	stopCh  chan struct{}
	kick    chan struct{} // a resolve changed the table; the loop delivers it

	mu     sync.Mutex
	dirty  bool                                // table changed since the last delivery
	peers  map[string]*hal.MDNSPeer            // instance name -> resolved peer
	tokens map[string]map[string]*announcement // instance name -> (iface,proto) -> live announcement
}

// announcement is an ItemNew that Avahi hasn't removed yet. addr stays empty
// until a resolve succeeds; the periodic re-resolve retries a failed one.
type announcement struct {
	addr string
}

func newAvahiBrowser(conn *dbus.Conn, server dbus.BusObject, path dbus.ObjectPath, service string, cb func([]hal.MDNSPeer)) *avahiBrowser {
	return &avahiBrowser{
		conn:    conn,
		server:  server,
		path:    path,
		service: service,
		cb:      cb,
		peers:   make(map[string]*hal.MDNSPeer),
		tokens:  make(map[string]map[string]*announcement),
		stopCh:  make(chan struct{}),
		kick:    make(chan struct{}, 1),
	}
}

func (b *avahiBrowser) loop(sigCh chan *dbus.Signal) {
	// Avahi only signals on appear/disappear, so re-resolve periodically to
	// catch an address change under the same instance name and to retry
	// announcements whose resolve failed.
	reresolve := time.NewTicker(reresolveInterval)
	defer reresolve.Stop()
	for {
		select {
		case <-b.stopCh:
			return
		case <-reresolve.C:
			b.reresolveAll()
		case <-b.kick:
		case sig, ok := <-sigCh:
			if !ok {
				return
			}
			if sig == nil || sig.Path != b.path {
				continue
			}
			switch sig.Name {
			case avahiBrowseIntf + ".ItemNew":
				b.itemNew(sig.Body)
			case avahiBrowseIntf + ".ItemRemove":
				b.itemRemove(sig.Body)
			}
		}
		b.deliver()
	}
}

// deliver hands the consumer the current table if it changed. Only the loop
// calls it: snapshots taken on the resolve goroutines could reach the consumer
// out of order, and builtin/mdns forgets every peer missing from the latest one.
func (b *avahiBrowser) deliver() {
	b.mu.Lock()
	if !b.dirty {
		b.mu.Unlock()
		return
	}
	b.dirty = false
	snapshot := b.snapshotLocked()
	b.mu.Unlock()
	b.cb(snapshot)
}

const reresolveInterval = 60 * time.Second

func (b *avahiBrowser) reresolveAll() {
	b.mu.Lock()
	type target struct {
		iface, proto int32
		name         string
		a            *announcement
	}
	var targets []target
	for name, toks := range b.tokens {
		for tok, a := range toks {
			var iface, proto int32
			if _, err := fmt.Sscanf(tok, "%d/%d", &iface, &proto); err == nil {
				targets = append(targets, target{iface, proto, name, a})
			}
		}
	}
	b.mu.Unlock()
	for _, t := range targets {
		b.resolve(t.iface, t.proto, t.name, t.a)
	}
}

// signalArgs unpacks the (iface, proto, name, type, domain) prefix of a signal.
func signalArgs(body []interface{}) (iface, proto int32, name, stype, domain string, ok bool) {
	if len(body) < 5 {
		return
	}
	iface, ok1 := body[0].(int32)
	proto, ok2 := body[1].(int32)
	name, ok3 := body[2].(string)
	stype, ok4 := body[3].(string)
	domain, ok5 := body[4].(string)
	return iface, proto, name, stype, domain, ok1 && ok2 && ok3 && ok4 && ok5
}

func (b *avahiBrowser) itemNew(body []interface{}) {
	iface, proto, name, _, _, ok := signalArgs(body)
	if !ok {
		return
	}
	token := fmt.Sprintf("%d/%d", iface, proto)
	b.mu.Lock()
	if b.tokens[name] == nil {
		b.tokens[name] = make(map[string]*announcement)
	}
	a := b.tokens[name][token]
	if a == nil {
		a = &announcement{}
		b.tokens[name][token] = a
	}
	b.mu.Unlock()
	b.resolve(iface, proto, name, a)
}

// resolve runs ResolveService off the signal loop and folds the result into the
// peer table as announcement a's address. The loop delivers the change.
func (b *avahiBrowser) resolve(iface, proto int32, name string, a *announcement) {
	go func() {
		var (
			rIface, rProto, rAproto int32
			rName, rType, rDomain   string
			host, address           string
			port                    uint16
			txtRecords              [][]byte
			flags                   uint32
		)
		err := b.server.Call(avahiServerIntf+".ResolveService", 0,
			iface, proto, name, b.service, "local", avahiProtoInet, uint32(0)).Store(
			&rIface, &rProto, &rName, &rType, &rDomain, &host, &rAproto, &address, &port, &txtRecords, &flags)
		if err != nil {
			slog.Debug("avahi resolve failed", "name", name, "error", err)
			return
		}

		txt := make(map[string]string, len(txtRecords))
		for _, rec := range txtRecords {
			k, v, _ := strings.Cut(string(rec), "=")
			if k != "" {
				txt[k] = v
			}
		}

		token := fmt.Sprintf("%d/%d", iface, proto)
		b.mu.Lock()
		if b.tokens[name][token] != a {
			// Avahi removed the announcement while it was being resolved, and
			// won't remove it again: applying the answer would revive the peer
			// for good.
			b.mu.Unlock()
			return
		}
		a.addr = address
		peer := b.peers[name]
		if peer == nil {
			peer = &hal.MDNSPeer{Instance: name}
			b.peers[name] = peer
		}
		peer.Hostname = strings.TrimSuffix(host, ".")
		peer.Port = int(port)
		peer.Txt = txt
		peer.Addrs = addrsFromTokens(b.tokens[name])
		b.dirty = true
		b.mu.Unlock()
		select {
		case b.kick <- struct{}{}:
		default: // a wake-up is already pending and will deliver this too
		}
	}()
}

func (b *avahiBrowser) itemRemove(body []interface{}) {
	iface, proto, name, _, _, ok := signalArgs(body)
	if !ok {
		return
	}
	token := fmt.Sprintf("%d/%d", iface, proto)
	b.mu.Lock()
	defer b.mu.Unlock()
	toks := b.tokens[name]
	if _, ok := toks[token]; !ok {
		return
	}
	delete(toks, token)
	if len(toks) == 0 {
		delete(b.tokens, name)
	}
	peer := b.peers[name]
	if peer == nil {
		return // never resolved, so never listed
	}
	// Announcements that haven't resolved have no address and can't keep
	// the peer listed.
	if addrs := addrsFromTokens(toks); len(addrs) > 0 {
		peer.Addrs = addrs
	} else {
		delete(b.peers, name)
	}
	b.dirty = true
}

// addrsFromTokens rebuilds the deduplicated address list from the live
// announcements, so a dropped address disappears instead of lingering.
func addrsFromTokens(tokens map[string]*announcement) []string {
	var addrs []string
	for _, a := range tokens {
		if a.addr != "" && !contains(addrs, a.addr) {
			addrs = append(addrs, a.addr)
		}
	}
	sort.Strings(addrs)
	return addrs
}

func (b *avahiBrowser) snapshotLocked() []hal.MDNSPeer {
	peers := make([]hal.MDNSPeer, 0, len(b.peers))
	for _, p := range b.peers {
		peers = append(peers, *p)
	}
	sort.Slice(peers, func(i, j int) bool { return peers[i].Instance < peers[j].Instance })
	return peers
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
