//go:build linux

package serial

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/fsnotify/fsnotify"
	"github.com/projectqai/hydris/builtin/devices"
)

// discoverAndWatch returns a channel that receives snapshots of currently
// present serial ports. It fires once immediately and again on each hotplug
// event via inotify on /dev/.
func discoverAndWatch(ctx context.Context, logger *slog.Logger) <-chan map[string]devices.DeviceInfo {
	ch := make(chan map[string]devices.DeviceInfo, 1)

	go func() {
		defer close(ch)

		// Initial scan.
		ch <- scanSerialPorts(logger)

		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			logger.Error("failed to create fsnotify watcher", "error", err)
			return
		}
		defer func() { _ = watcher.Close() }()

		if err := watcher.Add("/dev"); err != nil {
			logger.Error("failed to watch /dev", "error", err)
			return
		}

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				name := filepath.Base(event.Name)
				if !strings.HasPrefix(name, "tty") {
					continue
				}
				if event.Op&(fsnotify.Create|fsnotify.Remove) == 0 {
					continue
				}
				ch <- scanSerialPorts(logger)
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				logger.Error("fsnotify error", "error", err)
			}
		}
	}()

	return ch
}

// scanSerialPorts enumerates externally-connected serial ports via /sys/class/tty.
// Only USB-backed TTYs (ttyACM*, ttyUSB*, etc.) are included. Legacy
// motherboard UARTs (ttyS*) and virtual TTYs are skipped.
func scanSerialPorts(logger *slog.Logger) map[string]devices.DeviceInfo {
	ports := make(map[string]devices.DeviceInfo)

	entries, err := os.ReadDir("/sys/class/tty")
	if err != nil {
		logger.Error("cannot read /sys/class/tty", "error", err)
		return ports
	}

	for _, entry := range entries {
		name := entry.Name()
		deviceLink := filepath.Join("/sys/class/tty", name, "device")
		resolved, err := filepath.EvalSymlinks(deviceLink)
		if err != nil {
			continue // no device symlink → virtual TTY
		}

		// Only include USB-backed serial ports. Legacy platform UARTs
		// (ttyS*) resolve to PNP/platform paths, not USB.
		if !strings.Contains(resolved, "usb") {
			continue
		}

		info := devices.DeviceInfo{
			Name:  name,
			Label: name,
			Serial: &devices.SerialDescriptor{
				Path: stablePath(name),
			},
		}

		readUSBInfo(&info, resolved)

		// Use a stable hardware ID as the map key so that the entity ID
		// does not change when the kernel assigns a different ttyUSB number.
		key := stableID(name, info)
		info.Name = key

		ports[key] = info
	}

	return ports
}

// stableID returns a hardware-based identifier for the device that is stable
// across reboots and re-enumeration. When the USB serial number is available,
// it returns "vid-pid-serial". Otherwise falls back to the tty device name.
func stableID(ttyName string, info devices.DeviceInfo) string {
	if u := info.USB; u != nil && u.SerialNumber != "" {
		return fmt.Sprintf("%04x-%04x-%s", u.VendorID, u.ProductID, u.SerialNumber)
	}
	return ttyName
}

// stablePath returns a stable device path for the given tty device name.
// On Linux, /dev/serial/by-id/ contains symlinks named after the hardware
// identity (e.g. usb-Silicon_Labs_CP2102_0001-if00-port0) that point to the
// actual /dev/ttyUSB* node. These persist across re-enumeration.
func stablePath(ttyName string) string {
	const byID = "/dev/serial/by-id"
	entries, err := os.ReadDir(byID)
	if err != nil {
		return "/dev/" + ttyName
	}
	for _, entry := range entries {
		target, err := os.Readlink(filepath.Join(byID, entry.Name()))
		if err != nil {
			continue
		}
		// target is relative, e.g. "../../ttyUSB0"
		if filepath.Base(target) == ttyName {
			return filepath.Join(byID, entry.Name())
		}
	}
	return "/dev/" + ttyName
}

// readUSBInfo walks up from the tty device sysfs path to find the USB device
// directory (containing idVendor) and populates the DeviceInfo USB descriptor.
func readUSBInfo(info *devices.DeviceInfo, resolved string) {
	dir := resolved
	for dir != "/" {
		if _, err := os.Stat(filepath.Join(dir, "idVendor")); err == nil {
			info.USB = &devices.USBDescriptor{
				VendorID:         readHexFile(filepath.Join(dir, "idVendor")),
				ProductID:        readHexFile(filepath.Join(dir, "idProduct")),
				ManufacturerName: readStringFile(filepath.Join(dir, "manufacturer")),
				ProductName:      readStringFile(filepath.Join(dir, "product")),
				SerialNumber:     readStringFile(filepath.Join(dir, "serial")),
			}
			return
		}
		dir = filepath.Dir(dir)
	}
}

func readStringFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func readHexFile(path string) uint32 {
	s := readStringFile(path)
	if s == "" {
		return 0
	}
	var val uint32
	_, _ = fmt.Sscanf(s, "%x", &val)
	return val
}
