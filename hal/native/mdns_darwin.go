//go:build darwin

package platform

import (
	"log/slog"

	"github.com/projectqai/hydris/hal"
	"github.com/projectqai/hydris/hal/mdns"
)

// mDNS on macOS goes through the system mDNSResponder, falling back to hal/mdns.
// The rest of hal.P is wired by backend_darwin.go, whose init runs before this
// one, so these assignments are never clobbered.
func init() {
	hal.P.MDNSAdvertise = mdnsAdvertise
	hal.P.MDNSBrowse = mdnsBrowse
}

func mdnsAdvertise(instance, service string, port int, txt map[string]string) (stop func(), err error) {
	stop, err = dnssdAdvertise(instance, service, port, txt)
	if err == nil {
		return stop, nil
	}
	slog.Warn("mDNSResponder advertise failed, using built-in mDNS", "error", err)
	return mdns.Advertise(instance, service, port, txt)
}

func mdnsBrowse(service string, cb func([]hal.MDNSPeer)) (stop func(), err error) {
	stop, err = dnssdBrowse(service, cb)
	if err == nil {
		return stop, nil
	}
	slog.Warn("mDNSResponder browse failed, using built-in mDNS", "error", err)
	return mdns.Browse(service, cb)
}
