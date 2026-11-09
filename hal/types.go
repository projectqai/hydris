package hal

import "io"

// BLEConnection exposes GATT semantics for BLE devices.
type BLEConnection interface {
	WriteCharacteristic(uuid string, data []byte) error
	ReadCharacteristic(uuid string) ([]byte, error)
	Subscribe(uuid string) (<-chan []byte, error)
	Unsubscribe(uuid string) error
	Disconnected() <-chan struct{}
	io.Closer
}

// SerialPort describes a discovered serial port.
type SerialPort struct {
	// Key is the platform-provided stable identifier for this device.
	// When set, it is used as the entity key instead of deriving one
	// from VendorID/SerialNumber/Name. The platform should set this
	// to whatever identifier remains constant across permission
	// changes and USB re-enumeration.
	Key              string
	Path             string
	StablePath       string
	Name             string
	VendorID         uint32
	ProductID        uint32
	SerialNumber     string
	ManufacturerName string
	ProductName      string
}

// BLEDevice describes a discovered BLE peripheral.
type BLEDevice struct {
	Address      string
	Name         string
	ServiceUUIDs []string
	RSSI         int
}

// GATTService describes a discovered GATT service.
type GATTService struct {
	UUID                string
	CharacteristicUUIDs []string
}

// MDNSPeer describes a DNS-SD service instance discovered via mDNS.
type MDNSPeer struct {
	Instance string            // service instance name (unique per node)
	Hostname string            // advertised host name
	Addrs    []string          // IP addresses, most recently announced first
	Port     int               // service port from the SRV record
	Txt      map[string]string // TXT record key/value pairs
}

// CameraDevice describes a discovered camera.
type CameraDevice struct {
	ID     string
	Name   string
	Facing string
}

// SensorReading is a single sensor measurement from the local hardware.
// Kind and Unit values correspond to the MetricKind / MetricUnit proto enums.
type SensorReading struct {
	ID    uint32
	Label string
	Kind  int32
	Unit  int32
	Value float64
}

// JoystickDevice describes a connected joystick or gamepad.
type JoystickDevice struct {
	// ID stays the same when the device is unplugged and plugged back in,
	// as far as the platform can tell devices apart.
	ID        string
	Name      string
	VendorID  uint32
	ProductID uint32
	Axes      int
	Buttons   int
}

// JoystickState is what a joystick reports right now. Axes run from -1 to 1,
// with up and left negative. Backends report common gamepads in the same layout:
// axes 0/1 left stick, 2 left trigger, 3/4 right stick, 5 right trigger, 6/7 dpad;
// buttons 0-3 A B X Y, 4/5 shoulders, 6 back, 7 start.
type JoystickState struct {
	Axes    []float32
	Buttons []bool
}
