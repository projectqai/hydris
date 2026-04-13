// Package all imports all builtin controllers so that a single
//
//	_ "github.com/projectqai/hydris/builtin/all"
//
// is enough to register every built-in. Keep this list in sync
// when adding or removing builtins.
package all

import (
	_ "github.com/projectqai/hydris/builtin/adsblol"
	_ "github.com/projectqai/hydris/builtin/ais"
	_ "github.com/projectqai/hydris/builtin/artifacts"
	_ "github.com/projectqai/hydris/builtin/asterix"
	_ "github.com/projectqai/hydris/builtin/federation"
	_ "github.com/projectqai/hydris/builtin/hal"
	_ "github.com/projectqai/hydris/builtin/mavlink"
	_ "github.com/projectqai/hydris/builtin/mediaserver"
	_ "github.com/projectqai/hydris/builtin/meshtastic"
	_ "github.com/projectqai/hydris/builtin/netscan"
	_ "github.com/projectqai/hydris/builtin/playground"
	_ "github.com/projectqai/hydris/builtin/plugins"
	_ "github.com/projectqai/hydris/builtin/reolink"
	_ "github.com/projectqai/hydris/builtin/sapient"
	_ "github.com/projectqai/hydris/builtin/spacetrack"
	_ "github.com/projectqai/hydris/builtin/tak"
)
