package meshtastic

import "golang.org/x/sys/unix"

const (
	ioctlGET = unix.TIOCGETA
	ioctlSET = unix.TIOCSETA
)
