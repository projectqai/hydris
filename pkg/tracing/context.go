package tracing

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"

	pb "github.com/projectqai/proto/go"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// derivePrefix salts the derivation (see Derive). Changing it breaks
// agreement with every external system that implements the scheme.
const derivePrefix = "hydris-trace-v1"

// Attribute keys used on hydris spans.
const (
	AttrEntityID    = attribute.Key("hydris.entity.id")
	AttrChange      = attribute.Key("hydris.entity.change")
	AttrChangeKind  = attribute.Key("hydris.entity.kind")
	AttrTransformer = attribute.Key("hydris.transformer")
	AttrBuiltin     = attribute.Key("hydris.builtin")
	AttrActor       = attribute.Key("hydris.actor")
	AttrNode        = attribute.Key("hydris.node")
	// AttrLink says what a span link means: "carrier" (the RPC or frame the
	// change arrived on) or "replaces" (the previous version of the entity).
	AttrLink = attribute.Key("hydris.link")
)

// Derive computes the trace of one entity version: one change, one trace. A
// version is identified the way the engine identifies it, by entity id and
// Lifetime.fresh, and nothing else goes in, so any system that knows both (a
// device on a radio link that cannot carry trace headers, a federation peer,
// a plugin) computes the same ids without asking anyone:
//
//	h        = SHA-256("hydris-trace-v1" || entity.id || 0x00 || fresh.seconds as int64 big-endian || fresh.nanos as int32 big-endian)
//	trace_id = h[0:16]
//	span_id  = h[16:24]
//
// trace_id is the trace of the change that produced the version. span_id is
// that trace's root span, owned by whoever set fresh: the engine when it
// stamped the version itself, otherwise the sender. Every other party adds
// its spans to the trace with that root as parent, and a collector shows
// them together whether or not the root was ever exported. seconds and nanos
// are exactly the google.protobuf.Timestamp fields on the wire. The result
// is marked sampled and remote.
//
// Every span in the trace is named after the entity id, so a collector
// groups an entity's versions by name while each version stays one trace.
// Relations between versions (the one replaced, the one a write was derived
// from) are span links to the other version's trace.
//
// Test vector: entity.id "node-1", fresh 2026-01-01T00:00:00.5Z
// (seconds 1767225600, nanos 500000000) →
// trace fd380223f8e0577cccdf4e50bb93e672, span a8bf88f971a9c727 (see tests).
func Derive(entityID string, fresh *timestamppb.Timestamp) trace.SpanContext {
	if fresh == nil || !fresh.IsValid() {
		return trace.SpanContext{}
	}
	h := sha256.New()
	h.Write([]byte(derivePrefix))
	h.Write([]byte(entityID))
	h.Write([]byte{0})
	var b [12]byte
	binary.BigEndian.PutUint64(b[:8], uint64(fresh.GetSeconds()))
	binary.BigEndian.PutUint32(b[8:], uint32(fresh.GetNanos()))
	h.Write(b[:])
	sum := h.Sum(nil)

	var tid trace.TraceID
	copy(tid[:], sum[:16])
	var sid trace.SpanID
	copy(sid[:], sum[16:24])
	return trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    tid,
		SpanID:     sid,
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
}

// Version is Derive over an entity's id and Lifetime.fresh; invalid when the
// entity names no version.
func Version(e *pb.Entity) trace.SpanContext {
	if e == nil || e.GetId() == "" {
		return trace.SpanContext{}
	}
	return Derive(e.GetId(), e.GetLifetime().GetFresh())
}

// Link marks a span link with what it means (see AttrLink).
func Link(sc trace.SpanContext, meaning string) trace.Link {
	return trace.Link{SpanContext: sc, Attributes: []attribute.KeyValue{AttrLink.String(meaning)}}
}

// pinKey carries the ids the next root span started from a context must use.
type pinKey struct{}

// idGenerator hands out random ids like the SDK default, except that a root
// span started from a context carrying pinned ids (StartChange) gets exactly
// those, so the engine's change span is the derived root of its trace.
type idGenerator struct{}

// IDGenerator returns the generator Init installs. A test that builds its own
// provider needs it for StartChange to pin ids.
func IDGenerator() sdktrace.IDGenerator { return idGenerator{} }

func (idGenerator) NewIDs(ctx context.Context) (trace.TraceID, trace.SpanID) {
	if sc, ok := ctx.Value(pinKey{}).(trace.SpanContext); ok && sc.IsValid() {
		return sc.TraceID(), sc.SpanID()
	}
	var tid trace.TraceID
	for !tid.IsValid() {
		_, _ = rand.Read(tid[:])
	}
	return tid, randomSpanID()
}

func (idGenerator) NewSpanID(context.Context, trace.TraceID) trace.SpanID { return randomSpanID() }

func randomSpanID() trace.SpanID {
	var sid trace.SpanID
	for !sid.IsValid() {
		_, _ = rand.Read(sid[:])
	}
	return sid
}

// StartChange starts the span of one entity change in the trace derived from
// the version it produced (see Derive).
//
// When the engine stamped fresh itself (external is false) it owns the
// version: the span is the trace's root and carries the derived ids exactly.
// When the sender named the version (external is true) the sender owns the
// root and this span is its child; the root appears if the sender exports it
// and the trace is complete without it. Either way the RPC span in ctx, if
// any, is attached as a "carrier" link, so the hop stays discoverable, and
// the returned ctx carries the change span for merge, transformers, watchers
// and expiry to hang off.
func StartChange(ctx context.Context, version trace.SpanContext, external bool, name string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	if external {
		return StartSpan(ctx, version, name, opts...)
	}
	if cur := trace.SpanContextFromContext(ctx); cur.IsValid() {
		opts = append(opts, trace.WithLinks(Link(cur, "carrier")))
	}
	ctx = context.WithValue(ctx, pinKey{}, version)
	ctx, span := Tracer().Start(ctx, name, append(opts, trace.WithNewRoot())...)
	return context.WithValue(ctx, pinKey{}, nil), span
}

// StartSpan starts a span for a processing step whose subject has a trace of
// its own (remote), e.g. a derived version, a watch event or a LoRa frame.
// The parent is chosen so that trace is continued:
//
//   - remote is valid and ctx has no span, or one on a different trace:
//     remote is the parent and ctx's span (if any) is attached as a "carrier"
//     link, so the transport hop stays discoverable;
//   - otherwise ctx's span is the parent (it is already on remote's trace, or
//     there is no remote context).
//
// With nothing to continue, the span is a new root.
func StartSpan(ctx context.Context, remote trace.SpanContext, name string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	cur := trace.SpanContextFromContext(ctx)
	if remote.IsValid() && (!cur.IsValid() || cur.TraceID() != remote.TraceID()) {
		if cur.IsValid() {
			opts = append(opts, trace.WithLinks(Link(cur, "carrier")))
		}
		ctx = trace.ContextWithRemoteSpanContext(ctx, remote)
	}
	return Tracer().Start(ctx, name, opts...)
}

// ContinueSpan is StartSpan for steps that are only worth a span when there
// is a trace to continue: when neither remote nor ctx carries one, it returns
// ctx unchanged and a non-recording span, so routine churn never starts a
// trace of its own.
func ContinueSpan(ctx context.Context, remote trace.SpanContext, name string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	if !remote.IsValid() && !trace.SpanContextFromContext(ctx).IsValid() {
		return ctx, trace.SpanFromContext(ctx)
	}
	return StartSpan(ctx, remote, name, opts...)
}
