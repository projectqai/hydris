package artifacts

import "fmt"

// checkDiskSpace on Windows always fails closed — disk usage cannot be
// determined without platform-specific APIs.
func (s *LocalStore) checkDiskSpace() error {
	return fmt.Errorf("disk usage check not supported on Windows (refusing write)")
}
