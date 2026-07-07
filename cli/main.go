package cli

import (
	"crypto/tls"
	"fmt"
	"os"
	"path/filepath"
	"strings"

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
	certPath     string
)

func AddConnectionFlags(cmd *cobra.Command) {
	cmd.PersistentFlags().StringVar(&serverURL, "server", "localhost:50051", "server address (host:port, ssh://user@host, http(s)://...)")
	cmd.PersistentFlags().StringVar(&wgConfigPath, "wireguard", "", "path to WireGuard config to reach the server")
	cmd.PersistentFlags().StringVar(&certPath, "cert", "", "mTLS client certificate PEM (cert+key); defaults to the local node certificate if present")
}

func connect(cmd *cobra.Command, args []string) error {
	var opts []goclient.ConnectOption
	cert, err := loadClientCert()
	if err != nil {
		return err
	}
	if cert != nil {
		opts = append(opts, goclient.WithClientCert(*cert))
	}
	conn, err = goclient.ConnectURL(cmd.Context(), serverURL, wgConfigPath, opts...)
	if err != nil {
		return fmt.Errorf("failed to connect to server: %w", err)
	}
	return nil
}

// loadClientCert loads the mTLS client certificate from --cert, falling back to
// the node certificate the engine writes next to its world file. A missing
// certificate is only an error when the URL forces TLS (https://) and no node
// certificate is available either — bare host:port falls back to plaintext and
// http:// needs no certificate, so for those a missing cert is fine.
func loadClientCert() (*tls.Certificate, error) {
	var paths []string
	if certPath != "" {
		paths = append(paths, certPath)
	}
	if p := defaultNodeCertPath(); p != "" {
		paths = append(paths, p)
	}
	for _, p := range paths {
		// node-tls.pem holds the certificate and private key together.
		if pem, err := os.ReadFile(p); err == nil {
			if cert, err := tls.X509KeyPair(pem, pem); err == nil {
				return &cert, nil
			}
		}
	}
	if strings.HasPrefix(serverURL, "https://") {
		return nil, fmt.Errorf("no client certificate available for %s: set --cert or run where the node certificate exists", serverURL)
	}
	return nil, nil
}

// defaultNodeCertPath mirrors the engine default: <user-config>/hydris/node-tls.pem.
func defaultNodeCertPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "hydris", "node-tls.pem")
}
