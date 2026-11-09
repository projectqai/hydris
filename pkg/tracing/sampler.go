package tracing

import (
	"os"
	"strconv"
	"strings"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// routineRoots are RPCs that, arriving without a trace to continue, would
// only add noise to a collector: watch streams, polling reads, time sync, and
// pushes themselves (the changes a push carries are traces of their own, and
// link back to the RPC when it is traced by its caller). Their root spans are
// dropped unless HYDRIS_TRACE_ROUTINE=1.
var routineRoots = map[string]bool{
	"world.WorldService/ListEntities":  true,
	"world.WorldService/GetEntity":     true,
	"world.WorldService/WatchEntities": true,
	"world.WorldService/GetLocalNode":  true,
	"world.WorldService/GetSelf":       true,
	"world.WorldService/TimeSync":      true,
	"world.WorldService/Push":          true,
}

// housekeepingKinds are change kinds that, coming from a builtin, are its own
// service-entity upkeep (registration, capabilities, state) rather than data.
// From a client the same kinds are configuration changes and kept.
var housekeepingKinds = map[string]bool{"device": true, "configurable": true, "config": true}

// rootSampler decides for spans that start a trace on this node, and for
// spans continuing a derived trace (remote parent), which is the same
// decision made by whoever computed the ids first. It drops routine reads,
// telemetry-only changes and builtin housekeeping, then defers to the
// configured base sampler (OTEL_TRACES_SAMPLER_ARG as a ratio, default always
// on). The ratio is a function of the trace id alone, so every system
// deriving the same trace id keeps or drops the same traces. Children with a
// local parent follow it (ParentBased).
type rootSampler struct {
	base    sdktrace.Sampler
	routine bool
}

func newSampler() sdktrace.Sampler {
	base := sdktrace.AlwaysSample()
	if arg := os.Getenv("OTEL_TRACES_SAMPLER_ARG"); arg != "" {
		if ratio, err := strconv.ParseFloat(arg, 64); err == nil {
			base = sdktrace.TraceIDRatioBased(ratio)
		}
	}
	routine := strings.EqualFold(os.Getenv("HYDRIS_TRACE_ROUTINE"), "1") || strings.EqualFold(os.Getenv("HYDRIS_TRACE_ROUTINE"), "true")
	root := rootSampler{base: base, routine: routine}
	return sdktrace.ParentBased(root, sdktrace.WithRemoteParentSampled(root))
}

func (s rootSampler) ShouldSample(p sdktrace.SamplingParameters) sdktrace.SamplingResult {
	if !s.routine {
		if routineRoots[p.Name] {
			return sdktrace.SamplingResult{Decision: sdktrace.Drop}
		}
		var kind, builtin string
		for _, a := range p.Attributes {
			switch a.Key {
			case AttrChangeKind:
				kind = a.Value.AsString()
			case AttrBuiltin:
				builtin = a.Value.AsString()
			}
		}
		if kind == "metric" || (builtin != "" && housekeepingKinds[kind]) {
			return sdktrace.SamplingResult{Decision: sdktrace.Drop}
		}
	}
	return s.base.ShouldSample(p)
}

func (s rootSampler) Description() string { return "hydris(" + s.base.Description() + ")" }
