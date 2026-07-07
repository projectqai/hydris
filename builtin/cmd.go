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
	"google.golang.org/grpc/credentials"
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
var registeredPatterns = make(map[string]bool)

// Handle registers an HTTP handler on the shared builtin mux.
// Duplicate patterns on the same mux are silently ignored so builtins
// can call this unconditionally on every restart.
func Handle(pattern string, handler http.Handler) {
	sharedMux.Lock()
	defer sharedMux.Unlock()
	if registeredPatterns[pattern] {
		return
	}
	currentMux.Handle(pattern, handler)
	registeredPatterns[pattern] = true
}

// HandleFunc registers an HTTP handler function on the shared builtin mux.
// Duplicate patterns on the same mux are silently ignored.
func HandleFunc(pattern string, handler http.HandlerFunc) {
	sharedMux.Lock()
	defer sharedMux.Unlock()
	if registeredPatterns[pattern] {
		return
	}
	currentMux.HandleFunc(pattern, handler)
	registeredPatterns[pattern] = true
}

// PluginHandle mounts handler under /plugin/<name>/<pattern>.
// Each builtin owns the /plugin/<name>/ namespace; pick stable sub-paths.
// Pattern may include go 1.22+ method/wildcard syntax (e.g. "GET /cam/{id}").
func PluginHandle(name, pattern string, handler http.Handler) {
	Handle(pluginPattern(name, pattern), handler)
}

// PluginHandleFunc is the func variant of PluginHandle.
func PluginHandleFunc(name, pattern string, handler http.HandlerFunc) {
	HandleFunc(pluginPattern(name, pattern), handler)
}

// PluginPath returns the canonical /plugin/<name>/<rest> URL path.
func PluginPath(name, rest string) string {
	return "/plugin/" + name + "/" + strings.TrimPrefix(rest, "/")
}

func pluginPattern(name, pattern string) string {
	method, rest, hasMethod := strings.Cut(pattern, " ")
	if !hasMethod {
		method, rest = "", pattern
	}
	full := "/plugin/" + name + "/" + strings.TrimPrefix(rest, "/")
	if method != "" {
		return method + " " + full
	}
	return full
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
	registeredPatterns = make(map[string]bool)
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

// builtinCreds injects the builtin name as per-RPC metadata so the engine
// can identify which builtin is making each call. A builtin may also declare
// the actor identity its calls should be attributed to; the engine trusts it
// verbatim because the bufconn is in-process (see engine authContext).
type builtinCreds struct {
	name  string
	actor string
	node  string
}

func (b builtinCreds) GetRequestMetadata(_ context.Context, _ ...string) (map[string]string, error) {
	md := map[string]string{"x-builtin-name": b.name}
	if b.actor != "" {
		md["x-builtin-actor"] = b.actor
	}
	if b.node != "" {
		md["x-federation-node"] = b.node
	}
	return md, nil
}

func (b builtinCreds) RequireTransportSecurity() bool { return false }

var _ credentials.PerRPCCredentials = builtinCreds{}

func BuiltinClientConn(name string) (*grpc.ClientConn, error) {
	return newBuiltinConn(builtinCreds{name: name})
}

// BuiltinClientConnAs is like BuiltinClientConn but attributes the builtin's
// calls to the given actor identity. Use this for builtins (e.g. federation)
// that must not be evaluated as trusted in-process callers.
func BuiltinClientConnAs(name, actor string) (*grpc.ClientConn, error) {
	return newBuiltinConn(builtinCreds{name: name, actor: actor})
}

// BuiltinClientConnForNode is like BuiltinClientConnAs but also declares the
// remote node the connection relays on behalf of. The engine exposes it to
// policy as source.node so federation can be constrained to that node.
func BuiltinClientConnForNode(name, actor, node string) (*grpc.ClientConn, error) {
	return newBuiltinConn(builtinCreds{name: name, actor: actor, node: node})
}

func newBuiltinConn(creds builtinCreds) (*grpc.ClientConn, error) {
	return grpc.NewClient(
		"passthrough:///bufconn",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		BuiltinDialer(),
		grpc.WithPerRPCCredentials(creds),
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
