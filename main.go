package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"time"

	"github.com/projectqai/hydris/pkg/logging"

	"github.com/projectqai/hydris/builtin"
	_ "github.com/projectqai/hydris/builtin/all"
	"github.com/projectqai/hydris/cli"
	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/pkg/executil"
	"github.com/spf13/cobra"

	"github.com/pkg/browser"
)

func init() {
	cli.CMD.Flags().Bool("view", false, "open builtin webview")
	cli.CMD.Flags().StringP("world", "w", "", "world state file to load on startup and periodically flush to")
	cli.CMD.Flags().Bool("disable-local-serial", false, "disable discovery of local serial ports")
	cli.CMD.Flags().Bool("allow-netscan", false, "allow scanning the local network for devices")
	cli.CMD.Flags().Bool("no-defaults", false, "do not load builtin default world entities")
	cli.CMD.Flags().StringSlice("allow-path", nil, "allow file access to additional paths (e.g. for TLS certificates)")
	cli.CMD.Flags().StringSlice("plugin", nil, "plugins to run (local .ts/.js files or OCI image refs)")
	cli.CMD.Flags().String("server", "", "proxy to remote server (host:port, ssh://user@host, or ssh://host)")
	cli.CMD.Flags().String("wireguard", "", "path to WireGuard config (use with --server host:port)")
	cli.CMD.Flags().String("advertise-url", "", "externally-reachable base URL for this node, shown in the startup banner")
	cli.CMD.Flags().Bool("disable-all-security-i-know-what-i-am-doing", false, "disable the policy engine entirely")

	cli.CMD.RunE = func(cmd *cobra.Command, args []string) error {
		all, _ := cmd.Flags().GetBool("all")
		enableView, _ := cmd.Flags().GetBool("view")

		remoteServer, _ := cmd.Flags().GetString("server")
		if remoteServer != "" {
			wgConfig, _ := cmd.Flags().GetString("wireguard")
			addr, err := cli.StartProxyServer(remoteServer, wgConfig)
			if err != nil {
				return err
			}
			if all || enableView {
				_ = browser.OpenURL("http://" + addr)
			}
			select {}
		}

		worldFile, _ := cmd.Flags().GetString("world")
		disableSerial, _ := cmd.Flags().GetBool("disable-local-serial")
		allowNetscan, _ := cmd.Flags().GetBool("allow-netscan")
		noDefaults, _ := cmd.Flags().GetBool("no-defaults")
		allowPaths, _ := cmd.Flags().GetStringSlice("allow-path")
		plugins, _ := cmd.Flags().GetStringSlice("plugin")
		disableSecurity, _ := cmd.Flags().GetBool("disable-all-security-i-know-what-i-am-doing")
		advertiseURL, _ := cmd.Flags().GetString("advertise-url")

		ctx := context.Background()

		serverAddr, err := engine.StartEngine(ctx, engine.EngineConfig{
			WorldFile:       worldFile,
			NoDefaults:      noDefaults,
			DisableSecurity: disableSecurity,
			LogRing:         logging.Ring,
			AdvertiseURL:    advertiseURL,
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}

		builtin.LocalPermissions.DisableLocalSerial = disableSerial
		builtin.LocalPermissions.AllowNetscan = allowNetscan
		builtin.LocalPermissions.AllowedPaths = allowPaths
		builtin.StartAll(ctx, serverAddr)

		// Launch each plugin as a supervised subprocess for isolation.
		for _, p := range plugins {
			go runPluginSubprocess(p, serverAddr)
		}

		if all || enableView {
			_ = browser.OpenURL("http://" + serverAddr)
		}

		select {}
	}
}

// runPluginSubprocess runs a plugin as a child process using
// "hydris plugin run". Handles both local files and OCI refs.
// Restarts automatically on crash with 1s backoff.
func runPluginSubprocess(plugin, serverAddr string) {
	for {
		slog.Info("starting plugin subprocess", "plugin", plugin)
		cmd := exec.Command(os.Args[0], "plugin", "run", "--server", "http://"+serverAddr, plugin)
		executil.HideWindow(cmd)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			slog.Error("plugin subprocess crashed, restarting in 1s", "plugin", plugin, "error", err)
		} else {
			slog.Info("plugin subprocess exited, restarting in 1s", "plugin", plugin)
		}
		time.Sleep(time.Second)
	}
}

func main() {
	if err := cli.CMD.Execute(); err != nil {
		os.Exit(1)
	}
}
