//go:build !windows

package artifacts

import (
	"fmt"
	"syscall"
)

// checkDiskSpace rejects writes when disk usage >= 80%.
// If the disk usage cannot be determined, it also rejects (fail closed).
func (s *LocalStore) checkDiskSpace() error {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(s.dataDir, &stat); err != nil {
		return fmt.Errorf("cannot determine disk usage for %s: %w (refusing write)", s.dataDir, err)
	}
	if stat.Blocks == 0 {
		return fmt.Errorf("cannot determine disk usage for %s: zero blocks (refusing write)", s.dataDir)
	}
	usedPct := float64(stat.Blocks-stat.Bfree) / float64(stat.Blocks)
	if usedPct >= 0.80 {
		return fmt.Errorf("disk usage %.0f%% >= 80%% for %s (refusing write)", usedPct*100, s.dataDir)
	}
	return nil
}
