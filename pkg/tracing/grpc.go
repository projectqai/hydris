package tracing

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// metadataCarrier adapts outgoing gRPC metadata to the propagator interface.
type metadataCarrier metadata.MD

func (c metadataCarrier) Get(key string) string {
	v := metadata.MD(c).Get(key)
	if len(v) == 0 {
		return ""
	}
	return v[0]
}

func (c metadataCarrier) Set(key, value string) { metadata.MD(c).Set(key, value) }

func (c metadataCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for k := range c {
		keys = append(keys, k)
	}
	return keys
}

// inject copies the active trace context into the outgoing metadata of ctx.
func inject(ctx context.Context) context.Context {
	if !trace.SpanContextFromContext(ctx).IsValid() {
		return ctx
	}
	md, _ := metadata.FromOutgoingContext(ctx)
	md = md.Copy()
	otel.GetTextMapPropagator().Inject(ctx, metadataCarrier(md))
	return metadata.NewOutgoingContext(ctx, md)
}

// UnaryClientInterceptor propagates the caller's trace to the server and,
// when the caller is already inside a span, records the call as a client
// span. Calls made outside any span are passed through untouched so routine
// polling by builtins does not start a trace of its own.
func UnaryClientInterceptor() grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		if !trace.SpanContextFromContext(ctx).IsValid() {
			return invoker(ctx, method, req, reply, cc, opts...)
		}
		ctx, span := Tracer().Start(ctx, spanName(method),
			trace.WithSpanKind(trace.SpanKindClient),
			trace.WithAttributes(attribute.String("rpc.system", "grpc"), attribute.String("rpc.method", method)),
		)
		defer span.End()
		err := invoker(inject(ctx), method, req, reply, cc, opts...)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
		}
		return err
	}
}

// StreamClientInterceptor propagates the caller's trace when a stream is
// opened. Streams are long-lived, so no client span is created for them.
func StreamClientInterceptor() grpc.StreamClientInterceptor {
	return func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		return streamer(inject(ctx), desc, cc, method, opts...)
	}
}

// DialOptions returns the gRPC dial options that install both interceptors.
func DialOptions() []grpc.DialOption {
	return []grpc.DialOption{
		grpc.WithChainUnaryInterceptor(UnaryClientInterceptor()),
		grpc.WithChainStreamInterceptor(StreamClientInterceptor()),
	}
}

// spanName turns "/world.WorldService/Push" into "world.WorldService/Push".
func spanName(procedure string) string {
	if len(procedure) > 0 && procedure[0] == '/' {
		return procedure[1:]
	}
	return procedure
}

var _ propagation.TextMapCarrier = metadataCarrier{}
