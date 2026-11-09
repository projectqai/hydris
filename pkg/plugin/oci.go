package plugin

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/blang/semver/v4"
	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/remote/transport"
	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
)

// TempDir is the base directory for temporary plugin extractions.
// Empty string uses the OS default. On Android this must be set to a
// writable directory (e.g. the app's cache dir) before calling ResolveOCI.
// Hosts set it with SetWorkDir.
var TempDir string

// SetWorkDir makes dir the base of plugin extractions, in place of the system
// temp dir, which may be noexec. It removes temporary extractions left behind.
func SetWorkDir(dir string) error {
	dir, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	for _, pattern := range []string{"hydris-plugin-*", "hydris-plugindev-*"} {
		stale, _ := filepath.Glob(filepath.Join(dir, pattern))
		for _, d := range stale {
			_ = os.RemoveAll(d)
		}
	}
	TempDir = dir
	return nil
}

// Package mirrors the relevant fields of a plugin's package.json.
type Package struct {
	Name    string   `json:"name"`
	Version string   `json:"version"`
	Main    string   `json:"main"`
	Files   []string `json:"files,omitempty"`
	Hydris  *struct {
		Compat string `json:"compat,omitempty"`
		// Actors are identities the plugin may push as, one per request (see
		// connect() in @projectqai/proto/device), besides its own install entity.
		// A plugin uses one to hand data it does not trust, such as radio frames,
		// a tighter policy than its own code runs under, and ships that policy in
		// its defaults.yaml under the same id. It can only pick from this list,
		// never escalate.
		Actors []string `json:"actors,omitempty"`
		// Native maps "GOOS/GOARCH" to an executable inside the plugin. A
		// plugin with a native entry runs as a subprocess instead of a JS
		// bundle (see NativeBinary).
		Native map[string]string `json:"native,omitempty"`
	} `json:"hydris,omitempty"`
}

// DefaultsFile is the optional entity file shipped next to a plugin's
// package.json. The plugin host loads it when the plugin starts, with the same
// rules as builtin/defaults.yaml, and `hydris plugin build` always packs it.
const DefaultsFile = "defaults.yaml"

// ReadPackageJSON reads and parses a package.json from dir.
func ReadPackageJSON(dir string) (*Package, error) {
	data, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return nil, fmt.Errorf("read package.json: %w", err)
	}
	var pkg Package
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil, fmt.Errorf("parse package.json: %w", err)
	}
	return &pkg, nil
}

// ResolveOCI pulls an OCI image, extracts the plugin layer, checks version
// constraints and returns the path to the bundle and its data directory.
// The caller must call cleanup when done to remove the temp directory.
// key names the extraction directory, see ExtractPluginTarGz.
func ResolveOCI(ref, hydrisVersion, key string) (bundlePath, dataDir string, cleanup func(), err error) {
	noop := func() {}

	parsed, err := name.ParseReference(ref)
	if err != nil {
		return "", "", noop, fmt.Errorf("invalid image reference %q: %w", ref, err)
	}

	img, err := pullImage(parsed)
	if err != nil {
		return "", "", noop, fmt.Errorf("pull %s: %w", ref, err)
	}

	dir, err := extractPlugin(img, key)
	if err != nil {
		return "", "", noop, err
	}
	rmDir := func() { os.RemoveAll(dir) }

	pkg, err := ReadPackageJSON(dir)
	if err != nil {
		rmDir()
		return "", "", noop, err
	}

	if err := CheckHydrisVersion(pkg, hydrisVersion); err != nil {
		rmDir()
		return "", "", noop, err
	}

	// A native plugin has no bundle; the caller runs NativeBinary(dir).
	if bin, err := NativeBinary(dir); err != nil || bin != "" {
		if err != nil {
			rmDir()
			return "", "", noop, err
		}
		slog.Info("resolved native plugin from OCI", "ref", ref, "name", pkg.Name, "version", pkg.Version)
		return "", dir, rmDir, nil
	}

	// hydris plugin build always produces bundle.js regardless of the
	// source entry point listed in package.json's main field.
	bundle := filepath.Join(dir, "bundle.js")
	if _, err := os.Stat(bundle); err != nil {
		rmDir()
		return "", "", noop, fmt.Errorf(
			"plugin %q does not contain bundle.js; it must be built with `hydris plugin build` before use",
			ref,
		)
	}

	slog.Info("resolved plugin from OCI", "ref", ref, "name", pkg.Name, "version", pkg.Version)
	return bundle, dir, rmDir, nil
}

// pullImage pulls from the remote registry with auth from the hydris world
// service (if available) or the default Docker keychain.
func pullImage(ref name.Reference) (v1.Image, error) {
	kc := registryKeychain()
	return remote.Image(ref, remote.WithAuthFromKeychain(kc))
}

