package platform

import (
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/projectqai/hydris/hal"
)

// fakeAvahi answers ResolveService like avahi-daemon, but each name's answers
// wait at a gate the test opens, so the test decides when concurrent resolves
// finish.
type fakeAvahi struct {
	dbus.BusObject // only Call is implemented

	mu       sync.Mutex
	gates    map[string]chan struct{}
	failing  map[string]bool // answer with Avahi's timeout error instead
	waiting  map[string]int  // resolves held at the gate
	answered map[string]int
}

func (f *fakeAvahi) gateLocked(name string) chan struct{} {
	if f.gates == nil {
		f.gates = make(map[string]chan struct{})
	}
	ch, ok := f.gates[name]
	if !ok {
		ch = make(chan struct{})
		f.gates[name] = ch
	}
	return ch
}

// release lets the waiting and future resolves of name answer.
func (f *fakeAvahi) release(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ch := f.gateLocked(name)
	select {
	case <-ch:
	default:
		close(ch)
	}
}

// block holds the future resolves of name until the next release.
func (f *fakeAvahi) block(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	select {
	case <-f.gateLocked(name):
		f.gates[name] = make(chan struct{})
	default: // already held
	}
}

func (f *fakeAvahi) releaseAll() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, ch := range f.gates {
		select {
		case <-ch:
		default:
			close(ch)
		}
	}
}

func (f *fakeAvahi) setFailing(name string, fail bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failing == nil {
		f.failing = make(map[string]bool)
	}
	f.failing[name] = fail
}

