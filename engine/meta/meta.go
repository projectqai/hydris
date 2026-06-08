package meta

import "time"

// Component tracks the lifetime and origin of a single component field within an entity.
type Component struct {
	Fresh      time.Time
	Until      time.Time
	NoLifetime bool
	Generated  bool

	Source   string    // debug: who last wrote this component (e.g. builtin name, "transformer", "gc")
	SourceAt time.Time // debug: wall-clock time of the write
}
