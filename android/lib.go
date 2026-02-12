package hydris

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	_goconnect "github.com/projectqai/proto/go/_goconnect"

	"github.com/projectqai/hydris/builtin"
	_ "github.com/projectqai/hydris/builtin/adsbdb"
	_ "github.com/projectqai/hydris/builtin/adsblol"
	_ "github.com/projectqai/hydris/builtin/ais"
	_ "github.com/projectqai/hydris/builtin/asterix"
	_ "github.com/projectqai/hydris/builtin/federation"
	_ "github.com/projectqai/hydris/builtin/hexdb"
	meshtastic "github.com/projectqai/hydris/builtin/meshtastic"
	_ "github.com/projectqai/hydris/builtin/spacetrack"
	_ "github.com/projectqai/hydris/builtin/tak"
	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/view"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

const (
	listenAddr = ":50051"
	serverAddr = "localhost:50051"
)

type EngineService struct {
	server        *http.Server
	builtinServer *http.Server
	engine        *engine.WorldServer
	ctx           context.Context
	cancelFunc    context.CancelFunc
	mu            sync.Mutex
}

var globalService *EngineService

// getAndroidCacheDir returns the app's cache directory
func getAndroidCacheDir() string {
	// Try standard Go approach first
	if dir, err := os.UserCacheDir(); err == nil && dir != "" {
		slog.Info("using UserCacheDir", "path", dir)
		return dir
	}

	// Fall back to reading package name from /proc/self/cmdline
	data, err := os.ReadFile("/proc/self/cmdline")
	if err != nil {
		slog.Warn("failed to read cmdline", "error", err)
		return ""
	}
	// cmdline contains the package name as null-terminated string
	packageName := string(data)
	if idx := strings.IndexByte(packageName, 0); idx > 0 {
		packageName = packageName[:idx]
	}
	if packageName == "" {
		return ""
	}
	dir := "/data/data/" + packageName + "/cache"
	slog.Info("using cmdline-derived cache dir", "path", dir)
	return dir
}

func StartEngine() string {
	worldFile := ""
	if cacheDir := getAndroidCacheDir(); cacheDir != "" {
		worldFile = cacheDir + "/world.yaml"
	}
	slog.Info("StartEngine called", "worldFile", worldFile)
	if globalService != nil {
		slog.Warn("engine already running")
		return "Error: engine already running"
	}

	ctx, cancel := context.WithCancel(context.Background())
	service := &EngineService{
		ctx:        ctx,
		cancelFunc: cancel,
	}

	service.engine = engine.NewWorldServer()

	// Set up persistence if world file is specified
	if worldFile != "" {
		service.engine.SetWorldFile(worldFile)

		// Load existing state from file
		if err := service.engine.LoadFromFile(worldFile); err != nil {
			slog.Error("failed to load world file", "error", err)
			// Continue anyway - file might not exist yet
		}

		// Start periodic flushing (every 10 seconds)
		service.engine.StartPeriodicFlush(10 * time.Second)
		slog.Info("persistence enabled", "worldFile", worldFile)
	}

	// Load builtin defaults if no entities were loaded
	if service.engine.EntityCount() == 0 {
		if err := service.engine.LoadFromBytes(builtin.DefaultWorld); err != nil {
			slog.Error("failed to load default world", "error", err)
		}
	}

	service.engine.InitNodeIdentity()

	mux := http.NewServeMux()

	worldPath, worldHandler := _goconnect.NewWorldServiceHandler(service.engine)
	mux.Handle(worldPath, worldHandler)

	timelinePath, timelineHandler := _goconnect.NewTimelineServiceHandler(service.engine)
	mux.Handle(timelinePath, timelineHandler)

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("OK"))
	})

	webServer, err := view.NewWebServer()
	if err == nil {
		mux.Handle("/", webServer)
	}

	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	service.server = &http.Server{
		Addr:    listenAddr,
		Handler: h2c.NewHandler(corsHandler.Handler(mux), &http2.Server{}),
	}

	go func() {
		slog.Info("starting engine server", "addr", listenAddr)
		if err := service.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("engine server error", "error", err)
		}
	}()

	// Start in-process server for builtin services (uses bufconn)
	service.builtinServer = &http.Server{
		Handler: h2c.NewHandler(mux, &http2.Server{}),
	}
	go func() {
		slog.Info("starting builtin server")
		if err := service.builtinServer.Serve(builtin.GetBuiltinListener()); err != nil && err != http.ErrServerClosed {
			slog.Error("builtin server error", "error", err)
		}
	}()

	time.Sleep(100 * time.Millisecond)
	globalService = service

	// Start all builtin controllers
	// Note: most builtins use bufconn (BuiltinClientConn), but tak/federation use TCP to serverAddr
	builtin.StartAll(ctx, serverAddr)
	slog.Info("builtins started")

	return "Engine started on " + listenAddr
}

