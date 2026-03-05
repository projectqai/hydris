package main

import (
	"context"
	"fmt"
	"os"

	_ "github.com/projectqai/hydris/pkg/logging"

	"github.com/projectqai/hydris/builtin"
	_ "github.com/projectqai/hydris/builtin/adsbdb"
	_ "github.com/projectqai/hydris/builtin/adsblol"
	_ "github.com/projectqai/hydris/builtin/ais"
	_ "github.com/projectqai/hydris/builtin/asterix"
	_ "github.com/projectqai/hydris/builtin/federation"
	_ "github.com/projectqai/hydris/builtin/hexdb"
	_ "github.com/projectqai/hydris/builtin/mavlink"
	_ "github.com/projectqai/hydris/builtin/meshtastic"
	_ "github.com/projectqai/hydris/builtin/netscan"
	_ "github.com/projectqai/hydris/builtin/playground"
	_ "github.com/projectqai/hydris/builtin/reolink"
	_ "github.com/projectqai/hydris/builtin/serial"
	_ "github.com/projectqai/hydris/builtin/spacetrack"
	_ "github.com/projectqai/hydris/builtin/tak"
	"github.com/projectqai/hydris/cli"
	"github.com/projectqai/hydris/engine"
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

	cli.CMD.RunE = func(cmd *cobra.Command, args []string) error {
		all, _ := cmd.Flags().GetBool("all")
		enableView, _ := cmd.Flags().GetBool("view")
		worldFile, _ := cmd.Flags().GetString("world")
		policyFile, _ := cmd.Flags().GetString("policy")
		disableSerial, _ := cmd.Flags().GetBool("disable-local-serial")
		allowNetscan, _ := cmd.Flags().GetBool("allow-netscan")
		noDefaults, _ := cmd.Flags().GetBool("no-defaults")
		allowPaths, _ := cmd.Flags().GetStringSlice("allow-path")

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

		if all || enableView {
			_ = browser.OpenURL("http://" + serverAddr)
		}

		select {}
	}
}

func main() {
	err := cli.CMD.Execute()
	if err != nil {
		panic(err)
	}
}
