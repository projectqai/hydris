package hydris

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"github.com/projectqai/hydris/builtin"
	_ "github.com/projectqai/hydris/builtin/all"
	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/hal"
	"github.com/projectqai/hydris/pkg/plugin"
)

type EngineService struct {
	engine     *engine.WorldServer
	addr       string
	cancelFunc context.CancelFunc
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
	if globalService != nil {
		slog.Warn("engine already running")
		return "Error: engine already running"
	}
	cacheDir := getAndroidCacheDir()
	if cacheDir == "" {
		return "Error: no cache directory for world state"
	}
	plugin.TempDir = cacheDir
	worldFile := cacheDir + "/world.yaml"
	slog.Info("StartEngine called", "worldFile", worldFile)

	ctx, cancel := context.WithCancel(context.Background())
	ws, addr, err := engine.StartEngineServer(ctx, engine.EngineConfig{
		WorldFile: worldFile,
		LogRing:   &Ring,
	})
	if err != nil {
		cancel()
		slog.Error("failed to start engine", "error", err)
		return "Error: " + err.Error()
	}
	globalService = &EngineService{engine: ws, addr: addr, cancelFunc: cancel}

	builtin.StartAll(ctx, addr)
	slog.Info("builtins started")

	return "Engine started on " + addr
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

	// Cancelling the engine ctx shuts down the listeners and builtins.
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
	return "running on " + globalService.addr
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

// SetDeviceName sets the device name reported as the node's hostname.
// Call before StartEngine: os.Hostname() is "localhost" on Android.
func SetDeviceName(name string) {
	engine.HostnameOverride = strings.TrimSpace(name)
}

// PlatformMDNS is implemented by Kotlin for mDNS/DNS-SD via NsdManager.
type PlatformMDNS interface {
	// Register announces a DNS-SD service instance; txtJSON is a JSON object.
	Register(instance string, serviceType string, port int, txtJSON string)
	Unregister()
	// StartBrowse discovers a service type; snapshots arrive via OnMDNSPeers.
	StartBrowse(serviceType string)
	StopBrowse()
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
	OnMDNSPeers(json string)
	OnBLENotification(handle int64, charUUID string, data []byte)
	OnBLEDisconnect(handle int64)
}

// SetHalPlatform registers the Kotlin hardware implementations.
// Call before StartEngine.
func SetHalPlatform(ble PlatformBLE, serial PlatformSerial, sensors PlatformSensors, mdns PlatformMDNS) {
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
	if mdns != nil {
		hal.SetMDNS(mdns.Register, mdns.Unregister, mdns.StartBrowse, mdns.StopBrowse)
	}
}

// PlatformJoystick is implemented by Kotlin for reading gamepads.
type PlatformJoystick interface {
	// ListJoysticks returns a JSON-encoded []JoystickDevice snapshot.
	ListJoysticks() string
	// ReadJoystick returns a JSON-encoded JoystickState, empty once the device is gone.
	ReadJoystick(id string) string
}

// SetHalJoystick wires gamepad access.
func SetHalJoystick(joystick PlatformJoystick) {
	hal.SetJoystick(joystick.ListJoysticks, joystick.ReadJoystick)
}

// GetHalHandler returns the Go-side handler that Kotlin calls for events.
func GetHalHandler() HalHandler {
	return hal.GetHandler()
}
