//go:build unix

package meshtastic

import (
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

func openSerialPort(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return nil, err
	}
	if err := configureSerialPort(f); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}

// configureSerialPort sets the serial port to raw mode (no terminal processing)
// so binary meshtastic protocol data passes through unmodified.
func configureSerialPort(f *os.File) error {
	fd := int(f.Fd())

	termios, err := unix.IoctlGetTermios(fd, ioctlGET)
	if err != nil {
		return fmt.Errorf("get termios: %w", err)
	}

	// Raw mode: disable all terminal processing.
	termios.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP |
		unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON
	termios.Oflag &^= unix.OPOST
	termios.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
	termios.Cflag &^= unix.CSIZE | unix.PARENB
	termios.Cflag |= unix.CS8 | unix.CLOCAL | unix.CREAD

	// Blocking read, return after at least 1 byte.
	termios.Cc[unix.VMIN] = 1
	termios.Cc[unix.VTIME] = 0

	if err := unix.IoctlSetTermios(fd, ioctlSET, termios); err != nil {
		return fmt.Errorf("set termios: %w", err)
	}

	return nil
}
