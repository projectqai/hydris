package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"time"

	_ "github.com/projectqai/hydris/pkg/logging"

	"github.com/projectqai/hydris/builtin"
	_ "github.com/projectqai/hydris/builtin/all"
	"github.com/projectqai/hydris/cli"
	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/pkg/executil"
	"github.com/projectqai/hydris/pkg/version"
	_ "github.com/projectqai/hydris/view"
	"github.com/spf13/cobra"

	"github.com/pkg/browser"
)

func init() {
	cli.CMD.Flags().Bool("view", false, "open builtin webview")
	cli.CMD.Flags().StringP("world", "w", "", "world state file to load on startup and periodically flush to")
	cli.CMD.Flags().String("policy", "", "path to OPA policy file (.rego) for access control")
	cli.CMD.Flags().Bool("disable-local-serial", false, "disable discovery of local serial ports")
	cli.CMD.Flags().Bool("allow-netscan", false, "allow scanning the local network for devices")
	cli.CMD.Flags().Bool("no-defaults", false, "do not load builtin default world entities")
	cli.CMD.Flags().StringSlice("allow-path", nil, "allow file access to additional paths (e.g. for TLS certificates)")
	cli.CMD.Flags().StringSlice("plugin", nil, "plugins to run (local .ts/.js files or OCI image refs)")

	cli.CMD.RunE = func(cmd *cobra.Command, args []string) error {
		all, _ := cmd.Flags().GetBool("all")
		enableView, _ := cmd.Flags().GetBool("view")
		worldFile, _ := cmd.Flags().GetString("world")
		policyFile, _ := cmd.Flags().GetString("policy")
		disableSerial, _ := cmd.Flags().GetBool("disable-local-serial")
		allowNetscan, _ := cmd.Flags().GetBool("allow-netscan")
		noDefaults, _ := cmd.Flags().GetBool("no-defaults")
		allowPaths, _ := cmd.Flags().GetStringSlice("allow-path")
		plugins, _ := cmd.Flags().GetStringSlice("plugin")

		ctx := context.Background()

		serverAddr, err := engine.StartEngine(ctx, engine.EngineConfig{
			WorldFile:  worldFile,
			PolicyFile: policyFile,
			NoDefaults: noDefaults,
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
	cli.HydrisVersion = version.Version
	if err := cli.CMD.Execute(); err != nil {
		os.Exit(1)
	}
}
