package engine

import (
	"context"
	"testing"
	"time"

	"github.com/projectqai/hydris/engine/transform"
	"github.com/projectqai/hydris/pkg/tracing"
	pb "github.com/projectqai/proto/go"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func recordSpans(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr), sdktrace.WithIDGenerator(tracing.IDGenerator()))
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() {
		otel.SetTracerProvider(prev)
		_ = tp.Shutdown(context.Background())
	})
	return sr
}

func spansNamed(sr *tracetest.SpanRecorder, name string) []sdktrace.ReadOnlySpan {
	var out []sdktrace.ReadOnlySpan
	for _, s := range sr.Ended() {
		if s.Name() == name {
			out = append(out, s)
		}
	}
	return out
}

func spanNamed(sr *tracetest.SpanRecorder, name string) sdktrace.ReadOnlySpan {
	if all := spansNamed(sr, name); len(all) > 0 {
		return all[0]
	}
	return nil
}

// spanInTrace returns the span with the given name in the given trace.
func spanInTrace(sr *tracetest.SpanRecorder, name string, tid trace.TraceID) sdktrace.ReadOnlySpan {
	for _, s := range spansNamed(sr, name) {
		if s.SpanContext().TraceID() == tid {
			return s
		}
	}
	return nil
}

// linkOf returns the target of the span's link with the given meaning.
func linkOf(s sdktrace.ReadOnlySpan, meaning string) trace.SpanContext {
	for _, l := range s.Links() {
		for _, a := range l.Attributes {
			if a.Key == tracing.AttrLink && a.Value.AsString() == meaning {
				return l.SpanContext
			}
		}
	}
	return trace.SpanContext{}
}

func attr(s sdktrace.ReadOnlySpan, key string) (string, bool) {
	for _, a := range s.Attributes() {
		if string(a.Key) == key {
			return a.Value.String(), true
		}
	}
	return "", false
}

func headFresh(t *testing.T, w *WorldServer, id string) *timestamppb.Timestamp {
	t.Helper()
	e := w.GetHead(id)
	if e == nil || !e.GetLifetime().GetFresh().IsValid() {
		t.Fatalf("entity %s has no stored fresh", id)
	}
	return e.Lifetime.Fresh
}

// A change the engine stamps itself (no fresh on the wire) is a trace of its
// own: named after the entity, rooted at exactly the ids derived from the
// version it produced, with the RPC it arrived on linked as carrier and the
// processing steps under it.
func TestPush_ChangeIsDerivedTrace(t *testing.T) {
	sr := recordSpans(t)
	w := testWorld(nil)
	w.transformers = []transform.Transformer{transform.NewPoseTransformer()}

	ctx, rpc := tracing.Tracer().Start(context.Background(), "world.WorldService/Push", trace.WithSpanKind(trace.SpanKindServer))
	_, err := w.Push(ctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "det-1", Detection: &pb.DetectionComponent{}}},
	}))
	rpc.End()
	if err != nil {
		t.Fatal(err)
	}
	version := tracing.Derive("det-1", headFresh(t, w, "det-1"))

	change := spanNamed(sr, "det-1")
	if change == nil {
		t.Fatal("no change span named after the entity")
	}
	if change.SpanContext().TraceID() != version.TraceID() || change.SpanContext().SpanID() != version.SpanID() {
		t.Errorf("change ids = %s/%s, want the derived %s/%s", change.SpanContext().TraceID(), change.SpanContext().SpanID(), version.TraceID(), version.SpanID())
	}
	if change.Parent().IsValid() {
		t.Error("an engine-stamped change must be the root of its trace")
	}
	if got := linkOf(change, "carrier"); got.SpanID() != rpc.SpanContext().SpanID() {
		t.Errorf("carrier link = %v, want the RPC span", got)
	}
	if k, _ := attr(change, "hydris.entity.kind"); k != "detection" {
		t.Errorf("kind = %q, want detection", k)
	}
	for _, name := range []string{"transform", "notify"} {
		sp := spanInTrace(sr, name, version.TraceID())
		if sp == nil || sp.Parent().SpanID() != change.SpanContext().SpanID() {
			t.Errorf("%s must be a child of the change span", name)
		}
	}
	if spanNamed(sr, "transform.pose") != nil {
		t.Error("a transformer that changed nothing must not get a span of its own")
	}
	if _, ok := attr(spanNamed(sr, "transform"), "hydris.transform.pose_us"); !ok {
		t.Error("the transform step must record each transformer's time")
	}
}

