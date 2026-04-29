//go:build linux

package platform

import (
	"fmt"
	"path"

	dbus "github.com/godbus/dbus/v5"
	"tinygo.org/x/bluetooth"
)

// bleProbeServices is a no-op on Linux. BlueZ aggregates service UUIDs
// from advertisements, scan responses, and its device cache, so the
// scan callback already receives the full set without a probe connect.
func bleProbeServices(_ bluetooth.Address) []string {
	return nil
}

// bleAdapter returns the first available BlueZ adapter. BlueZ may
// assign any hciN index depending on hardware order, so we query
// the ObjectManager instead of assuming hci0.
func bleAdapter() (*bluetooth.Adapter, error) {
	conn, err := dbus.SystemBus()
	if err != nil {
		return nil, fmt.Errorf("connect to system bus: %w", err)
	}

	var objects map[dbus.ObjectPath]map[string]map[string]dbus.Variant
	if err := conn.Object("org.bluez", "/").
		Call("org.freedesktop.DBus.ObjectManager.GetManagedObjects", 0).
		Store(&objects); err != nil {
		return nil, fmt.Errorf("enumerate BlueZ objects: %w", err)
	}

	for p := range objects {
		if _, ok := objects[p]["org.bluez.Adapter1"]; ok {
			id := path.Base(string(p))
			return bluetooth.NewAdapter(id), nil
		}
	}

	return nil, fmt.Errorf("no BlueZ adapter found")
}
