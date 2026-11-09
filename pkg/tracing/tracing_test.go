package tracing

import (
	"context"
	"testing"

	pb "github.com/projectqai/proto/go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// recorder installs an in-memory recording tracer provider for the test and
// restores the previous global afterwards.
func recorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr), sdktrace.WithIDGenerator(IDGenerator()))
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() {
		otel.SetTracerProvider(prev)
		_ = tp.Shutdown(context.Background())
	})
	return sr
}

// The documented test vector (Derive doc comment, README, examples/tracing).
// External systems implementing the derivation must reproduce it.
const (
	vectorEntity  = "node-1"
	vectorTraceID = "fd380223f8e0577cccdf4e50bb93e672"
	vectorSpanID  = "a8bf88f971a9c727"
)

var vectorFresh = &timestamppb.Timestamp{Seconds: 1767225600, Nanos: 500000000}

func TestDeriveVector(t *testing.T) {
	sc := Derive(vectorEntity, vectorFresh)
	if got := sc.TraceID().String(); got != vectorTraceID {
		t.Errorf("trace id = %s, want %s", got, vectorTraceID)
	}
	if got := sc.SpanID().String(); got != vectorSpanID {
		t.Errorf("span id = %s, want %s", got, vectorSpanID)
	}
	if !sc.IsSampled() || !sc.IsRemote() {
		t.Error("derived context must be sampled and remote")
	}
	other := &timestamppb.Timestamp{Seconds: 1767225600, Nanos: 500000001}
	if Derive("node-1", other).TraceID() == sc.TraceID() {
		t.Error("another version of the same entity must be another trace")
	}
	if Derive("node-2", vectorFresh).TraceID() == sc.TraceID() {
		t.Error("another entity must be another trace")
	}
	if Derive("node-1", nil).IsValid() {
		t.Error("no fresh, no context")
	}
	e := &pb.Entity{Id: vectorEntity, Lifetime: &pb.Lifetime{Fresh: vectorFresh}}
	if !Version(e).Equal(sc) {
		t.Error("Version must derive from the entity's id and fresh")
	}
	if Version(&pb.Entity{Id: vectorEntity}).IsValid() {
		t.Error("entity without fresh has no version")
	}
}

// The engine owns a version it stamped itself: its change span is the root
// of the derived trace and carries the derived ids exactly, so an external
// system that computes the same ids finds a real root to attach to.
func TestStartChangeEngineOwnsRoot(t *testing.T) {
	sr := recorder(t)
	version := Derive(vectorEntity, vectorFresh)

	ctx, span := StartChange(context.Background(), version, false, vectorEntity)
	_, child := Tracer().Start(ctx, "merge")
	child.End()
	span.End()

	root := sr.Ended()[1]
	if root.SpanContext().TraceID() != version.TraceID() || root.SpanContext().SpanID() != version.SpanID() {
		t.Errorf("root ids = %s/%s, want the derived %s/%s", root.SpanContext().TraceID(), root.SpanContext().SpanID(), version.TraceID(), version.SpanID())
	}
	if root.Parent().IsValid() {
		t.Error("the engine's change span must be a root")
	}
	got := sr.Ended()[0]
	if got.SpanContext().TraceID() != version.TraceID() || got.Parent().SpanID() != version.SpanID() || got.SpanContext().SpanID() == version.SpanID() {
		t.Errorf("child must hang off the root with a fresh span id: trace=%s parent=%s id=%s", got.SpanContext().TraceID(), got.Parent().SpanID(), got.SpanContext().SpanID())
	}

	// The pin must not leak: a new root started from the returned ctx gets
	// random ids.
	_, other := Tracer().Start(ctx, "unrelated", trace.WithNewRoot())
	other.End()
	if other.SpanContext().TraceID() == version.TraceID() {
		t.Error("pinned ids leaked into a later root")
	}
}

