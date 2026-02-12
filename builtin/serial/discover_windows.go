//go:build windows

package serial

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"

	"github.com/projectqai/hydris/builtin/devices"
)

// discoverAndWatch falls back to periodic scanning on Windows where
// inotify / kqueue are not available.
func discoverAndWatch(ctx context.Context, logger *slog.Logger) <-chan map[string]devices.DeviceInfo {
	ch := make(chan map[string]devices.DeviceInfo, 1)

	go func() {
		defer close(ch)

		ch <- scanSerialPorts(logger)

		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				ch <- scanSerialPorts(logger)
			}
		}
	}()

	return ch
}

// scanSerialPorts enumerates serial ports on Windows by reading the
// HKLM\HARDWARE\DEVICEMAP\SERIALCOMM registry key, which maps driver
// names to COM port names (e.g. \Device\Serial0 → COM3).
// It then resolves USB VID/PID by correlating with the USB device enum.
func scanSerialPorts(logger *slog.Logger) map[string]devices.DeviceInfo {
	ports := make(map[string]devices.DeviceInfo)

	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DEVICEMAP\SERIALCOMM`, registry.READ)
	if err != nil {
		// Key may not exist if no serial ports are present.
		return ports
	}
	defer key.Close()

	names, err := key.ReadValueNames(-1)
	if err != nil {
		logger.Error("cannot read SERIALCOMM registry values", "error", err)
		return ports
	}

	// Build a map from COM port name → USB descriptor by walking the USB
	// device enum in the registry.
	usbMap := buildUSBMap()

	for _, name := range names {
		comPort, _, err := key.GetStringValue(name)
		if err != nil {
			continue
		}

		info := devices.DeviceInfo{
			Name: comPort,
			Serial: &devices.SerialDescriptor{
				Path: `\\.\` + comPort,
			},
		}

		if usb, ok := usbMap[comPort]; ok {
			info.USB = &usb
		}

		ports[comPort] = info
	}

	return ports
}

// buildUSBMap walks HKLM\SYSTEM\CurrentControlSet\Enum\USB to find USB serial
// devices and returns a map from COM port name to USB descriptor.
//
// The registry layout is:
//
//	Enum\USB\VID_XXXX&PID_XXXX\<instance>\Device Parameters\PortName = "COM3"
func buildUSBMap() map[string]devices.USBDescriptor {
	result := make(map[string]devices.USBDescriptor)

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

			desc := devices.USBDescriptor{
				VendorID:  vid,
				ProductID: pid,
			}

			// Read friendly names from the instance key.
			instKey, err := registry.OpenKey(devKey, instance, registry.READ)
			if err == nil {
				desc.ManufacturerName, _ = readRegString(instKey, "Mfg")
				desc.ProductName, _ = readRegString(instKey, "DeviceDesc")
				// Strip the driver-store prefix (e.g. "@usbser.inf,...;Product Name" → "Product Name").
				if i := strings.LastIndex(desc.ManufacturerName, ";"); i >= 0 {
					desc.ManufacturerName = desc.ManufacturerName[i+1:]
				}
				if i := strings.LastIndex(desc.ProductName, ";"); i >= 0 {
					desc.ProductName = desc.ProductName[i+1:]
				}
				instKey.Close()
			}

			result[portName] = desc
		}

		devKey.Close()
	}

	return result
}

// readPortName reads the PortName value from an instance's Device Parameters subkey.
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

// parseVIDPID extracts vendor and product IDs from a registry key name
// like "VID_239A&PID_8029".
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
