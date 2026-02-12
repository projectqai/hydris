//go:build !linux && !darwin && !windows

package serial

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin/devices"
)

// discoverAndWatch falls back to periodic scanning on platforms where inotify /
// kqueue are not available (e.g. Windows).
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

// scanSerialPorts enumerates serial ports by listing /dev for tty* entries.
// On platforms without sysfs this is a best-effort scan.
func scanSerialPorts(logger *slog.Logger) map[string]devices.DeviceInfo {
	ports := make(map[string]devices.DeviceInfo)

	entries, err := os.ReadDir("/dev")
	if err != nil {
		// /dev may not exist (e.g. Windows) — that's OK.
		return ports
	}

	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "tty") {
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
