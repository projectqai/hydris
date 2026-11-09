package platform

import (
	"log/slog"

	"github.com/projectqai/hydris/hal"
	"github.com/projectqai/hydris/hal/mdns"
)

// mDNS on Linux prefers the system Avahi daemon, falling back to hal/mdns.

func mdnsAdvertise(instance, service string, port int, txt map[string]string) (stop func(), err error) {
	if conn, aerr := avahiBus(); aerr == nil {
		stop, err = avahiAdvertise(conn, instance, service, port, txt)
		if err == nil {
			return stop, nil
		}
		slog.Warn("avahi advertise failed, using built-in mDNS", "error", err)
	}
	return mdns.Advertise(instance, service, port, txt)
}

func mdnsBrowse(service string, cb func([]hal.MDNSPeer)) (stop func(), err error) {
	if conn, aerr := avahiBus(); aerr == nil {
		stop, err = avahiBrowse(conn, service, cb)
		if err == nil {
			return stop, nil
		}
		slog.Warn("avahi browse failed, using built-in mDNS", "error", err)
	}
	return mdns.Browse(service, cb)
}
