package netscan

import (
	"log/slog"
	"strings"
)

// LookupMAC looks up the MAC address for the given IP in the system ARP table.
// Returns the MAC as a lowercase hex string without separators (e.g. "ec71dbc8545d"),
// or "" if the IP is not found.
func LookupMAC(ip string) string {
	table := readARPTable(slog.Default())
	for _, dev := range table {
		if dev.Device != nil && dev.Device.Ip != nil && dev.Device.Ip.GetHost() == ip {
			if dev.Device.Ethernet != nil {
				return strings.ReplaceAll(strings.ToLower(dev.Device.Ethernet.GetMacAddress()), ":", "")
			}
		}
	}
	return ""
}
