//go:build darwin

package serial

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/fsnotify/fsnotify"
	"github.com/projectqai/hydris/builtin/devices"
)

// discoverAndWatch returns a channel that receives snapshots of currently
// present serial ports. It fires once immediately and again on each hotplug
// event via kqueue on /dev/.
func discoverAndWatch(ctx context.Context, logger *slog.Logger) <-chan map[string]devices.DeviceInfo {
	ch := make(chan map[string]devices.DeviceInfo, 1)

	go func() {
		defer close(ch)

		ch <- scanSerialPorts(logger)

		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			logger.Error("failed to create fsnotify watcher", "error", err)
			return
		}
		defer watcher.Close()

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
				if !strings.HasPrefix(name, "cu.") && !strings.HasPrefix(name, "tty.") {
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

// scanSerialPorts enumerates serial ports on macOS by listing /dev/cu.* entries.
// The cu.* devices are the "callout" devices preferred for serial communication.
func scanSerialPorts(logger *slog.Logger) map[string]devices.DeviceInfo {
	ports := make(map[string]devices.DeviceInfo)

	entries, err := os.ReadDir("/dev")
	if err != nil {
		logger.Error("cannot read /dev", "error", err)
		return ports
	}

	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "cu.") {
			continue
		}
		// Skip the built-in Bluetooth modem.
		if name == "cu.Bluetooth-Incoming-Port" {
			continue
		}

		info := devices.DeviceInfo{
			Name: name,
			Serial: &devices.SerialDescriptor{
				Path: "/dev/" + name,
			},
		}

		ports[name] = info
	}

	return ports
}