// A version the sender named is owned by the sender: the engine's change
// span is a child of the derived root, which the sender may or may not
// export, and the RPC it arrived on is linked as carrier.
func TestStartChangeSenderOwnsRoot(t *testing.T) {
	sr := recorder(t)
	version := Derive(vectorEntity, vectorFresh)

	rctx, rpc := Tracer().Start(context.Background(), "world.WorldService/Push")
	_, span := StartChange(rctx, version, true, vectorEntity)
	span.End()
	rpc.End()

	got := sr.Ended()[0]
	if got.SpanContext().TraceID() != version.TraceID() || got.Parent().SpanID() != version.SpanID() {
		t.Errorf("external: trace=%s parent=%s, want %s/%s", got.SpanContext().TraceID(), got.Parent().SpanID(), version.TraceID(), version.SpanID())
	}
	if got.SpanContext().SpanID() == version.SpanID() {
		t.Error("the engine must not claim the sender's root span id")
	}
	if len(got.Links()) != 1 || got.Links()[0].SpanContext.SpanID() != rpc.SpanContext().SpanID() {
		t.Errorf("expected a carrier link to the RPC, got %v", got.Links())
	}

	// Engine-owned with an RPC in ctx: still a root, RPC linked.
	rctx, rpc = Tracer().Start(context.Background(), "world.WorldService/Push")
	_, span = StartChange(rctx, version, false, vectorEntity)
	span.End()
	rpc.End()
	got = sr.Ended()[2]
	if got.Parent().IsValid() || got.SpanContext().SpanID() != version.SpanID() {
		t.Error("engine-owned change under an RPC must still be the derived root")
	}
	if len(got.Links()) != 1 || got.Links()[0].SpanContext.SpanID() != rpc.SpanContext().SpanID() {
		t.Errorf("expected a carrier link to the RPC, got %v", got.Links())
	}
}

func TestStartSpanParenting(t *testing.T) {
	sr := recorder(t)
	device := Derive("det-1", &timestamppb.Timestamp{Seconds: 3})

	// No ambient span: remote is the parent.
	_, span := StartSpan(context.Background(), device, "hop")
	span.End()
	got := sr.Ended()[len(sr.Ended())-1]
	if got.SpanContext().TraceID() != device.TraceID() || got.Parent().SpanID() != device.SpanID() {
		t.Errorf("no ambient: trace=%s parent=%s, want %s/%s", got.SpanContext().TraceID(), got.Parent().SpanID(), device.TraceID(), device.SpanID())
	}
	if len(got.Links()) != 0 {
		t.Error("no ambient span: expected no link")
	}

	// Ambient span on another trace: remote is the parent, the carrier is linked.
	cctx, carrier := Tracer().Start(context.Background(), "carrier")
	_, span = StartSpan(cctx, device, "hop")
	span.End()
	carrier.End()
	got = sr.Ended()[len(sr.Ended())-2]
	if got.SpanContext().TraceID() != device.TraceID() || got.Parent().SpanID() != device.SpanID() {
		t.Errorf("foreign ambient: parent should be remote, got trace=%s parent=%s", got.SpanContext().TraceID(), got.Parent().SpanID())
	}
	if len(got.Links()) != 1 || got.Links()[0].SpanContext.SpanID() != carrier.SpanContext().SpanID() {
		t.Errorf("foreign ambient: expected a link to the carrier, got %v", got.Links())
	}

	// Ambient span already on remote's trace: it is the parent.
	sctx, same := Tracer().Start(trace.ContextWithRemoteSpanContext(context.Background(), device), "same-trace")
	_, span = StartSpan(sctx, device, "hop")
	span.End()
	same.End()
	got = sr.Ended()[len(sr.Ended())-2]
	if got.Parent().SpanID() != same.SpanContext().SpanID() || len(got.Links()) != 0 {
		t.Errorf("same trace: parent=%s want %s, links=%d", got.Parent().SpanID(), same.SpanContext().SpanID(), len(got.Links()))
	}

	// Nothing traced anywhere: StartSpan roots, ContinueSpan does not record.
	_, span = StartSpan(context.Background(), trace.SpanContext{}, "root")
	if !span.IsRecording() {
		t.Error("StartSpan must open a root span")
	}
	span.End()
	_, span = ContinueSpan(context.Background(), trace.SpanContext{}, "skip")
	if span.IsRecording() {
		t.Error("ContinueSpan must not open a span with nothing to continue")
	}
	_, span = ContinueSpan(context.Background(), device, "cont")
	if !span.IsRecording() {
		t.Error("ContinueSpan must continue a remote trace")
	}
	span.End()
}

