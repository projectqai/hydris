package hal

// Platform defines the set of hardware access functions provided by each OS.
// Each platform (native, darwin/purego, android/gomobile) fills in this struct.
// Functions left nil are treated as unsupported on that platform.
type Platform struct {
	// Serial discovery. Callback receives JSON-encoded []SerialPort snapshots.
	// Returns a stop function.
	SerialWatch func(cb func(ports []SerialPort)) (stop func())

	// Serial I/O. Handle-based: Open returns a handle, Read/Write/Close use it.
	SerialOpen func(path string, baudRate int) (handle int64, err error)
	// SerialRead returns up to maxLen bytes. Some platforms (Android) may
	// return more than maxLen; the caller (serialHandle) buffers the excess.
	SerialRead  func(handle int64, maxLen int) ([]byte, error)
	SerialWrite func(handle int64, data []byte) (int, error)
	SerialClose func(handle int64) error

	// BLE discovery. Callback receives periodic snapshots of visible devices.
	BLEWatch func(serviceUUIDs []string, cb func(devices []BLEDevice)) (stop func())

	// BLE connection. Handle-based.
	BLEConnect     func(address string) (handle int64, err error)
	BLEDisconnect  func(handle int64) error
	BLERead        func(handle int64, charUUID string) ([]byte, error)
	BLEWrite       func(handle int64, charUUID string, data []byte) error
	BLESubscribe   func(handle int64, charUUID string, cb func(data []byte)) error
	BLEUnsubscribe func(handle int64, charUUID string) error

	// BLE service discovery (called after Connect, returns discovered services).
	BLEServices func(handle int64) ([]GATTService, error)

	// BLE disconnect notification. Registers a callback that fires when
	// a connected peripheral disconnects unexpectedly (remote-initiated).
	BLEOnDisconnect func(handle int64, cb func())

	// ReadSensors returns a snapshot of all available no-permission sensors.
	ReadSensors func() []SensorReading

	// MDNSAdvertise announces a DNS-SD service instance (e.g. "_hydris._tcp");
	// txt entries are published as key=value TXT records.
	MDNSAdvertise func(instance, service string, port int, txt map[string]string) (stop func(), err error)

	// MDNSBrowse discovers a DNS-SD service type; the callback receives full
	// snapshots of currently visible peers.
	MDNSBrowse func(service string, cb func(peers []MDNSPeer)) (stop func(), err error)

	// Joystick discovery. The callback receives full snapshots when the set of
	// connected devices changes.
	JoystickWatch func(cb func(devices []JoystickDevice)) (stop func())

	// Joystick access. Handle-based. Read returns the latest state without
	// blocking, and an error once the device is gone.
	JoystickOpen  func(id string) (handle int64, err error)
	JoystickRead  func(handle int64) (JoystickState, error)
	JoystickClose func(handle int64) error

	// MainThread takes over the main thread and never returns. Set on platforms
	// where a framework needs it, see RunMain.
	MainThread func()
}

// P is the active platform implementation. Set by platform-specific init().
var P Platform
