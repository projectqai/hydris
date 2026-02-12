//go:build windows

package meshtastic

import (
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// dcb mirrors the Win32 DCB structure.
type dcb struct {
	DCBLength uint32
	BaudRate  uint32
	Flags     uint32
	_         uint16 // wReserved
	XonLim    uint16
	XoffLim   uint16
	ByteSize  byte
	Parity    byte
	StopBits  byte
	XonChar   byte
	XoffChar  byte
	ErrorChar byte
	EOFChar   byte
	EvtChar   byte
	_         uint16 // wReserved1
}

// commTimeouts mirrors the Win32 COMMTIMEOUTS structure.
type commTimeouts struct {
	ReadIntervalTimeout         uint32
	ReadTotalTimeoutMultiplier  uint32
	ReadTotalTimeoutConstant    uint32
	WriteTotalTimeoutMultiplier uint32
	WriteTotalTimeoutConstant   uint32
}

var (
	kernel32         = windows.NewLazySystemDLL("kernel32.dll")
	procGetCommState = kernel32.NewProc("GetCommState")
	procSetCommState = kernel32.NewProc("SetCommState")
	procSetCommTmout = kernel32.NewProc("SetCommTimeouts")
	procPurgeComm    = kernel32.NewProc("PurgeComm")
	procEscapeComm   = kernel32.NewProc("EscapeCommFunction")
)

const (
	purgeRxClear = 0x0008
	purgeTxClear = 0x0004
	setDTR       = 5
)

// openSerialPort opens a COM port using CreateFile with FILE_FLAG_OVERLAPPED
// so that Go's runtime can manage it via IOCP. It then configures the port
// for raw binary 8N1 with DTR asserted.
func openSerialPort(path string) (*os.File, error) {
	pathp, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, fmt.Errorf("invalid path %q: %w", path, err)
	}

	h, err := windows.CreateFile(
		pathp,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		0, // exclusive access
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OVERLAPPED,
		0,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateFile %s: %w", path, err)
	}

	// Wrap the raw handle in an *os.File so Go's IOCP poller picks it up.
	f := os.NewFile(uintptr(h), path)

	if err := configureSerialPort(h); err != nil {
		f.Close()
		return nil, err
	}

	return f, nil
}

// configureSerialPort sets the COM port to raw binary mode (8N1, no flow
// control, DTR asserted) so the meshtastic binary protocol passes through
// unmodified. Takes the raw handle to avoid calling Fd() on the os.File.
func configureSerialPort(h windows.Handle) error {
	var d dcb
	d.DCBLength = uint32(unsafe.Sizeof(d))

	r, _, err := procGetCommState.Call(uintptr(h), uintptr(unsafe.Pointer(&d)))
	if r == 0 {
		return fmt.Errorf("GetCommState: %w", err)
	}

	d.BaudRate = 115200
	d.ByteSize = 8
	d.Parity = 0   // NOPARITY
	d.StopBits = 0 // ONESTOPBIT
	// fBinary=1 | fDtrControl=DTR_CONTROL_ENABLE | fRtsControl=RTS_CONTROL_ENABLE.
	// DTR must be asserted for CDC ACM devices to recognise the host.
	d.Flags = 0x01 | 0x10 | 0x1000
	d.XonChar = 0
	d.XoffChar = 0

	r, _, err = procSetCommState.Call(uintptr(h), uintptr(unsafe.Pointer(&d)))
	if r == 0 {
		return fmt.Errorf("SetCommState: %w", err)
	}

	// Purge any stale data in the driver buffers.
	procPurgeComm.Call(uintptr(h), purgeRxClear|purgeTxClear)

	// Explicitly assert DTR in case the driver didn't honour the DCB flag.
	procEscapeComm.Call(uintptr(h), setDTR)

	var timeouts commTimeouts
	timeouts.ReadIntervalTimeout = 0
	timeouts.ReadTotalTimeoutMultiplier = 0
	timeouts.ReadTotalTimeoutConstant = 0
	timeouts.WriteTotalTimeoutMultiplier = 0
	timeouts.WriteTotalTimeoutConstant = 5000

	r, _, err = procSetCommTmout.Call(uintptr(h), uintptr(unsafe.Pointer(&timeouts)))
	if r == 0 {
		return fmt.Errorf("SetCommTimeouts: %w", err)
	}

	return nil
}