// registryKeychain returns a keychain that resolves credentials from registry
// entities in the hydris world service. Falls back to authn.DefaultKeychain
// when the world service is unreachable.
func registryKeychain() authn.Keychain {
	conn, err := builtin.BuiltinClientConn("plugin")
	if err != nil {
		slog.Warn("registry keychain: cannot connect to world service, using default keychain", "error", err)
		return authn.DefaultKeychain
	}
	defer func() { _ = conn.Close() }()

	client := pb.NewWorldServiceClient(conn)
	class := "registry"
	resp, err := client.ListEntities(context.Background(), &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Device: &pb.DeviceFilter{DeviceClass: &class},
		},
	})
	if err != nil {
		slog.Warn("registry keychain: cannot list registry entities, using default keychain", "error", err)
		return authn.DefaultKeychain
	}

	entries := make(map[string]authn.AuthConfig)
	for _, e := range resp.Entities {
		if e.Config == nil || e.Config.Value == nil {
			continue
		}
		fields := e.Config.Value.Fields
		reg := fields["registry"].GetStringValue()
		user := fields["username"].GetStringValue()
		pass := fields["password"].GetStringValue()
		if reg == "" || user == "" || pass == "" {
			continue
		}
		slog.Debug("registry keychain: found credentials", "registry", reg, "username", user)
		entries[reg] = authn.AuthConfig{Username: user, Password: pass}
	}

	if len(entries) == 0 {
		slog.Warn("registry keychain: no registry credentials found in world service")
		return authn.DefaultKeychain
	}
	return &worldKeychain{entries: entries}
}

// worldKeychain resolves credentials from hydris registry entities.
type worldKeychain struct {
	entries map[string]authn.AuthConfig
}

func (k *worldKeychain) Resolve(res authn.Resource) (authn.Authenticator, error) {
	reg := res.RegistryStr()
	if cfg, ok := k.entries[reg]; ok {
		slog.Debug("registry keychain: resolved credentials", "registry", reg)
		return authn.FromConfig(cfg), nil
	}
	slog.Warn("registry keychain: no credentials for registry", "registry", reg, "available", maps.Keys(k.entries))
	return authn.DefaultKeychain.Resolve(res)
}

// TestRegistryAuth validates that the given credentials can authenticate
// against the registry by performing the full token exchange.
func TestRegistryAuth(registry, username, password string) error {
	reg, err := name.NewRegistry(registry)
	if err != nil {
		return fmt.Errorf("invalid registry %q: %w", registry, err)
	}
	auth := authn.FromConfig(authn.AuthConfig{Username: username, Password: password})
	_, err = transport.NewWithContext(context.Background(), reg, auth, http.DefaultTransport, nil)
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}
	return nil
}

// OCIImage is a pulled OCI image (alias for v1.Image).
type OCIImage = v1.Image

// PullOCIImage pulls an OCI image from the remote registry with auth.
func PullOCIImage(ref string) (OCIImage, error) {
	parsed, err := name.ParseReference(ref)
	if err != nil {
		return nil, fmt.Errorf("invalid image reference %q: %w", ref, err)
	}
	return pullImage(parsed)
}

// ExtractPluginTarGz extracts a gzip-compressed plugin tar. With a key (the
// plugin's entity id) it uses that plugin's own directory, emptied first, so a
// crash leaves at most one per plugin. The caller removes the directory.
func ExtractPluginTarGz(r io.Reader, key string) (string, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return "", fmt.Errorf("gzip open: %w", err)
	}
	defer func() { _ = gz.Close() }()
	return extractTar(gz, key)
}

// extractPlugin extracts the plugin layer from an OCI image.
func extractPlugin(img v1.Image, key string) (string, error) {
	layers, err := img.Layers()
	if err != nil {
		return "", fmt.Errorf("read layers: %w", err)
	}
	if len(layers) == 0 {
		return "", fmt.Errorf("image has no layers")
	}

	rc, err := layers[0].Uncompressed()
	if err != nil {
		return "", fmt.Errorf("uncompress layer: %w", err)
	}
	defer rc.Close()
	return extractTar(rc, key)
}

// pluginDir returns the empty directory for key, see ExtractPluginTarGz.
func pluginDir(key string) (string, error) {
	if key == "" {
		return os.MkdirTemp(TempDir, "hydris-plugin-*")
	}
	base := TempDir
	if base == "" {
		base = filepath.Join(os.TempDir(), "hydris-plugins")
	}
	dir := filepath.Join(base, "run", dirName(key))
	if err := os.RemoveAll(dir); err != nil {
		return "", err
	}
	return dir, os.MkdirAll(dir, 0o700)
}