// A sender that names its version (fresh on the wire) owns the root of the
// change's trace: the engine's span is a child of the derived root, in the
// derived trace, whether or not the sender ever exports that root.
func TestPush_SenderOwnsVersion(t *testing.T) {
	sr := recordSpans(t)
	w := testWorld(nil)
	fresh := &timestamppb.Timestamp{Seconds: 1767225600, Nanos: 500000000}
	version := tracing.Derive("node-1", fresh)

	if _, err := w.Push(context.Background(), peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "node-1", Detection: &pb.DetectionComponent{}, Lifetime: &pb.Lifetime{Fresh: fresh}}},
	})); err != nil {
		t.Fatal(err)
	}
	change := spanNamed(sr, "node-1")
	if change == nil {
		t.Fatal("no change span")
	}
	if change.SpanContext().TraceID() != version.TraceID() {
		t.Errorf("trace = %s, want the derived %s", change.SpanContext().TraceID(), version.TraceID())
	}
	if change.Parent().SpanID() != version.SpanID() || !change.Parent().IsRemote() {
		t.Errorf("parent = %v, want the sender's derived root %s", change.Parent(), version.SpanID())
	}
	if change.SpanContext().SpanID() == version.SpanID() {
		t.Error("the engine must not claim the sender's root span id")
	}
	if linkOf(change, "carrier").IsValid() {
		t.Error("no RPC span, no carrier link")
	}
	if ext, _ := attr(change, "hydris.entity.external"); ext != "true" {
		t.Error("the change must be marked as externally versioned")
	}
}

// A write that does not move the entity's fresh (a keepalive extending until,
// a stale write) is by definition not a change and gets no trace.
func TestPush_UnchangedVersionHasNoTrace(t *testing.T) {
	sr := recordSpans(t)
	w := testWorld(nil)
	t1 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	push := func(fresh, until time.Time) {
		if _, err := w.Push(context.Background(), peerRequest(&pb.EntityChangeRequest{
			Changes: []*pb.Entity{{Id: "e1", Label: ptr("x"), Lifetime: &pb.Lifetime{Fresh: timestamppb.New(fresh), Until: timestamppb.New(until)}}},
		})); err != nil {
			t.Fatal(err)
		}
	}
	push(t1, t1.Add(time.Minute))
	push(t1, t1.Add(2*time.Minute))
	push(t1.Add(-time.Second), t1.Add(3*time.Minute))
	if n := len(spansNamed(sr, "e1")); n != 1 {
		t.Errorf("got %d change spans, want 1: only the first write produced a new version", n)
	}
	push(t1.Add(time.Second), t1.Add(3*time.Minute))
	if n := len(spansNamed(sr, "e1")); n != 2 {
		t.Errorf("got %d change spans, want 2 after a newer version", n)
	}
}

