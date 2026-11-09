package tracing

import (
	"context"

	"connectrpc.com/connect"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// ConnectInterceptor returns a server-side connect interceptor that extracts
// the W3C trace context from incoming headers and wraps every RPC in a server
// span. Install it before the policy interceptor so authorization is covered.
// A Push arriving without a header is a root the sampler drops as routine;
// the entity changes it carries are traces of their own either way (see
// StartChange) and link the RPC span when it is recorded.
func ConnectInterceptor() connect.Interceptor {
	return connectInterceptor{}
}

type connectInterceptor struct{}

func rpcAttrs(procedure, peer, builtin string) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		attribute.String("rpc.system", "connect"),
		attribute.String("rpc.method", procedure),
		attribute.String("network.peer.address", peer),
	}
	if builtin != "" {
		attrs = append(attrs, AttrBuiltin.String(builtin))
	}
	return attrs
}

func (connectInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		ctx = otel.GetTextMapPropagator().Extract(ctx, propagation.HeaderCarrier(req.Header()))
		ctx, span := Tracer().Start(ctx, spanName(req.Spec().Procedure),
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(rpcAttrs(req.Spec().Procedure, req.Peer().Addr, req.Header().Get("X-Builtin-Name"))...),
		)
		defer span.End()
		res, err := next(ctx, req)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			span.SetAttributes(attribute.String("rpc.connect.code", connect.CodeOf(err).String()))
		}
		return res, err
	}
}

func (connectInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func (connectInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		ctx = otel.GetTextMapPropagator().Extract(ctx, propagation.HeaderCarrier(conn.RequestHeader()))
		ctx, span := Tracer().Start(ctx, spanName(conn.Spec().Procedure),
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(rpcAttrs(conn.Spec().Procedure, conn.Peer().Addr, conn.RequestHeader().Get("X-Builtin-Name"))...),
		)
		defer span.End()
		err := next(ctx, conn)
		if err != nil && ctx.Err() == nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			span.SetAttributes(attribute.String("rpc.connect.code", connect.CodeOf(err).String()))
		}
		return err
	}
}
