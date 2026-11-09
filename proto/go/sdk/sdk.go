// Package sdk is the Go SDK for hydris plugins. A native plugin is an
// executable that hydris starts (see hydris.native in package.json); this
// package connects it back to hydris and runs it:
//
//	func main() { sdk.Main(run) }
//
// Hydris starts the plugin with HYDRIS_SERVER (http://host:port, plaintext
// HTTP/2) and HYDRIS_TOKEN (sent as a bearer token on every call), plus
// HYDRIS_PLUGIN_ID and HYDRIS_DATA_DIR. Its stdin stays open while it should
// run. Logs go to stderr as JSON lines, which hydris logs under the plugin's
// name.
package sdk

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ErrConflict, wrapped into an error a RunFunc returns, sets the entity to
// Conflict and stops retries until its config changes: the failure is
// permanent for this config, not transient.
var ErrConflict = errors.New("conflict")

// Main runs fn as the plugin and exits. ctx ends on SIGINT/SIGTERM and when
// hydris closes stdin, which it does to stop the plugin and which happens by
// itself if hydris dies.
func Main(fn func(ctx context.Context, logger *slog.Logger) error) {
	if _, err := target(); err != nil {
		fmt.Fprintln(os.Stderr, "HYDRIS_SERVER:", err)
		os.Exit(2)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level:       slog.LevelDebug,
		ReplaceAttr: stringers,
	}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		stop()
	}()

	err := fn(ctx, logger)
	stopping := ctx.Err() != nil
	stop()
	if err != nil && !stopping {
		logger.Error("plugin failed", "error", err)
		os.Exit(1)
	}
	os.Exit(0)
}

// Dial connects to hydris. The caller closes the connection.
func Dial() (*grpc.ClientConn, error) {
	t, err := target()
	if err != nil {
		return nil, err
	}
	return grpc.NewClient("passthrough:///"+t,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithPerRPCCredentials(bearer(os.Getenv("HYDRIS_TOKEN"))))
}

// target is HYDRIS_SERVER as a gRPC target. The connection is plaintext, so
// any scheme but http:// is an error rather than a silent downgrade.
func target() (string, error) {
	server := os.Getenv("HYDRIS_SERVER")
	if server == "" {
		return "", errors.New("not set: this is a hydris plugin, install it in hydris")
	}
	t := strings.TrimPrefix(server, "http://")
	if strings.Contains(t, "://") {
		return "", fmt.Errorf("%q: only http:// is supported", server)
	}
	if t == "" {
		return "", fmt.Errorf("%q: no host:port", server)
	}
	return t, nil
}

type bearer string

func (b bearer) GetRequestMetadata(context.Context, ...string) (map[string]string, error) {
	if b == "" {
		return nil, nil
	}
	return map[string]string{"authorization": "Bearer " + string(b)}, nil
}

func (bearer) RequireTransportSecurity() bool { return false }

// stringers logs values with a String method (addresses, ids) as that string,
// the way a text handler shows them, instead of as their JSON struct.
func stringers(_ []string, a slog.Attr) slog.Attr {
	if a.Value.Kind() == slog.KindAny {
		if _, isErr := a.Value.Any().(error); !isErr {
			if s, ok := a.Value.Any().(fmt.Stringer); ok {
				a.Value = slog.StringValue(s.String())
			}
		}
	}
	return a
}