// Each version is its own trace, named after the entity so a collector
// groups them by name. A version links the one it replaced, derived, never
// looked up.
func TestPush_EachVersionIsATrace(t *testing.T) {
	sr := recordSpans(t)
	w := testWorld(nil)
	t1 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := t1.Add(time.Second)
	v1 := tracing.Derive("e1", timestamppb.New(t1))
	v2 := tracing.Derive("e1", timestamppb.New(t2))
	if v1.TraceID() == v2.TraceID() {
		t.Fatal("two versions must be two traces")
	}

	for _, fresh := range []time.Time{t1, t2} {
		if _, err := w.Push(context.Background(), peerRequest(&pb.EntityChangeRequest{
			Changes: []*pb.Entity{{Id: "e1", Label: ptr("v"), Lifetime: &pb.Lifetime{Fresh: timestamppb.New(fresh)}}},
		})); err != nil {
			t.Fatal(err)
		}
	}
	first := spanInTrace(sr, "e1", v1.TraceID())
	second := spanInTrace(sr, "e1", v2.TraceID())
	if first == nil || second == nil {
		t.Fatal("each version must be a trace of its own, named after the entity")
	}
	// Both versions were named by the sender, so both engine spans hang off
	// the sender's derived roots.
	if first.Parent().SpanID() != v1.SpanID() || second.Parent().SpanID() != v2.SpanID() {
		t.Errorf("parents = %s, %s, want the derived roots %s, %s", first.Parent().SpanID(), second.Parent().SpanID(), v1.SpanID(), v2.SpanID())
	}
	if linkOf(first, "replaces").IsValid() {
		t.Error("the first version replaces nothing")
	}
	if got := linkOf(second, "replaces"); !got.Equal(v1) {
		t.Errorf("replaces link = %v, want v1 %v", got, v1)
	}

	// A consumer enriching what it received pushes from inside the version's
	// trace (its span is in ctx, as a traceparent header would put it). The
	// enrichment carries no fresh, so the engine stamps a component version
	// of its own: a new root trace derived from that fresh, linking the RPC
	// it arrived on as carrier and v2 as replaced.
	cctx, consumer := tracing.Tracer().Start(trace.ContextWithRemoteSpanContext(context.Background(), v2), "consumer.process")
	rctx, rpc := tracing.Tracer().Start(cctx, "world.WorldService/Push")
	if _, err := w.Push(rctx, peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "e1", Administrative: &pb.AdministrativeComponent{Owner: ptr("someone")}}},
	})); err != nil {
		t.Fatal(err)
	}
	rpc.End()
	consumer.End()
	var third sdktrace.ReadOnlySpan
	for _, sp := range spansNamed(sr, "e1") {
		if tid := sp.SpanContext().TraceID(); tid != v1.TraceID() && tid != v2.TraceID() {
			third = sp
		}
	}
	if third == nil {
		t.Fatal("the enrichment must be a trace of its own")
	}
	w.l.RLock()
	stamped := w.head["e1"].lifetimes[int32(pb.EntityComponent_EntityComponentAdministrative)].Fresh
	w.l.RUnlock()
	v3 := tracing.Derive("e1", timestamppb.New(stamped))
	if third.SpanContext().TraceID() != v3.TraceID() || third.SpanContext().SpanID() != v3.SpanID() || third.Parent().IsValid() {
		t.Errorf("the enrichment is engine-stamped, so its span must be the root derived from the component's fresh: got %s/%s parent=%v, want %s/%s",
			third.SpanContext().TraceID(), third.SpanContext().SpanID(), third.Parent().IsValid(), v3.TraceID(), v3.SpanID())
	}
	if got := linkOf(third, "carrier"); got.SpanID() != rpc.SpanContext().SpanID() || got.TraceID() != v2.TraceID() {
		t.Errorf("carrier link = %v, want the Push RPC in v2's trace", got)
	}
	if got := linkOf(third, "replaces"); !got.Equal(v2) {
		t.Errorf("replaces link = %v, want v2 %v", got, v2)
	}
	if f, _ := attr(third, "hydris.entity.fresh"); f != stamped.UTC().Format(time.RFC3339Nano) {
		t.Errorf("span fresh = %s, want the stamped %s", f, stamped.UTC().Format(time.RFC3339Nano))
	}
}

// Watchers continue the change: the send is a span under the change span,
// in the version's trace. Keepalive re-sends add none.
func TestWatchSend_ContinuesChange(t *testing.T) {
	sr := recordSpans(t)
	w := testWorld(nil)

	c := NewConsumer(w, nil, nil)
	c.actor = "watcher"
	w.bus.Register(c)
	defer w.bus.Unregister(c)

	if _, err := w.Push(context.Background(), peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "det-1", Label: ptr("x")}},
	})); err != nil {
		t.Fatal(err)
	}
	version := tracing.Derive("det-1", headFresh(t, w, "det-1"))

	sctx, cancel := context.WithCancel(context.Background())
	var sent []*pb.EntityChangeEvent
	_ = c.SenderLoop(sctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		cancel()
		return nil
	})
	if len(sent) != 1 || sent[0].Entity.Id != "det-1" {
		t.Fatalf("sent = %v", sent)
	}
	send := spanNamed(sr, "watch.send")
	if send == nil {
		t.Fatal("no watch.send span")
	}
	if send.SpanContext().TraceID() != version.TraceID() || send.Parent().SpanID() != version.SpanID() {
		t.Errorf("watch.send trace=%s parent=%s, want the change %s/%s", send.SpanContext().TraceID(), send.Parent().SpanID(), version.TraceID(), version.SpanID())
	}

	// A keepalive re-send of the same entity must add no span.
	before := len(sr.Ended())
	c.requeueAll()
	sctx, cancel = context.WithCancel(context.Background())
	_ = c.SenderLoop(sctx, func(ev *pb.EntityChangeEvent) error {
		cancel()
		return nil
	})
	if got := len(sr.Ended()); got != before {
		t.Errorf("keepalive re-send recorded %d extra spans", got-before)
	}
}

