package meshtastic

import "golang.org/x/sys/unix"

const (
	ioctlGET = unix.TCGETS
	ioctlSET = unix.TCSETS
)
