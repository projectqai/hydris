//go:build !linux && !darwin && !windows

package webcam

import (
	"context"
	"log/slog"
)

// discoverAndWatch is a no-op on unsupported platforms.
func discoverAndWatch(ctx context.Context, logger *slog.Logger) <-chan map[string]webcamInfo {
	ch := make(chan map[string]webcamInfo, 1)
	ch <- make(map[string]webcamInfo) // empty snapshot
	go func() {
		defer close(ch)
		<-ctx.Done()
	}()
	return ch
}
