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
			Name: name,
			Serial: &devices.SerialDescriptor{
				Path: "/dev/" + name,
			},
		}

		readUSBInfo(&info, resolved)

		ports[name] = info
	}

	return ports
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
