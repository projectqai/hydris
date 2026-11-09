// Package tracing wires OpenTelemetry distributed tracing through hydris.
//
// Every entity change (each write that moves Lifetime.fresh) is one trace,
// named after the entity id, and its ids are derived from what identifies
// the version, the entity id and Lifetime.fresh (see Derive). No trace ids
// travel with entities: any system that sees a version computes the same
// ids, so spans from a device on a radio link, a gateway, the engine and a
// federation peer all land in one trace in the collector.
//
// Configuration follows the standard OTEL_* environment variables, so any
// OTLP-speaking backend (Jaeger, Grafana Tempo, an OpenTelemetry Collector)
// works without hydris-specific settings:
//
//	OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # enables export
//	OTEL_EXPORTER_OTLP_PROTOCOL=grpc|http/protobuf      # default http/protobuf (grpc when the port is 4317)
//	OTEL_SERVICE_NAME=hydris                            # default "hydris"
//	OTEL_TRACES_SAMPLER_ARG=0.1                         # ratio of traces to keep (by trace id), default all
//	HYDRIS_TRACE_ROUTINE=1                              # also trace routine reads, telemetry and housekeeping
//
// Without an endpoint no spans are exported, but trace context is still
// propagated (headers in and out), so a node that does export sees a
// complete trace.
package tracing

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// InstrumentationName is the tracer name every hydris span is created under.
const InstrumentationName = "github.com/projectqai/hydris"

// Options describes the process to the collector.
type Options struct {
	// ServiceName is the default service.name; OTEL_SERVICE_NAME overrides it.
	ServiceName string
	// Version becomes service.version.
	Version string
	// NodeID becomes service.instance.id, so spans from different hydris nodes
	// in one trace can be told apart.
	NodeID string
}

var provider *sdktrace.TracerProvider

// Init installs the W3C propagator and, when an OTLP endpoint is configured
// through the environment, a batching OTLP exporter. It is safe to call when
// nothing is configured: propagation still works and spans are no-ops.
func Init(ctx context.Context, opts Options) error {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	endpoint, protocol, ok := exporterConfig()
	if !ok {
		return nil
	}

	var (
		exp *otlptrace.Exporter
		err error
	)
	switch protocol {
	case "grpc":
		exp, err = otlptracegrpc.New(ctx)
	case "http/protobuf", "http/json", "http":
		exp, err = otlptracehttp.New(ctx)
	default:
		return fmt.Errorf("tracing: unsupported OTLP protocol %q (use grpc or http/protobuf)", protocol)
	}
	if err != nil {
		return fmt.Errorf("tracing: create OTLP exporter: %w", err)
	}

	name := opts.ServiceName
	if name == "" {
		name = "hydris"
	}
	attrs := []attribute.KeyValue{attribute.String("service.name", name)}
	if opts.Version != "" {
		attrs = append(attrs, attribute.String("service.version", opts.Version))
	}
	if opts.NodeID != "" {
		attrs = append(attrs, attribute.String("service.instance.id", opts.NodeID), attribute.String("hydris.node", opts.NodeID))
	}
	// Later detectors win, so the environment (OTEL_SERVICE_NAME,
	// OTEL_RESOURCE_ATTRIBUTES) overrides our defaults.
	res, err := resource.New(ctx,
		resource.WithAttributes(attrs...),
		resource.WithTelemetrySDK(),
		resource.WithFromEnv(),
	)
	if err != nil {
		// resource.New only fails on schema conflicts; keep whatever it managed.
		slog.Debug("tracing: resource detection", "error", err)
	}

	provider = sdktrace.NewTracerProvider(
		sdktrace.WithIDGenerator(idGenerator{}),
		sdktrace.WithSampler(newSampler()),
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(provider)
	slog.Info("otlp trace export enabled", "endpoint", endpoint, "protocol", protocol, "service", name)
	return nil
}

// Shutdown flushes pending spans. No-op when export is not enabled.
func Shutdown(ctx context.Context) error {
	if provider == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return provider.Shutdown(ctx)
}

// Tracer returns the tracer all hydris spans are created under.
func Tracer() trace.Tracer {
	return otel.Tracer(InstrumentationName)
}

// exporterConfig resolves whether and how to export from the standard
// environment. It returns the endpoint (for logging), the protocol, and
// whether export is enabled at all.
func exporterConfig() (endpoint, protocol string, ok bool) {
	if strings.EqualFold(os.Getenv("OTEL_SDK_DISABLED"), "true") {
		return "", "", false
	}
	exporter := strings.ToLower(strings.TrimSpace(os.Getenv("OTEL_TRACES_EXPORTER")))
	if exporter == "none" {
		return "", "", false
	}
	endpoint = os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	if endpoint == "" {
		endpoint = os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	}
	if endpoint == "" && exporter != "otlp" {
		return "", "", false
	}

	protocol = os.Getenv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL")
	if protocol == "" {
		protocol = os.Getenv("OTEL_EXPORTER_OTLP_PROTOCOL")
	}
	if protocol == "" {
		protocol = "http/protobuf"
		// 4317 is the well-known OTLP/gRPC port; pointing the default HTTP
		// exporter at it fails silently, so pick gRPC for it.
		if u, err := url.Parse(endpoint); err == nil && u.Port() == "4317" {
			protocol = "grpc"
		}
	}
	if endpoint == "" {
		endpoint = "(exporter default)"
	}
	return endpoint, strings.ToLower(protocol), true
}