func TestExporterConfigFromEnv(t *testing.T) {
	for _, k := range []string{"OTEL_SDK_DISABLED", "OTEL_TRACES_EXPORTER", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL"} {
		t.Setenv(k, "")
	}
	if _, _, ok := exporterConfig(); ok {
		t.Error("unconfigured environment must not export")
	}
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://jaeger:4318")
	if ep, proto, ok := exporterConfig(); !ok || proto != "http/protobuf" || ep != "http://jaeger:4318" {
		t.Errorf("http endpoint: %s %s %v", ep, proto, ok)
	}
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://jaeger:4317")
	if _, proto, _ := exporterConfig(); proto != "grpc" {
		t.Errorf("port 4317 should imply grpc, got %s", proto)
	}
	t.Setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
	if _, proto, _ := exporterConfig(); proto != "http/protobuf" {
		t.Errorf("explicit protocol must win, got %s", proto)
	}
	t.Setenv("OTEL_TRACES_EXPORTER", "none")
	if _, _, ok := exporterConfig(); ok {
		t.Error("OTEL_TRACES_EXPORTER=none must disable export")
	}
	t.Setenv("OTEL_TRACES_EXPORTER", "")
	t.Setenv("OTEL_SDK_DISABLED", "true")
	if _, _, ok := exporterConfig(); ok {
		t.Error("OTEL_SDK_DISABLED must disable export")
	}
}

func TestChangeKind(t *testing.T) {
	if k := ChangeKind(&pb.Entity{Id: "b", Geo: &pb.GeoSpatialComponent{}, Detection: &pb.DetectionComponent{}}); k != "detection" {
		t.Errorf("kind = %s, want detection", k)
	}
	if k := ChangeKind(&pb.Entity{Id: "a", Metric: &pb.MetricComponent{}}); k != "metric" {
		t.Errorf("kind = %s, want metric", k)
	}
	if k := ChangeKind(&pb.Entity{Id: "a"}); k != "entity" {
		t.Errorf("kind = %s, want entity", k)
	}
}

func TestRootSamplerDropsRoutine(t *testing.T) {
	s := rootSampler{base: sdktrace.AlwaysSample()}
	drop := func(name string, attrs ...attribute.KeyValue) bool {
		return s.ShouldSample(sdktrace.SamplingParameters{Name: name, Attributes: attrs}).Decision == sdktrace.Drop
	}
	if !drop("world.WorldService/WatchEntities") || !drop("world.WorldService/GetLocalNode") || !drop("world.WorldService/Push") {
		t.Error("routine reads and headerless pushes must be dropped")
	}
	if !drop("hal.service", AttrChangeKind.String("metric")) {
		t.Error("telemetry-only changes must be dropped")
	}
	if !drop("hal.service", AttrChangeKind.String("configurable"), AttrBuiltin.String("hal")) {
		t.Error("a builtin re-registering its service entity must be dropped")
	}
	if drop("cam-1", AttrChangeKind.String("device")) {
		t.Error("a client's device/config change is real work")
	}
	if drop("icao:3c6444", AttrChangeKind.String("transponder")) || drop("federation.relay") {
		t.Error("real work must be sampled")
	}
	all := rootSampler{base: sdktrace.AlwaysSample(), routine: true}
	if all.ShouldSample(sdktrace.SamplingParameters{Name: "world.WorldService/WatchEntities"}).Decision == sdktrace.Drop {
		t.Error("HYDRIS_TRACE_ROUTINE keeps routine roots")
	}

	// The full sampler applies the same rules to spans continuing a derived
	// trace (remote parent), so the decision matches the system that derived
	// the ids.
	t.Setenv("OTEL_TRACES_SAMPLER_ARG", "")
	t.Setenv("HYDRIS_TRACE_ROUTINE", "")
	full := newSampler()
	version := Derive(vectorEntity, vectorFresh)
	remote := trace.ContextWithRemoteSpanContext(context.Background(), version)
	if full.ShouldSample(sdktrace.SamplingParameters{ParentContext: remote, TraceID: version.TraceID(), Name: vectorEntity, Attributes: []attribute.KeyValue{AttrChangeKind.String("metric")}}).Decision == sdktrace.RecordAndSample {
		t.Error("a metric-only change under a derived parent must still be dropped")
	}
	if full.ShouldSample(sdktrace.SamplingParameters{ParentContext: remote, TraceID: version.TraceID(), Name: vectorEntity, Attributes: []attribute.KeyValue{AttrChangeKind.String("detection")}}).Decision != sdktrace.RecordAndSample {
		t.Error("a detection under a derived parent must be sampled")
	}
}