func (f *fakeAvahi) waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		f.mu.Lock()
		ok := cond()
		f.mu.Unlock()
		if ok {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

func (f *fakeAvahi) waitWaiting(t *testing.T, name string) {
	t.Helper()
	f.waitFor(t, "a resolve of "+name+" to wait", func() bool { return f.waiting[name] > 0 })
}

func (f *fakeAvahi) waitAnswered(t *testing.T, name string, n int) {
	t.Helper()
	f.waitFor(t, fmt.Sprintf("%d answers for %s", n, name), func() bool { return f.answered[name] >= n })
}

func (f *fakeAvahi) Call(method string, _ dbus.Flags, args ...interface{}) *dbus.Call {
	if method != avahiServerIntf+".ResolveService" || len(args) < 4 {
		return &dbus.Call{Err: fmt.Errorf("unexpected call %s%v", method, args)}
	}
	iface, _ := args[0].(int32)
	proto, _ := args[1].(int32)
	name, _ := args[2].(string)
	stype, _ := args[3].(string)

	f.mu.Lock()
	gate := f.gateLocked(name)
	if f.waiting == nil {
		f.waiting = make(map[string]int)
		f.answered = make(map[string]int)
	}
	f.waiting[name]++
	f.mu.Unlock()
	<-gate
	f.mu.Lock()
	f.waiting[name]--
	f.answered[name]++
	fail := f.failing[name]
	f.mu.Unlock()

	if fail {
		return &dbus.Call{Err: errors.New("org.freedesktop.Avahi.TimeoutError: Timeout reached")}
	}
	return &dbus.Call{Body: []interface{}{
		iface, proto, name, stype, "local",
		name + ".local", avahiProtoInet, "192.168.1.10", uint16(50051),
		[][]byte{[]byte("fp=" + name)}, uint32(0),
	}}
}

func avahiItem(path dbus.ObjectPath, member, name string) *dbus.Signal {
	return avahiItemOn(path, member, name, 2)
}

func avahiItemOn(path dbus.ObjectPath, member, name string, iface int32) *dbus.Signal {
	return &dbus.Signal{
		Path: path,
		Name: avahiBrowseIntf + "." + member,
		Body: []interface{}{iface, avahiProtoInet, name, "_hydris._tcp", "local", uint32(0)},
	}
}

// recorder plays the consumer. It stalls the first snapshot that hold
// matches, as builtin/mdns does while it pushes entities, and records
// snapshots in the order the consumer finishes with them.
type recorder struct {
	hold func(names []string) bool

	mu        sync.Mutex
	got       [][]string
	holding   bool
	held      chan struct{} // closed once the held snapshot is stalled
	overtaken chan struct{} // closed if another snapshot arrives meanwhile
}

func newRecorder(hold func(names []string) bool) *recorder {
	return &recorder{hold: hold, held: make(chan struct{}), overtaken: make(chan struct{})}
}

func (r *recorder) cb(peers []hal.MDNSPeer) {
	names := make([]string, 0, len(peers))
	for _, p := range peers {
		names = append(names, p.Instance)
	}
	r.mu.Lock()
	switch {
	case r.hold != nil && r.hold(names):
		r.hold = nil
		r.holding = true
		close(r.held)
		r.mu.Unlock()
		// A browser that delivers in order can't hand over anything newer
		// until this returns, so stop waiting after a while.
		select {
		case <-r.overtaken:
		case <-time.After(200 * time.Millisecond):
		}
		r.mu.Lock()
		r.holding = false
	case r.holding:
		r.holding = false
		close(r.overtaken)
	}
	r.got = append(r.got, names)
	r.mu.Unlock()
}

// settle waits until the latest snapshot lists exactly want and returns all
// snapshots in the order the consumer finished with them.
func (r *recorder) settle(t *testing.T, want ...string) [][]string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		r.mu.Lock()
		got := slices.Clone(r.got)
		r.mu.Unlock()
		if n := len(got); n > 0 && slices.Equal(got[n-1], want) {
			return got
		}
		if time.Now().After(deadline) {
			t.Fatalf("latest snapshot never became %v; snapshots in order: %v", want, got)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// still gives a stray delivery time to arrive, then checks the latest
// snapshot is still want.
func (r *recorder) still(t *testing.T, want ...string) {
	t.Helper()
	time.Sleep(300 * time.Millisecond)
	r.mu.Lock()
	got := slices.Clone(r.got)
	r.mu.Unlock()
	if n := len(got); n == 0 || !slices.Equal(got[n-1], want) {
		t.Fatalf("latest snapshot should still be %v; snapshots in order: %v", want, got)
	}
}

func equalTo(want ...string) func([]string) bool {
	return func(names []string) bool { return slices.Equal(names, want) }
}

func startAvahiBrowser(t *testing.T, srv *fakeAvahi, rec *recorder) (*avahiBrowser, chan<- *dbus.Signal) {
	t.Helper()
	b := newAvahiBrowser(nil, srv, "/Client1/ServiceBrowser1", "_hydris._tcp", rec.cb)
	sig := make(chan *dbus.Signal, 16)
	go b.loop(sig)
	t.Cleanup(func() {
		close(b.stopCh)
		srv.releaseAll()
	})
	return b, sig
}

// Resolves finish on their own goroutines in any order. builtin/mdns forgets
// every peer missing from the latest snapshot, so an older snapshot must never
// reach it after a newer one.
func TestAvahiBrowseSnapshotOrder(t *testing.T) {
	t.Run("peer found during a slow delivery is kept", func(t *testing.T) {
		srv := &fakeAvahi{}
		rec := newRecorder(equalTo("node-a"))
		b, sig := startAvahiBrowser(t, srv, rec)

		sig <- avahiItem(b.path, "ItemNew", "node-a")
		sig <- avahiItem(b.path, "ItemNew", "node-b")
		srv.release("node-a")
		<-rec.held // the consumer is busy with [node-a]
		srv.release("node-b")

		got := rec.settle(t, "node-a", "node-b")
		seen := false
		for _, names := range got {
			has := slices.Contains(names, "node-b")
			if seen && !has {
				t.Fatalf("node-b dropped after it was delivered; snapshots in order: %v", got)
			}
			seen = seen || has
		}
	})

	t.Run("peer removed during a slow delivery stays removed", func(t *testing.T) {
		srv := &fakeAvahi{}
		rec := newRecorder(equalTo("node-a", "node-b"))
		b, sig := startAvahiBrowser(t, srv, rec)

		srv.release("node-b")
		sig <- avahiItem(b.path, "ItemNew", "node-b")
		rec.settle(t, "node-b")
		srv.release("node-a")
		sig <- avahiItem(b.path, "ItemNew", "node-a")
		<-rec.held // the consumer is busy with [node-a node-b]
		sig <- avahiItem(b.path, "ItemRemove", "node-b")

		rec.settle(t, "node-a")
	})
}

// Avahi can remove an announcement while it's being resolved, and won't remove
// it again, so the late answer must not bring the peer back.
func TestAvahiBrowseRemovedWhileResolving(t *testing.T) {
	t.Run("first resolve", func(t *testing.T) {
		srv := &fakeAvahi{}
		rec := newRecorder(nil)
		b, sig := startAvahiBrowser(t, srv, rec)

		sig <- avahiItem(b.path, "ItemNew", "node-a")
		srv.waitWaiting(t, "node-a")
		sig <- avahiItem(b.path, "ItemRemove", "node-a")
		// Signals are handled in order, so node-z showing up means the
		// removal has been handled.
		srv.release("node-z")
		sig <- avahiItem(b.path, "ItemNew", "node-z")
		rec.settle(t, "node-z")
		srv.release("node-a")

		rec.still(t, "node-z")
	})

	t.Run("re-resolve", func(t *testing.T) {
		srv := &fakeAvahi{}
		rec := newRecorder(nil)
		b, sig := startAvahiBrowser(t, srv, rec)

		srv.release("node-a")
		sig <- avahiItem(b.path, "ItemNew", "node-a")
		rec.settle(t, "node-a")
		srv.block("node-a")
		b.reresolveAll() // what the periodic ticker does
		srv.waitWaiting(t, "node-a")
		sig <- avahiItem(b.path, "ItemRemove", "node-a")
		rec.settle(t)
		srv.release("node-a")

		rec.still(t)
	})
}

// A resolve can fail, e.g. when the peer's answers are lost. Avahi won't
// announce the peer again while it's still there, so the periodic re-resolve
// has to retry it.
func TestAvahiBrowseRetriesFailedResolve(t *testing.T) {
	srv := &fakeAvahi{}
	rec := newRecorder(nil)
	b, sig := startAvahiBrowser(t, srv, rec)

	srv.setFailing("node-a", true)
	srv.release("node-a")
	sig <- avahiItem(b.path, "ItemNew", "node-a")
	srv.waitAnswered(t, "node-a", 1)
	srv.setFailing("node-a", false)
	b.reresolveAll() // what the periodic ticker does

	rec.settle(t, "node-a")
}

// An announcement that never resolved has no address, so it must not keep a
// peer listed once its resolved announcements are gone.
func TestAvahiBrowseUnresolvedAnnouncementListsNothing(t *testing.T) {
	srv := &fakeAvahi{}
	rec := newRecorder(nil)
	b, sig := startAvahiBrowser(t, srv, rec)

	srv.release("node-a")
	sig <- avahiItemOn(b.path, "ItemNew", "node-a", 2)
	rec.settle(t, "node-a")
	srv.setFailing("node-a", true)
	sig <- avahiItemOn(b.path, "ItemNew", "node-a", 3)
	srv.waitAnswered(t, "node-a", 2)
	sig <- avahiItemOn(b.path, "ItemRemove", "node-a", 2)

	rec.settle(t)
}
