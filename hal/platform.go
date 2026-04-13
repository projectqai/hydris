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
}

// P is the active platform implementation. Set by platform-specific init().
var P Platform
