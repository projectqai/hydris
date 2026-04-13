package version

import (
	"strings"

	semver "github.com/blang/semver/v4"
)

var Version = "dev"

// ParseGitVersion parses a git-describe version string (e.g. "v0.0.20-12-g69a53ec-dirty")
// into a semver value suitable for comparison. The git-describe suffix is stripped
// so the version compares as the base tag (0.0.20).
func ParseGitVersion(v string) (semver.Version, error) {
	localStr := strings.TrimPrefix(v, "v")
	if i := strings.IndexByte(localStr, '-'); i > 0 {
		localStr = localStr[:i]
	}
	return semver.ParseTolerant(localStr)
}

// IsNewerVersion reports whether remote is strictly newer than the local Version.
func IsNewerVersion(remote string) bool {
	local, err := ParseGitVersion(Version)
	if err != nil {
		return false
	}
	rv, err := ParseGitVersion(remote)
	if err != nil {
		return false
	}
	return rv.GT(local)
}
