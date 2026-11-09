//go:build !windows

package mdns

import (
	"context"
	"net"
	"syscall"

	"golang.org/x/sys/unix"
)

// listenMDNS binds :5353 with SO_REUSEADDR/SO_REUSEPORT so we coexist with a
// system mDNS responder that also holds the port.
func listenMDNS() (net.PacketConn, error) {
	lc := net.ListenConfig{
		Control: func(network, address string, c syscall.RawConn) error {
			var serr error
			err := c.Control(func(fd uintptr) {
				serr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEADDR, 1)
				if serr == nil {
					serr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)
				}
			})
			if err != nil {
				return err
			}
			return serr
		},
	}
	return lc.ListenPacket(context.Background(), "udp4", ":5353")
}
