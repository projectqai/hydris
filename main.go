package main

import (
	"context"
	"fmt"
	"os"

	_ "github.com/projectqai/hydris/logging"

	"github.com/projectqai/hydris/cmd"

	"github.com/projectqai/hydris/builtin"
	_ "github.com/projectqai/hydris/builtin/adsbdb"
	_ "github.com/projectqai/hydris/builtin/adsblol"
	_ "github.com/projectqai/hydris/builtin/ais"
	_ "github.com/projectqai/hydris/builtin/asterix"
	_ "github.com/projectqai/hydris/builtin/federation"
	_ "github.com/projectqai/hydris/builtin/hexdb"
	_ "github.com/projectqai/hydris/builtin/meshtastic"
	_ "github.com/projectqai/hydris/builtin/serial"
	_ "github.com/projectqai/hydris/builtin/spacetrack"
	_ "github.com/projectqai/hydris/builtin/tak"
	_ "github.com/projectqai/hydris/cli"
	"github.com/projectqai/hydris/engine"
	_ "github.com/projectqai/hydris/view"
	"github.com/spf13/cobra"

	"github.com/pkg/browser"
)

func init() {
	cmd.CMD.Flags().Bool("view", false, "open builtin webview")
	cmd.CMD.Flags().StringP("world", "w", "", "world state file to load on startup and periodically flush to")
	cmd.CMD.Flags().String("policy", "", "path to OPA policy file (.rego) for access control")
	cmd.CMD.Flags().Bool("allow-local-serial", false, "allow discovery of local serial ports")
	cmd.CMD.Flags().Bool("no-defaults", false, "do not load builtin default world entities")

	cmd.CMD.RunE = func(cmd *cobra.Command, args []string) error {
		all, _ := cmd.Flags().GetBool("all")
		enableView, _ := cmd.Flags().GetBool("view")
		worldFile, _ := cmd.Flags().GetString("world")
		policyFile, _ := cmd.Flags().GetString("policy")
		allowSerial, _ := cmd.Flags().GetBool("allow-local-serial")
		noDefaults, _ := cmd.Flags().GetBool("no-defaults")

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

		builtin.LocalPermissions.AllowLocalSerial = allowSerial
		builtin.StartAll(ctx, serverAddr)

		if all || enableView {
			_ = browser.OpenURL("http://" + serverAddr)
		}

		select {}
	}
}

func main() {
	err := cmd.CMD.Execute()
	if err != nil {
		panic(err)
	}
}
