package hydris

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"path/filepath"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/artifacts"
	_ "github.com/projectqai/hydris/builtin/all"
	"github.com/projectqai/hydris/engine"
	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/hydris/hal"
	"github.com/projectqai/hydris/pkg/media"
	"github.com/projectqai/hydris/pkg/plugin"
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
		plugin.TempDir = cacheDir
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

	// Load builtin defaults with old timestamp so they never overwrite real data
	if err := service.engine.LoadDefaults(builtin.DefaultWorld()); err != nil {
		slog.Error("failed to load default world", "error", err)
	}

	service.engine.InitNodeIdentity()

	// Set up artifact storage.
	artDir := filepath.Join(filepath.Dir(worldFile), "artifacts")
	artLocal, err := artifacts.NewLocalStore(artDir)
	if err != nil {
		slog.Error("failed to create artifact store", "error", err)
	} else {
		grpcConn, err := builtin.BuiltinClientConn()
		if err != nil {
			slog.Error("failed to create builtin client for artifacts", "error", err)
		} else {
			worldClient := pb.NewWorldServiceClient(grpcConn)
			artifacts.Server = artifacts.NewArtifactServer(artLocal, worldClient)
		}
	}

	bridges := media.NewBridgeManager()
	mux := engine.NewAPIMux(service.engine, nil, bridges, &Ring)

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

// PlatformBLE is implemented by Kotlin for BLE hardware access.
type PlatformBLE interface {
	StartScan()
	StopScan()
	Connect(address string) (int64, error)
	Disconnect(handle int64) error
	ReadCharacteristic(handle int64, charUUID string) ([]byte, error)
	WriteCharacteristic(handle int64, charUUID string, data []byte) error
	Subscribe(handle int64, charUUID string) error
	Unsubscribe(handle int64, charUUID string) error
}

// PlatformSerial is implemented by Kotlin for serial hardware access.
type PlatformSerial interface {
	Open(path string, baudRate int) (int64, error)
	Read(handle int64, maxLen int) ([]byte, error)
	Write(handle int64, data []byte) (int, error)
	Close(handle int64) error
	StartDiscovery()
	StopDiscovery()
}

// PlatformSensors is implemented by Kotlin for reading device sensors.
type PlatformSensors interface {
	// ReadSensors returns a JSON-encoded []SensorReading snapshot.
	ReadSensors() string
}

// HalHandler receives events from Kotlin platform code.
type HalHandler interface {
	OnSerialPorts(json string)
	OnBLEDevices(json string)
	OnBLENotification(handle int64, charUUID string, data []byte)
	OnBLEDisconnect(handle int64)
}

// SetHalPlatform registers the Kotlin hardware implementations.
// Call before StartEngine.
func SetHalPlatform(ble PlatformBLE, serial PlatformSerial, sensors PlatformSensors) {
	if ble != nil {
		hal.SetBLEWatch(ble.StartScan, ble.StopScan)
		hal.SetBLEOps(ble.Connect, ble.Disconnect, ble.ReadCharacteristic, ble.WriteCharacteristic, ble.Subscribe, ble.Unsubscribe)
	}
	if serial != nil {
		hal.SetSerialWatch(serial.StartDiscovery, serial.StopDiscovery)
		hal.SetSerialOps(serial.Open, serial.Read, serial.Write, serial.Close)
	}
	if sensors != nil {
		hal.SetSensors(sensors.ReadSensors)
	}
}

// GetHalHandler returns the Go-side handler that Kotlin calls for events.
func GetHalHandler() HalHandler {
	return hal.GetHandler()
}