func StopEngine() string {
	slog.Info("StopEngine called")
	if globalService == nil {
		slog.Warn("engine not running")
		return "Error: engine not running"
	}

	// Flush world state before stopping
	if err := globalService.engine.FlushToFile(); err != nil {
		slog.Error("failed to flush world state on shutdown", "error", err)
	} else {
		slog.Info("world state flushed")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := globalService.server.Shutdown(ctx); err != nil {
		slog.Error("error stopping main server", "error", err)
	}
	if globalService.builtinServer != nil {
		if err := globalService.builtinServer.Shutdown(ctx); err != nil {
			slog.Error("error stopping builtin server", "error", err)
		}
	}

	globalService.cancelFunc()
	globalService = nil

	return "Engine stopped"
}

func IsEngineRunning() bool {
	return globalService != nil
}

func GetEngineStatus() string {
	if globalService == nil {
		return "stopped"
	}
	return "running on " + listenAddr
}

// FlushWorldState manually flushes the world state to the persistence file.
// Returns an error message if flush fails, empty string on success.
func FlushWorldState() string {
	if globalService == nil {
		return "Error: engine not running"
	}
	if err := globalService.engine.FlushToFile(); err != nil {
		slog.Error("failed to flush world state", "error", err)
		return "Error: " + err.Error()
	}
	slog.Info("world state flushed manually")
	return ""
}

// SerialWriter is implemented by Kotlin to write bytes to a USB device.
// Defined here (not in meshtastic package) so gomobile exports it.
type SerialWriter interface {
	Write(data []byte) (int, error)
}

// DeviceOpener is implemented by Kotlin. Go calls RequestDevice when a config
// entity needs a USB serial device opened.
// Defined here (not in meshtastic package) so gomobile exports it.
type DeviceOpener interface {
	RequestDevice(deviceFilter string)
}

// SetMeshtasticDeviceOpener registers the Kotlin callback that Go calls when
// a config entity needs a USB device opened. Must be called before StartEngine.
func SetMeshtasticDeviceOpener(opener DeviceOpener) {
	meshtastic.SetDeviceOpener(opener)
}

// ConnectMeshtasticDevice is called by Kotlin after opening a USB device
// in response to a DeviceOpener.RequestDevice call.
func ConnectMeshtasticDevice(deviceName string, writer SerialWriter) {
	meshtastic.ConnectDevice(deviceName, writer)
}

// UpdateUsbDeviceList is called by Kotlin with a JSON array of all current USB
// devices whenever the set changes (attach/detach) or at startup.
func UpdateUsbDeviceList(devicesJSON string) {
	meshtastic.UpdateDeviceList(devicesJSON)
}

// DisconnectMeshtasticDevice is called when a USB device is removed.
func DisconnectMeshtasticDevice(deviceName string) {
	meshtastic.DisconnectDevice(deviceName)
}

// OnMeshtasticDeviceData is called by Kotlin's read thread when bytes arrive
// from a specific USB device.
func OnMeshtasticDeviceData(deviceName string, data []byte) {
	meshtastic.OnDeviceData(deviceName, data)
}