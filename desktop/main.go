package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/projectqai/hydris/pkg/logging"

	"github.com/projectqai/hydris/builtin"
	_ "github.com/projectqai/hydris/builtin/all"
	"github.com/projectqai/hydris/cli"
	"github.com/projectqai/hydris/engine"
	_ "github.com/projectqai/hydris/view"
)

func main() {
	// When spawned as a plugin subprocess (e.g. "hydris plugin run ..."),
	// delegate to the CLI command tree instead of starting the engine again.
	if len(os.Args) > 1 && os.Args[1] == "plugin" {
		if err := cli.CMD.Execute(); err != nil {
			os.Exit(1)
		}
		return
	}

	// Work around WebKitGTK DMA-BUF renderer crash on wlroots compositors (Hyprland).
	// Use multithreaded CPU Skia rendering instead of GPU to avoid GBM buffer issues
	// while keeping acceptable performance through Skia's threaded tile pipeline.
	if os.Getenv("WEBKIT_DISABLE_DMABUF_RENDERER") == "" {
		os.Setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
	}
	if os.Getenv("WEBKIT_SKIA_ENABLE_CPU_RENDERING") == "" {
		os.Setenv("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "1")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	serverAddr, err := engine.StartEngine(ctx, engine.EngineConfig{
		LogHandler: logging.Ring,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to start engine:", err)
		os.Exit(1)
	}

	builtin.StartAll(ctx, serverAddr)

	// Wait for server to be ready
	for {
		resp, err := http.Get("http://" + serverAddr + "/healthz")
		if err == nil {
			resp.Body.Close()
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	w := NewWebview("Hydris", 1280, 800, true)
	defer w.Destroy()

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		cancel()
		w.Shutdown()
	}()

	w.Navigate("http://" + serverAddr)
	w.Run()
}
