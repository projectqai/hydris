package meta

import "time"

// Component tracks the lifetime and provenance of a single component field
// within an entity. Each provenance fact is its own field — there is no
// overloaded "source": Generated/Reloaded/Builtin are independent and a plain
// live client push leaves all three empty.
type Component struct {
	Fresh      time.Time
	Until      time.Time
	NoLifetime bool

	// How the value was produced (mutually exclusive in practice, but tracked
	// independently rather than collapsed into one string):
	Generated   bool   // computed by a transformer, not an external push
	Transformer string // when Generated: the specific transformer that produced it (e.g. "pose", "aou")
	Reloaded    bool   // (re)applied from the persisted world file / builtin defaults at startup

	// Who/where the write came from — Actor is the identity, OriginNode is the
	// node; they never share a field:
	Builtin    string    // the builtin that relayed the push (empty: direct client, transformer, or reload)
	Actor      string    // resolved identity that performed the write (authn.policy actor entity)
	OriginNode string    // node the change originated on: this node for local writes, the remote node for federation relays, empty for remote non-federation peers
	WrittenAt  time.Time // wall-clock time of the write
}
