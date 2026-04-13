//go:build windows

package platform

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/projectqai/hydris/hal"
	"golang.org/x/sys/windows/registry"
)

func serialWatch(cb func([]hal.SerialPort)) (stop func()) {
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		cb(scanSerialPorts())

		ticker := time.NewTicker(serialWatchInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cb(scanSerialPorts())
			}
		}
	}()

	return cancel
}

func scanSerialPorts() []hal.SerialPort {
	var ports []hal.SerialPort

	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DEVICEMAP\SERIALCOMM`, registry.READ)
	if err != nil {
		return ports
	}
	defer key.Close()

	names, err := key.ReadValueNames(-1)
	if err != nil {
		return ports
	}

	usbMap := buildUSBMap()

	for _, name := range names {
		comPort, _, err := key.GetStringValue(name)
		if err != nil {
			continue
		}

		port := hal.SerialPort{
			Path: `\\.\` + comPort,
			Name: comPort,
		}

		if usb, ok := usbMap[comPort]; ok {
			port.VendorID = usb.vendorID
			port.ProductID = usb.productID
			port.SerialNumber = usb.serialNumber
			port.ManufacturerName = usb.manufacturerName
			port.ProductName = usb.productName
			if usb.productName != "" {
				port.Name = usb.productName
			}
			if usb.serialNumber != "" {
				port.StablePath = fmt.Sprintf("%04x-%04x-%s", usb.vendorID, usb.productID, usb.serialNumber)
			}
		}

		ports = append(ports, port)
	}

	return ports
}

type usbInfo struct {
	vendorID         uint32
	productID        uint32
	manufacturerName string
	productName      string
	serialNumber     string
}

func buildUSBMap() map[string]usbInfo {
	result := make(map[string]usbInfo)

	enumKey, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SYSTEM\CurrentControlSet\Enum\USB`, registry.READ)
	if err != nil {
		return result
	}
	defer enumKey.Close()

	vidPidKeys, err := enumKey.ReadSubKeyNames(-1)
	if err != nil {
		return result
	}

	for _, vidPid := range vidPidKeys {
		vid, pid, ok := parseVIDPID(vidPid)
		if !ok {
			continue
		}

		devKey, err := registry.OpenKey(enumKey, vidPid, registry.READ)
		if err != nil {
			continue
		}

		instances, err := devKey.ReadSubKeyNames(-1)
		if err != nil {
			devKey.Close()
			continue
		}

		for _, instance := range instances {
			portName := readPortName(devKey, instance)
			if portName == "" {
				continue
			}

			info := usbInfo{vendorID: vid, productID: pid}

			instKey, err := registry.OpenKey(devKey, instance, registry.READ)
			if err == nil {
				info.manufacturerName, _ = readRegString(instKey, "Mfg")
				info.productName, _ = readRegString(instKey, "DeviceDesc")
				if i := strings.LastIndex(info.manufacturerName, ";"); i >= 0 {
					info.manufacturerName = info.manufacturerName[i+1:]
				}
				if i := strings.LastIndex(info.productName, ";"); i >= 0 {
					info.productName = info.productName[i+1:]
				}
				instKey.Close()
			}

			result[portName] = info
		}

		devKey.Close()
	}

	return result
}

func readPortName(parentKey registry.Key, instance string) string {
	path := instance + `\Device Parameters`
	paramKey, err := registry.OpenKey(parentKey, path, registry.READ)
	if err != nil {
		return ""
	}
	defer paramKey.Close()
	portName, err := readRegString(paramKey, "PortName")
	if err != nil {
		return ""
	}
	return portName
}

func parseVIDPID(s string) (vid, pid uint32, ok bool) {
	s = strings.ToUpper(s)
	if !strings.HasPrefix(s, "VID_") {
		return 0, 0, false
	}
	n, _ := fmt.Sscanf(s, "VID_%04X&PID_%04X", &vid, &pid)
	return vid, pid, n == 2
}

func readRegString(key registry.Key, name string) (string, error) {
	val, _, err := key.GetStringValue(name)
	return val, err
}