// dirName escapes an entity id into a directory name valid on every OS: bytes
// outside [a-z0-9-] become _XX and '_' becomes "__", so two ids never share a
// name. Long ids end in "_-" and their sha256.
func dirName(id string) string {
	tokens := make([]string, len(id))
	total := 0
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch {
		case c == '_':
			tokens[i] = "__"
		case i == 0 && windowsDevice(id),
			(c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-':
			tokens[i] = fmt.Sprintf("_%02X", c)
		default:
			tokens[i] = string(c)
		}
		total += len(tokens[i])
	}
	const maxName = 200 // file names may be 255 bytes; leave room
	if total <= maxName {
		return strings.Join(tokens, "")
	}
	// Whole tokens up to the room left for the marker and the hash.
	var b strings.Builder
	for _, tok := range tokens {
		if b.Len()+len(tok) > maxName-2-64 {
			break
		}
		b.WriteString(tok)
	}
	sum := sha256.Sum256([]byte(id))
	return b.String() + "_-" + hex.EncodeToString(sum[:])
}

// windowsDevice reports a reserved Windows device name (con, nul, com1, ...).
func windowsDevice(id string) bool {
	switch id {
	case "con", "prn", "aux", "nul":
		return true
	}
	return len(id) == 4 && (strings.HasPrefix(id, "com") || strings.HasPrefix(id, "lpt")) &&
		id[3] >= '0' && id[3] <= '9'
}

func extractTar(r io.Reader, key string) (string, error) {
	dir, err := pluginDir(key)
	if err != nil {
		return "", err
	}

	// Native binaries of other platforms are skipped. That needs package.json
	// before them, which is where `hydris plugin build` puts it.
	var otherPlatforms map[string]bool

	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			os.RemoveAll(dir)
			return "", fmt.Errorf("tar read: %w", err)
		}
		// Paths stay as packed. Only regular files inside the plugin are extracted.
		name := filepath.FromSlash(strings.TrimPrefix(hdr.Name, "./"))
		if hdr.Typeflag != tar.TypeReg || !filepath.IsLocal(name) || otherPlatforms[name] {
			continue
		}
		dst := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			os.RemoveAll(dir)
			return "", err
		}
		mode := os.FileMode(0o644)
		if hdr.Mode&0o111 != 0 {
			mode = 0o755
		}
		f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
		if err != nil {
			os.RemoveAll(dir)
			return "", err
		}
		if _, err := io.Copy(f, tr); err != nil {
			f.Close()
			os.RemoveAll(dir)
			return "", err
		}
		f.Close()
		if name == "package.json" {
			otherPlatforms = nativeOfOtherPlatforms(dir)
		}
	}
	return dir, nil
}

// nativeOfOtherPlatforms lists the hydris.native binaries in dir's
// package.json that this platform does not run.
func nativeOfOtherPlatforms(dir string) map[string]bool {
	pkg, err := ReadPackageJSON(dir)
	if err != nil || pkg.Hydris == nil {
		return nil
	}
	other := map[string]bool{}
	for platform, rel := range pkg.Hydris.Native {
		if platform != Platform() {
			other[filepath.FromSlash(rel)] = true
		}
	}
	// A binary shared by several platforms (a script, say) is still needed.
	if rel, ok := pkg.Hydris.Native[Platform()]; ok {
		delete(other, filepath.FromSlash(rel))
	}
	return other
}

// ErrIncompatibleVersion is wrapped into the error CheckHydrisVersion returns
// when the running hydris is outside a plugin's engines.hydris range, so the
// run path can treat it as a conflict rather than a transient failure.
var ErrIncompatibleVersion = errors.New("incompatible hydris version")

// CheckHydrisVersion validates the given hydris version against the
// engines.hydris semver range from package.json.
func CheckHydrisVersion(pkg *Package, hydrisVersion string) error {
	if pkg.Hydris == nil || pkg.Hydris.Compat == "" {
		return nil
	}
	raw := strings.TrimPrefix(hydrisVersion, "v")
	// Tagless builds stamp a bare git hash (e.g. "6216017"), which ParseTolerant
	// would coerce into a fake semver instead of rejecting. Real semvers have dots.
	if !strings.Contains(raw, ".") {
		slog.Warn("skipping version check (bare/dev version, not a semver)", "version", hydrisVersion)
		return nil
	}
	cur, err := semver.ParseTolerant(raw)
	if err != nil {
		slog.Warn("skipping version check (unparseable version)", "version", hydrisVersion)
		return nil
	}
	rng, err := semver.ParseRange(pkg.Hydris.Compat)
	if err != nil {
		return fmt.Errorf("invalid engines.hydris range %q: %w", pkg.Hydris.Compat, err)
	}
	if !rng(cur) {
		return fmt.Errorf("requires hydris %s (running %s): %w", pkg.Hydris.Compat, hydrisVersion, ErrIncompatibleVersion)
	}
	return nil
}
