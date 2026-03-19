package builtin

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

var ServerURL string = "localhost:50051"

// Permissions controls which local resources builtins are allowed to access.
// Set before calling StartAll.
type Permissions struct {
	DisableLocalSerial bool
	AllowNetscan       bool
	AllowedPaths       []string
}

// ValidatePath checks that the given file path is under the current working
// directory or one of the explicitly allowed paths (--allow-path).
func ValidatePath(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve path %q: %w", path, err)
	}
	abs = filepath.Clean(abs)

	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("get working directory: %w", err)
	}

	allowed := append([]string{cwd}, LocalPermissions.AllowedPaths...)
	for _, dir := range allowed {
		dir, err = filepath.Abs(dir)
		if err != nil {
			continue
		}
		dir = filepath.Clean(dir)
		if abs == dir || strings.HasPrefix(abs, dir+string(filepath.Separator)) {
			return nil
		}
	}

	parent := filepath.Dir(abs)
	return fmt.Errorf("path %q is not allowed; add --allow-path=%s to hydris startup", path, parent)
}

var LocalPermissions Permissions

// sharedMux is an HTTP mux that builtins can register handlers on.
// The engine mounts this mux so that builtin HTTP endpoints are served
// on the main engine port without needing separate listeners.
var sharedMux sync.Mutex
var currentMux = http.NewServeMux()

// Handle registers an HTTP handler on the shared builtin mux.
func Handle(pattern string, handler http.Handler) {
	sharedMux.Lock()
	defer sharedMux.Unlock()
	currentMux.Handle(pattern, handler)
}

// HandleFunc registers an HTTP handler function on the shared builtin mux.
func HandleFunc(pattern string, handler http.HandlerFunc) {
	sharedMux.Lock()
	defer sharedMux.Unlock()
	currentMux.HandleFunc(pattern, handler)
}

// HTTPHandler returns a handler that delegates to the current shared mux.
// The indirection allows ResetHTTPHandlers to swap the underlying mux.
func HTTPHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sharedMux.Lock()
		mux := currentMux
		sharedMux.Unlock()
		mux.ServeHTTP(w, r)
	})
}

// ResetHTTPHandlers replaces the shared mux so that restarting builtins
// can re-register their HTTP routes without conflicting with old patterns.
func ResetHTTPHandlers() {
	sharedMux.Lock()
	defer sharedMux.Unlock()
	currentMux = http.NewServeMux()
}

const bufSize = 1024 * 1024

var (
	builtinListener *bufconn.Listener
	builtinOnce     sync.Once
)

func GetBuiltinListener() *bufconn.Listener {
	builtinOnce.Do(func() {
		builtinListener = bufconn.Listen(bufSize)
	})
	return builtinListener
}

func BuiltinDialer() grpc.DialOption {
	return grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
		return GetBuiltinListener().DialContext(ctx)
	})
}

func BuiltinClientConn() (*grpc.ClientConn, error) {
	return grpc.NewClient(
		"passthrough:///bufconn",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		BuiltinDialer(),
	)
}

type Builtin struct {
	Name string
	Run  func(ctx context.Context, logger *slog.Logger, serverURL string) error
}

var builtins []Builtin

func Register(name string, run func(ctx context.Context, logger *slog.Logger, serverURL string) error) {
	builtins = append(builtins, Builtin{
		Name: name,
		Run:  run,
	})
}

var (
	builtinCancel context.CancelFunc
	builtinMu     sync.Mutex
	builtinParent context.Context
	builtinServer string
)

func StartAll(ctx context.Context, serverURL string) {
	builtinMu.Lock()
	builtinParent = ctx
	builtinServer = serverURL
	builtinMu.Unlock()

	startAllInternal(ctx, serverURL)
}

// RestartAll cancels all running builtins and starts them again.
func RestartAll() {
	builtinMu.Lock()
	cancel := builtinCancel
	parent := builtinParent
	serverURL := builtinServer
	builtinMu.Unlock()

	if cancel != nil {
		cancel()
	}

	// Give goroutines a moment to exit.
	time.Sleep(100 * time.Millisecond)

	startAllInternal(parent, serverURL)
}

func startAllInternal(parent context.Context, serverURL string) {
	ctx, cancel := context.WithCancel(parent)
	builtinMu.Lock()
	builtinCancel = cancel
	builtinMu.Unlock()

	for _, b := range builtins {
		builtin := b // capture loop variable
		go func() {
			// Create a logger with module prefix for this builtin
			logger := slog.Default().With("module", builtin.Name)

			for {
				select {
				case <-ctx.Done():
					return
				default:
				}

				err := builtin.Run(ctx, logger, serverURL)

				if ctx.Err() != nil {
					return
				}

				logger.Error("Crashed, restarting in 1 second", "error", err)

				select {
				case <-ctx.Done():
					return
				case <-time.After(1 * time.Second):
					// Continue to restart
				}
			}
		}()
	}
}
