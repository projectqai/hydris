//go:build windows

package artifacts

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// checkDiskSpace rejects writes when disk usage >= 80%.
// On Windows, fails open: if usage cannot be determined, the write is allowed.
func (s *LocalStore) checkDiskSpace() error {
	p, err := windows.UTF16PtrFromString(s.dataDir)
	if err != nil {
		return nil
	}

	var freeBytesAvailable, totalBytes, totalFreeBytes uint64
	err = windows.GetDiskFreeSpaceEx(
		p,
		(*uint64)(unsafe.Pointer(&freeBytesAvailable)),
		(*uint64)(unsafe.Pointer(&totalBytes)),
		(*uint64)(unsafe.Pointer(&totalFreeBytes)),
	)
	if err != nil || totalBytes == 0 {
		return nil
	}
	usedPct := float64(totalBytes-totalFreeBytes) / float64(totalBytes)
	if usedPct >= 0.90 {
		return fmt.Errorf("disk usage %.0f%% >= 90%% for %s (refusing write)", usedPct*100, s.dataDir)
	}
	return nil
}
