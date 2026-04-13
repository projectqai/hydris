package plugin

import (
	"archive/tar"
	"context"
	"encoding/json"
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
var TempDir string

// Package mirrors the relevant fields of a plugin's package.json.
type Package struct {
	Name    string   `json:"name"`
	Version string   `json:"version"`
	Main    string   `json:"main"`
	Files   []string `json:"files,omitempty"`
	Hydris  *struct {
		Compat string `json:"compat,omitempty"`
	} `json:"hydris,omitempty"`
}

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
func ResolveOCI(ref string, hydrisVersion string) (bundlePath, dataDir string, cleanup func(), err error) {
	noop := func() {}

	parsed, err := name.ParseReference(ref)
	if err != nil {
		return "", "", noop, fmt.Errorf("invalid image reference %q: %w", ref, err)
	}

	img, err := pullImage(parsed)
	if err != nil {
		return "", "", noop, fmt.Errorf("pull %s: %w", ref, err)
	}

	dir, err := extractPlugin(img)
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
	conn, err := builtin.BuiltinClientConn()
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

// extractPlugin extracts the plugin layer from an OCI image into a temp dir.
func extractPlugin(img v1.Image) (string, error) {
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

	dir, err := os.MkdirTemp(TempDir, "hydris-plugin-*")
	if err != nil {
		return "", err
	}

	tr := tar.NewReader(rc)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			os.RemoveAll(dir)
			return "", fmt.Errorf("tar read: %w", err)
		}
		// Only extract regular files, skip directories and anything with path traversal.
		if hdr.Typeflag != tar.TypeReg || strings.Contains(hdr.Name, "..") {
			continue
		}
		dst := filepath.Join(dir, filepath.Base(hdr.Name))
		f, err := os.Create(dst)
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
	}
	return dir, nil
}

// CheckHydrisVersion validates the given hydris version against the
// engines.hydris semver range from package.json.
func CheckHydrisVersion(pkg *Package, hydrisVersion string) error {
	if pkg.Hydris == nil || pkg.Hydris.Compat == "" {
		return nil
	}
	raw := strings.TrimPrefix(hydrisVersion, "v")
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
		return fmt.Errorf("plugin requires hydris %s (running %s)", pkg.Hydris.Compat, hydrisVersion)
	}
	return nil
}
