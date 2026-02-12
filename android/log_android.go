package hydris

/*
#cgo LDFLAGS: -llog

#include <android/log.h>
#include <stdlib.h>

void androidLog(int priority, const char* tag, const char* msg) {
    __android_log_write(priority, tag, msg);
}
*/
import "C"

import (
	"context"
	"fmt"
	"log/slog"
	"unsafe"
)

const (
	androidLogVerbose = 2
	androidLogDebug   = 3
	androidLogInfo    = 4
	androidLogWarn    = 5
	androidLogError   = 6
)

type androidLogHandler struct {
	level slog.Level
	tag   string
}

func (h *androidLogHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level
}

func (h *androidLogHandler) Handle(_ context.Context, r slog.Record) error {
	priority := androidLogInfo
	switch {
	case r.Level >= slog.LevelError:
		priority = androidLogError
	case r.Level >= slog.LevelWarn:
		priority = androidLogWarn
	case r.Level >= slog.LevelInfo:
		priority = androidLogInfo
	case r.Level >= slog.LevelDebug:
		priority = androidLogDebug
	default:
		priority = androidLogVerbose
	}

	msg := r.Message
	r.Attrs(func(a slog.Attr) bool {
		msg += fmt.Sprintf(" %s=%v", a.Key, a.Value.Any())
		return true
	})

	cTag := C.CString(h.tag)
	cMsg := C.CString(msg)
	defer C.free(unsafe.Pointer(cTag))
	defer C.free(unsafe.Pointer(cMsg))

	C.androidLog(C.int(priority), cTag, cMsg)
	return nil
}

func (h *androidLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return h
}

func (h *androidLogHandler) WithGroup(name string) slog.Handler {
	return h
}

func init() {
	handler := &androidLogHandler{
		level: slog.LevelInfo,
		tag:   "hydris",
	}
	slog.SetDefault(slog.New(handler))
	slog.Info("hydris android logging initialized")
}
