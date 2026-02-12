package devices

import (
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// DeviceInfo describes a discovered device. Subsystem descriptors are optional —
// a USB serial adapter would have both USB and Serial populated.
type DeviceInfo struct {
	Name   string            `json:"name"`
	Label  string            `json:"label,omitempty"`
	USB    *USBDescriptor    `json:"usb,omitempty"`
	Serial *SerialDescriptor `json:"serial,omitempty"`
	IP     *IPDescriptor     `json:"ip,omitempty"`
}

type USBDescriptor struct {
	VendorID         uint32 `json:"vendor_id"`
	ProductID        uint32 `json:"product_id"`
	DeviceClass      uint32 `json:"device_class"`
	DeviceSubclass   uint32 `json:"device_subclass"`
	DeviceProtocol   uint32 `json:"device_protocol"`
	ManufacturerName string `json:"manufacturer_name,omitempty"`
	ProductName      string `json:"product_name,omitempty"`
	SerialNumber     string `json:"serial_number,omitempty"`
}

type SerialDescriptor struct {
	Path     string `json:"path"`
	BaudRate uint32 `json:"baud_rate,omitempty"`
}

type IPDescriptor struct {
	Host string `json:"host"`
	Port uint32 `json:"port,omitempty"`
}

// BuildDeviceEntity creates a pb.Entity with a DeviceComponent from a DeviceInfo.
// The controllerName is set as the entity's Controller.Id.
// The entity ID follows the fleet convention: <controllerName>.device.<nodeEntityID>.<name>.
func BuildDeviceEntity(controllerName string, nodeEntityID string, info DeviceInfo) *pb.Entity {
	dev := &pb.DeviceComponent{}

	if u := info.USB; u != nil {
		dev.Usb = &pb.UsbDevice{
			VendorId:       proto.Uint32(u.VendorID),
			ProductId:      proto.Uint32(u.ProductID),
			DeviceClass:    proto.Uint32(u.DeviceClass),
			DeviceSubclass: proto.Uint32(u.DeviceSubclass),
			DeviceProtocol: proto.Uint32(u.DeviceProtocol),
		}
		if u.ManufacturerName != "" {
			dev.Usb.ManufacturerName = proto.String(u.ManufacturerName)
		}
		if u.ProductName != "" {
			dev.Usb.ProductName = proto.String(u.ProductName)
		}
		if u.SerialNumber != "" {
			dev.Usb.SerialNumber = proto.String(u.SerialNumber)
		}
	}
	if s := info.Serial; s != nil {
		dev.Serial = &pb.SerialDevice{
			Path: proto.String(s.Path),
		}
		if s.BaudRate > 0 {
			dev.Serial.BaudRate = proto.Uint32(s.BaudRate)
		}
	}
	if ip := info.IP; ip != nil {
		dev.Ip = &pb.IpDevice{
			Host: proto.String(ip.Host),
		}
		if ip.Port > 0 {
			dev.Ip.Port = proto.Uint32(ip.Port)
		}
	}

	label := info.Name
	if info.Label != "" {
		label = info.Label
	}
	if info.USB != nil && info.USB.ProductName != "" {
		label = info.USB.ProductName
	}

	return &pb.Entity{
		Id:    controllerName + ".device." + nodeEntityID + "." + info.Name,
		Label: proto.String(label),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: dev,
	}
}
