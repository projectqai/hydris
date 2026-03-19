//go:build windows

package webcam

import (
	"context"
	"log/slog"
)

// discoverAndWatch is disabled on Windows due to Media Foundation COM crashes.
func discoverAndWatch(ctx context.Context, logger *slog.Logger) <-chan map[string]webcamInfo {
	ch := make(chan map[string]webcamInfo, 1)
	ch <- make(map[string]webcamInfo) // empty snapshot
	go func() {
		defer close(ch)
		<-ctx.Done()
	}()
	return ch
}
