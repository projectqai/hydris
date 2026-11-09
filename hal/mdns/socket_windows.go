//go:build windows

package mdns

import (
	"context"
	"net"
	"syscall"
)

// listenMDNS binds :5353 with SO_REUSEADDR so we coexist with Dnscache.
func listenMDNS() (net.PacketConn, error) {
	lc := net.ListenConfig{
		Control: func(network, address string, c syscall.RawConn) error {
			var serr error
			err := c.Control(func(fd uintptr) {
				serr = syscall.SetsockoptInt(syscall.Handle(fd), syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
			})
			if err != nil {
				return err
			}
			return serr
		},
	}
	return lc.ListenPacket(context.Background(), "udp4", ":5353")
}