// Expiry continues the trace of the entity's current version, derived from
// id and fresh, and the expiry notification is sent under that span.
func TestGC_ExpiryContinuesVersion(t *testing.T) {
	sr := recordSpans(t)
	w := testWorld(nil)
	c := NewConsumer(w, nil, nil)
	w.bus.Register(c)
	defer w.bus.Unregister(c)

	if _, err := w.Push(context.Background(), peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "det-1", Label: ptr("x")}},
	})); err != nil {
		t.Fatal(err)
	}
	version := tracing.Derive("det-1", headFresh(t, w, "det-1"))
	w.l.Lock()
	w.head["det-1"].hardExpire = true
	w.l.Unlock()
	w.GC()

	exp := spanNamed(sr, "entity.expire")
	if exp == nil {
		t.Fatal("no entity.expire span")
	}
	if exp.SpanContext().TraceID() != version.TraceID() || exp.Parent().SpanID() != version.SpanID() {
		t.Errorf("entity.expire trace=%s parent=%s, want the version %s/%s", exp.SpanContext().TraceID(), exp.Parent().SpanID(), version.TraceID(), version.SpanID())
	}
	_, entry, _, ok := c.popNext()
	for ok && entry.change != pb.EntityChange_EntityChangeExpired {
		_, entry, _, ok = c.popNext()
	}
	if !ok || !entry.trace.Equal(exp.SpanContext()) {
		t.Errorf("expiry notification trace = %v, want the entity.expire span", entry.trace)
	}
}

// A push whose Lifetime is an empty message behaves like a push without a
// Lifetime: the component is not lifetime-tracked, so it cannot make the
// entity permanent, and it expires with the rest.
func TestPush_EmptyLifetimeIsNotALifetime(t *testing.T) {
	w := testWorld(nil)
	t1 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	until := t1.Add(time.Minute)
	if _, err := w.Push(context.Background(), peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "ac", Label: ptr("plane"), Lifetime: &pb.Lifetime{Fresh: timestamppb.New(t1), Until: timestamppb.New(until)}}},
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Push(context.Background(), peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:             "ac",
			Administrative: &pb.AdministrativeComponent{Owner: ptr("someone")},
			Lifetime:       &pb.Lifetime{},
		}},
	})); err != nil {
		t.Fatal(err)
	}
	w.l.RLock()
	es := w.head["ac"]
	w.l.RUnlock()
	adm := es.lifetimes[int32(pb.EntityComponent_EntityComponentAdministrative)]
	if !adm.NoLifetime {
		t.Error("empty-lifetime push must be recorded as having no lifetime")
	}
	if lt := es.entity.Lifetime; !lt.Until.IsValid() || !lt.Until.AsTime().Equal(until) {
		t.Errorf("entity until = %v, want unchanged %v", lt.Until, until)
	}
}

// The watch.send span starts when the change was queued and marks the drain,
// so the time a change waited in the consumer is visible on it.
func TestWatchSend_MeasuresQueueLatency(t *testing.T) {
	sr := recordSpans(t)
	w := testWorld(nil)
	c := NewConsumer(w, nil, nil)
	w.bus.Register(c)
	defer w.bus.Unregister(c)

	before := time.Now()
	if _, err := w.Push(context.Background(), peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "e1", Label: ptr("x")}},
	})); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)

	sctx, cancel := context.WithCancel(context.Background())
	_ = c.SenderLoop(sctx, func(*pb.EntityChangeEvent) error { cancel(); return nil })
	send := spanNamed(sr, "watch.send")
	if send == nil {
		t.Fatal("no watch.send span")
	}
	if send.StartTime().Before(before) || send.StartTime().After(before.Add(10*time.Millisecond)) {
		t.Errorf("watch.send must start when the change was queued, started %v after push", send.StartTime().Sub(before))
	}
	var drained bool
	for _, ev := range send.Events() {
		if ev.Name == "drained" && ev.Time.Sub(send.StartTime()) >= 20*time.Millisecond {
			drained = true
		}
	}
	if !drained {
		t.Errorf("expected a drained event at least 20ms after the start, got %v", send.Events())
	}
	for _, a := range send.Attributes() {
		if a.Key == "hydris.watch.queue_ms" && a.Value.AsFloat64() < 20 {
			t.Errorf("queue_ms = %v, want >= 20", a.Value.AsFloat64())
		}
	}
}
