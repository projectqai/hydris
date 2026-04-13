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
