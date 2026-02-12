//go:build !unix && !windows

package meshtastic

import "os"

func openSerialPort(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDWR, 0)
}

func configureSerialPort(_ *os.File) error {
	return nil
}
