package logging

import (
	"context"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/lmittmann/tint"
	"github.com/projectqai/hydris/engine"
)

type modulePrefixHandler struct {
	handler slog.Handler
	module  string
}

func (h *modulePrefixHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.handler.Enabled(ctx, level)
}

func (h *modulePrefixHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	module := h.module
	var otherAttrs []slog.Attr

	for _, attr := range attrs {
		if attr.Key == "module" {
			module = attr.Value.String()
		} else {
			otherAttrs = append(otherAttrs, attr)
		}
	}

	return &modulePrefixHandler{
		handler: h.handler.WithAttrs(otherAttrs),
		module:  module,
	}
}

func (h *modulePrefixHandler) WithGroup(name string) slog.Handler {
	return &modulePrefixHandler{
		handler: h.handler.WithGroup(name),
		module:  h.module,
	}
}

func (h *modulePrefixHandler) Handle(ctx context.Context, r slog.Record) error {
	if h.module != "" {
		newRecord := slog.NewRecord(r.Time, r.Level, "["+h.module+"] "+r.Message, r.PC)
		r.Attrs(func(a slog.Attr) bool {
			newRecord.AddAttrs(a)
			return true
		})
		return h.handler.Handle(ctx, newRecord)
	}

	return h.handler.Handle(ctx, r)
}

// Ring is the global log ring buffer. It captures formatted log output
// and serves it over HTTP via /logs.
var Ring *engine.LogRing

func init() {
	level := slog.LevelInfo
	if os.Getenv("HYDRIS_DEBUG") != "" {
		level = slog.LevelDebug
	}

	Ring = new(engine.LogRing)

	handler := &modulePrefixHandler{
		handler: tint.NewHandler(io.MultiWriter(Ring, os.Stderr), &tint.Options{
			Level:      level,
			TimeFormat: time.Kitchen,
		}),
	}
	slog.SetDefault(slog.New(handler))
}
