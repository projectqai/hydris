//go:build windows

package platform

import (
	"tinygo.org/x/bluetooth"
)

func bleAdapter() (*bluetooth.Adapter, error) {
	return bluetooth.DefaultAdapter, nil
}

// bleProbeServices connects briefly to a device to discover its GATT
// service UUIDs. On Windows the BLE stack does not surface service
// UUIDs for devices that only expose them via scan response or that
// require a connection, so we probe to fill in the gap.
func bleProbeServices(addr bluetooth.Address) []string {
	adapter, err := bleAdapter()
	if err != nil {
		return nil
	}
	device, err := adapter.Connect(addr, bluetooth.ConnectionParams{})
	if err != nil {
		return nil
	}
	defer func() { _ = device.Disconnect() }()

	services, err := device.DiscoverServices(nil)
	if err != nil {
		return nil
	}

	uuids := make([]string, 0, len(services))
	for _, svc := range services {
		uuids = append(uuids, svc.UUID().String())
	}
	return uuids
}
