package plugin

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// ErrNoNativeBinary is wrapped into the error NativeBinary returns when a
// native plugin ships no executable for the running platform.
var ErrNoNativeBinary = errors.New("no native binary for this platform")

// Platform is the key of this process in package.json's hydris.native.
func Platform() string { return runtime.GOOS + "/" + runtime.GOARCH }

// NativeBinary returns the executable a native plugin in dir runs on this
// platform, or "" for a JS plugin (no hydris.native in its package.json).
func NativeBinary(dir string) (string, error) {
	pkg, err := ReadPackageJSON(dir)
	if err != nil || pkg.Hydris == nil || len(pkg.Hydris.Native) == 0 {
		return "", nil
	}
	rel, ok := pkg.Hydris.Native[Platform()]
	if !ok {
		have := make([]string, 0, len(pkg.Hydris.Native))
		for p := range pkg.Hydris.Native {
			have = append(have, p)
		}
		sort.Strings(have)
		return "", fmt.Errorf("%w: %s (plugin has %s)", ErrNoNativeBinary, Platform(), strings.Join(have, ", "))
	}
	rel = filepath.FromSlash(rel)
	if !filepath.IsLocal(rel) {
		return "", fmt.Errorf("native binary %q must be a path inside the plugin", rel)
	}
	bin := filepath.Join(dir, rel)
	if _, err := os.Stat(bin); err != nil {
		return "", fmt.Errorf("native binary for %s: %w", Platform(), err)
	}
	return bin, nil
}
