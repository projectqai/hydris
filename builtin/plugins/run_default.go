//go:build !android

package plugins

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"

	"github.com/projectqai/hydris/pkg/executil"
)

// runPlugin runs a plugin subprocess, returning an error when it crashes.
// The controller framework will set the entity to Failed state with the error
// message and retry with backoff.
func runPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string, dockerCfgDir string) error {
	logger.Info("starting plugin subprocess", "name", info.Name, "ref", info.Ref)
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, os.Args[0], "plugin", "run", "--server", "http://"+serverURL, info.Ref)
	executil.HideWindow(cmd)
	cmd.Stdout = os.Stdout
	cmd.Stderr = io.MultiWriter(os.Stderr, &limitedWriter{buf: &stderr, max: 4096})
	if dockerCfgDir != "" {
		cmd.Env = append(os.Environ(), "DOCKER_CONFIG="+dockerCfgDir)
	}

	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("%s", msg)
	}

	if ctx.Err() != nil {
		return nil
	}

	return fmt.Errorf("plugin exited unexpectedly")
}

// limitedWriter captures up to max bytes, keeping the tail on overflow.
type limitedWriter struct {
	buf *bytes.Buffer
	max int
}

func (w *limitedWriter) Write(p []byte) (int, error) {
	n := len(p)
	if w.buf.Len()+n > w.max {
		// Keep only the tail.
		w.buf.Reset()
	}
	w.buf.Write(p)
	return n, nil
}
