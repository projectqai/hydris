package rt

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
)

func runUntil(t *testing.T, js string, wait time.Duration) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	r := New("")
	r.loop.RunOnLoop(func(vm *goja.Runtime) {
		vm.Set("rejectImmediately", func() goja.Value {
			p, _, reject := vm.NewPromise()
			_ = reject(vm.ToValue("native failure"))
			return vm.ToValue(p)
		})
	})
	return r.RunScript(ctx, "test.js", js)
}

func TestRunScriptSurvivesCaughtNativeRejection(t *testing.T) {
	err := runUntil(t, `
		try { await rejectImmediately(); } catch (_) {}
		await Promise.reject(new Error("x")).catch(() => {});
	`, 500*time.Millisecond)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("caught rejections crashed the runtime: %v", err)
	}
}

func TestRunScriptCrashesOnUnhandledRejection(t *testing.T) {
	err := runUntil(t, `Promise.reject(new Error("nobody listens"));`, 5*time.Second)
	if err == nil || !strings.Contains(err.Error(), "nobody listens") {
		t.Fatalf("unhandled rejection did not crash the runtime: %v", err)
	}
}
