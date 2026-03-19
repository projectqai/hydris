//go:build darwin

package serial

import (
	"bufio"
	"context"
	"log/slog"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin/devices"
)

// discoverAndWatch returns a channel that receives snapshots of currently
// present serial ports. It fires once immediately and then polls periodically.
// We use ioreg to enumerate USB serial devices, which gives us both the
// device path and USB vendor/product info in one shot. We avoid
// fsnotify/kqueue on macOS because kqueue opens a file descriptor for every
// entry in a watched directory, and many special device files in /dev
// cannot be opened, causing spurious errors.
func discoverAndWatch(ctx context.Context, logger *slog.Logger) <-chan map[string]devices.DeviceInfo {
	ch := make(chan map[string]devices.DeviceInfo, 1)

	go func() {
		defer close(ch)

		prev := scanSerialPorts(logger)
		ch <- prev

		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cur := scanSerialPorts(logger)
				if !sameKeys(prev, cur) {
					prev = cur
					ch <- cur
				}
			}
		}
	}()

	return ch
}

func sameKeys(a, b map[string]devices.DeviceInfo) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if _, ok := b[k]; !ok {
			return false
		}
	}
	return true
}

// scanSerialPorts enumerates USB serial ports on macOS by parsing ioreg output.
// This gives us both the /dev/cu.* path and USB vendor/product info.
func scanSerialPorts(logger *slog.Logger) map[string]devices.DeviceInfo {
	ports := make(map[string]devices.DeviceInfo)

	out, err := exec.Command("ioreg", "-r", "-c", "IOUSBHostDevice", "-l").Output()
	if err != nil {
		logger.Error("ioreg failed", "error", err)
		return ports
	}

	// ioreg output is a tree with +-o markers for objects and | indentation.
	// USB device properties (idVendor, idProduct, etc.) appear at one depth,
	// and IOCalloutDevice appears in a child serial nub deeper in the tree.
	// We track USB info per top-level device and associate when we find
	// IOCalloutDevice.
	type usbCtx struct {
		desc  devices.USBDescriptor
		depth int
	}

	var current *usbCtx

	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "+-o ") {
			depth := strings.Index(line, "+-o")
			if current == nil || depth <= current.depth {
				current = &usbCtx{depth: depth}
			}
			continue
		}

		if current == nil {
			continue
		}

		if strings.Contains(trimmed, `"idVendor"`) {
			current.desc.VendorID = parseIORegInt(trimmed)
		} else if strings.Contains(trimmed, `"idProduct"`) {
			current.desc.ProductID = parseIORegInt(trimmed)
		} else if strings.Contains(trimmed, `"USB Vendor Name"`) {
			current.desc.ManufacturerName = parseIORegString(trimmed)
		} else if strings.Contains(trimmed, `"USB Product Name"`) {
			current.desc.ProductName = parseIORegString(trimmed)
		} else if strings.Contains(trimmed, `"USB Serial Number"`) {
			current.desc.SerialNumber = parseIORegString(trimmed)
		} else if strings.Contains(trimmed, `"IOCalloutDevice"`) {
			path := parseIORegString(trimmed)
			if path != "" && current.desc.VendorID != 0 {
				name := filepath.Base(path)
				ports[name] = devices.DeviceInfo{
					Name: name,
					Serial: &devices.SerialDescriptor{
						Path: path,
					},
					USB: &devices.USBDescriptor{
						VendorID:         current.desc.VendorID,
						ProductID:        current.desc.ProductID,
						ManufacturerName: current.desc.ManufacturerName,
						ProductName:      current.desc.ProductName,
						SerialNumber:     current.desc.SerialNumber,
					},
				}
			}
		}
	}

	return ports
}

// parseIORegInt extracts an integer value from an ioreg line like:
//
//	"idVendor" = 9114
func parseIORegInt(line string) uint32 {
	parts := strings.SplitN(line, "=", 2)
	if len(parts) != 2 {
		return 0
	}
	v, _ := strconv.ParseUint(strings.TrimSpace(parts[1]), 10, 32)
	return uint32(v)
}

// parseIORegString extracts a string value from an ioreg line like:
//
//	"USB Product Name" = "TTGO_eink"
func parseIORegString(line string) string {
	parts := strings.SplitN(line, "=", 2)
	if len(parts) != 2 {
		return ""
	}
	s := strings.TrimSpace(parts[1])
	return strings.Trim(s, `"`)
}
