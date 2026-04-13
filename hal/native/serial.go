//go:build linux || windows

package platform

import (
	"fmt"
	"io"
	"sync"
	"sync/atomic"

	goserial "go.bug.st/serial"
)

var (
	serialMu         sync.Mutex
	serialPorts      = make(map[int64]io.ReadWriteCloser)
	serialNextHandle atomic.Int64
)

func serialOpen(path string, baudRate int) (int64, error) {
	if baudRate == 0 {
		baudRate = 115200
	}
	port, err := goserial.Open(path, &goserial.Mode{BaudRate: baudRate})
	if err != nil {
		return 0, fmt.Errorf("open serial %s: %w", path, err)
	}

	handle := serialNextHandle.Add(1)
	serialMu.Lock()
	serialPorts[handle] = port
	serialMu.Unlock()

	return handle, nil
}

func serialRead(handle int64, maxLen int) ([]byte, error) {
	serialMu.Lock()
	port, ok := serialPorts[handle]
	serialMu.Unlock()
	if !ok {
		return nil, fmt.Errorf("unknown serial handle %d", handle)
	}
	buf := make([]byte, maxLen)
	n, err := port.Read(buf)
	if err != nil {
		return nil, err
	}
	return buf[:n], nil
}

func serialWrite(handle int64, data []byte) (int, error) {
	serialMu.Lock()
	port, ok := serialPorts[handle]
	serialMu.Unlock()
	if !ok {
		return 0, fmt.Errorf("unknown serial handle %d", handle)
	}
	return port.Write(data)
}

func serialClose(handle int64) error {
	serialMu.Lock()
	port, ok := serialPorts[handle]
	if ok {
		delete(serialPorts, handle)
	}
	serialMu.Unlock()
	if !ok {
		return fmt.Errorf("unknown serial handle %d", handle)
	}
	return port.Close()
}
