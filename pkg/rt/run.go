package rt

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// RunPlugin runs a JS bundle in goja with automatic restart on crash.
// Blocks until ctx is cancelled. Suitable for both CLI and in-process
// (android) use. dataDir is the plugin source directory (containing
// package.json) used to sandbox file access; pass "" to disable.
func RunPlugin(ctx context.Context, bundlePath string, dataDir string) error {
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		slog.Info("starting plugin", "file", bundlePath)
		r := New(dataDir)
		err := r.RunFile(ctx, bundlePath)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			slog.Error("plugin crashed, restarting in 1s", "error", err)
		} else {
			slog.Info("plugin exited, restarting in 1s")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// FindDataDir walks up from path to find the directory containing
// package.json. Returns empty string if not found.
func FindDataDir(path string) string {
	dir := filepath.Dir(path)
	for {
		if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// RunPluginEnv is like RunPlugin but sets HYDRIS_SERVER first.
func RunPluginEnv(ctx context.Context, bundlePath, dataDir, serverURL string) error {
	if serverURL != "" {
		os.Setenv("HYDRIS_SERVER", serverURL)
	}
	return RunPlugin(ctx, bundlePath, dataDir)
}
