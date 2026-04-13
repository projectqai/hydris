//go:build linux

package platform

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/projectqai/hydris/hal"
)

func serialWatch(cb func([]hal.SerialPort)) (stop func()) {
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan []hal.SerialPort, 1)

	send := func(ports []hal.SerialPort) {
		select {
		case <-ch:
		default:
		}
		ch <- ports
	}

	go func() {
		defer close(ch)

		send(scanSerialPorts())

		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			slog.Error("failed to create fsnotify watcher", "error", err)
			return
		}
		defer func() { _ = watcher.Close() }()

		if err := watcher.Add("/dev"); err != nil {
			slog.Error("failed to watch /dev", "error", err)
			return
		}

		ticker := time.NewTicker(serialWatchInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				send(scanSerialPorts())
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
				send(scanSerialPorts())
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				slog.Error("fsnotify error", "error", err)
			}
		}
	}()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case ports, ok := <-ch:
				if !ok {
					return
				}
				cb(ports)
			}
		}
	}()

	return cancel
}

func scanSerialPorts() []hal.SerialPort {
	var ports []hal.SerialPort

	entries, err := os.ReadDir("/sys/class/tty")
	if err != nil {
		return ports
	}

	for _, entry := range entries {
		name := entry.Name()
		deviceLink := filepath.Join("/sys/class/tty", name, "device")
		resolved, err := filepath.EvalSymlinks(deviceLink)
		if err != nil {
			continue
		}

		if !strings.Contains(resolved, "usb") {
			continue
		}

		port := hal.SerialPort{
			Path:       "/dev/" + name,
			StablePath: stablePath(name),
			Name:       name,
		}

		readUSBInfo(&port, resolved)
		ports = append(ports, port)
	}

	return ports
}

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
		if filepath.Base(target) == ttyName {
			return filepath.Join(byID, entry.Name())
		}
	}
	return "/dev/" + ttyName
}

func readUSBInfo(port *hal.SerialPort, resolved string) {
	dir := resolved
	for dir != "/" {
		if _, err := os.Stat(filepath.Join(dir, "idVendor")); err == nil {
			port.VendorID = readHexFile(filepath.Join(dir, "idVendor"))
			port.ProductID = readHexFile(filepath.Join(dir, "idProduct"))
			port.SerialNumber = readStringFile(filepath.Join(dir, "serial"))
			port.ManufacturerName = readStringFile(filepath.Join(dir, "manufacturer"))
			port.ProductName = readStringFile(filepath.Join(dir, "product"))
			if port.ProductName != "" {
				port.Name = port.ProductName
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
