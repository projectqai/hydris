package cli

import (
	"fmt"

	"github.com/joho/godotenv"
	"github.com/projectqai/hydris/goclient"
	"github.com/spf13/cobra"
)

var CMD = &cobra.Command{
	Use:   "hydris",
	Short: "world state machine",
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		_ = godotenv.Load()
		return nil
	},
}

var (
	conn         *goclient.Connection
	serverURL    string
	wgConfigPath string
)

func AddConnectionFlags(cmd *cobra.Command) {
	cmd.PersistentFlags().StringVar(&serverURL, "server", "localhost:50051", "server address (host:port, ssh://user@host, http(s)://...)")
	cmd.PersistentFlags().StringVar(&wgConfigPath, "wireguard", "", "path to WireGuard config to reach the server")
}

func connect(cmd *cobra.Command, args []string) error {
	var err error
	conn, err = goclient.ConnectURL(serverURL, wgConfigPath)
	if err != nil {
		return fmt.Errorf("failed to connect to server: %w", err)
	}
	return nil
}
