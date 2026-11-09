package platform

import (
	"github.com/projectqai/hydris/hal"
	"github.com/projectqai/hydris/hal/mdns"
)

// mDNS on Windows uses the hand-made hal/mdns implementation directly.

func mdnsAdvertise(instance, service string, port int, txt map[string]string) (stop func(), err error) {
	return mdns.Advertise(instance, service, port, txt)
}

func mdnsBrowse(service string, cb func([]hal.MDNSPeer)) (stop func(), err error) {
	return mdns.Browse(service, cb)
}
