package builtin

import (
	_ "embed"
	"runtime"
)

//go:embed defaults.yaml
var defaultWorld []byte

//go:embed defaults_android.yaml
var androidOverrides []byte

// DefaultWorld returns the base defaults with platform-specific overrides appended.
// Overrides redeclare entities by ID; LoadDefaults deduplicates keeping the last
// occurrence, so overrides fully replace their base counterparts.
func DefaultWorld() []byte {
	switch runtime.GOOS {
	case "android":
		return append(defaultWorld, androidOverrides...)
	default:
		return defaultWorld
	}
}
