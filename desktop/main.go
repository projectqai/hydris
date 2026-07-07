package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
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
		LogRing: logging.Ring,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to start engine:", err)
		ErrorDialog("Hydris failed to start", startupErrorMessage(err))
		os.Exit(1)
	}

	builtin.StartAll(ctx, serverAddr)

	// Wait for server to be ready
	deadline := time.Now().Add(30 * time.Second)
	for {
		resp, err := http.Get("http://" + serverAddr + "/healthz")
		if err == nil {
			resp.Body.Close()
			break
		}
		if time.Now().After(deadline) {
			fmt.Fprintln(os.Stderr, "engine did not become ready:", err)
			ErrorDialog("Hydris failed to start",
				fmt.Sprintf("The Hydris engine did not become ready within 30 seconds.\n\nDetails: %v", err))
			os.Exit(1)
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

// startupErrorMessage turns an engine startup error into a message suitable
// for a user-facing dialog, with actionable advice for the common
// port-already-in-use case.
func startupErrorMessage(err error) string {
	if isAddrInUse(err) {
		port := os.Getenv("PORT")
		if port == "" {
			port = "50051"
		}
		return fmt.Sprintf("Hydris could not start because port %s is already in use by another application, "+
			"such as another Hydris instance or a video conferencing app.\n\n"+
			"Close the application using the port, then start Hydris again.\n\nDetails: %v", port, err)
	}
	return fmt.Sprintf("Hydris could not start.\n\nDetails: %v", err)
}

// isAddrInUse reports whether err was caused by a listen on an occupied port.
func isAddrInUse(err error) bool {
	if errors.Is(err, syscall.EADDRINUSE) {
		return true
	}
	// Windows sockets return WSAEADDRINUSE, which errors.Is does not match
	// against syscall.EADDRINUSE, so fall back to the message text.
	msg := err.Error()
	return strings.Contains(msg, "address already in use") ||
		strings.Contains(msg, "Only one usage of each socket address")
}
