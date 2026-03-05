//go:generate go run ./cmd/genoui

package netscan

import "strings"

// lookupOUI returns the vendor name for a MAC address, or "" if not in the
// build-time filtered OUI table.
func lookupOUI(mac string) string {
	// Normalize: strip separators, lowercase, take first 6 hex chars.
	mac = strings.NewReplacer(":", "", "-", "", ".", "").Replace(mac)
	mac = strings.ToLower(mac)
	if len(mac) < 6 {
		return ""
	}
	return ouiTable[mac[:6]]
}
