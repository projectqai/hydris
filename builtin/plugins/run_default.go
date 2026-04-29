//go:build !android

package plugins

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/pkg/plugin"
	"github.com/projectqai/hydris/pkg/rt"
	"github.com/projectqai/hydris/pkg/version"
)

// runPlugin runs a plugin in-process using the goja runtime.
// Local .ts/.js files are bundled with esbuild first.
// OCI images are pulled and extracted, then the bundle is run.
// artifact:// refs load plugins from the local artifact store.
func runPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	if isLocalRef(info.Ref) {
		return runLocalPlugin(ctx, logger, info, serverURL)
	}
	if strings.HasPrefix(info.Ref, "artifact://") {
		return runArtifactPlugin(ctx, logger, info, serverURL)
	}
	return runOCIPlugin(ctx, logger, info, serverURL)
}

func runLocalPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	logger.Info("starting plugin in-process", "name", info.Name, "ref", info.Ref)

	abs, err := filepath.Abs(info.Ref)
	if err != nil {
		return fmt.Errorf("resolve path: %w", err)
	}

	bundlePath, err := bundleToTempFile(abs)
	if err != nil {
		return err
	}
	defer os.Remove(bundlePath)

	dataDir := rt.FindDataDir(abs)
	return rt.RunPluginEnv(ctx, bundlePath, dataDir, serverURL)
}

func runOCIPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	logger.Info("starting plugin in-process", "name", info.Name, "ref", info.Ref)

	bundlePath, dataDir, cleanup, err := plugin.ResolveOCI(info.Ref, version.Version)
	if err != nil {
		return err
	}
	defer cleanup()

	return rt.RunPluginEnv(ctx, bundlePath, dataDir, serverURL)
}

func runArtifactPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	artEntityID := strings.TrimPrefix(info.Ref, "artifact://")
	logger.Info("starting artifact plugin in-process", "name", info.Name, "artifact", artEntityID)

	store := artifacts.Server.Local()

	rc, err := store.Get(ctx, artEntityID)
	if err != nil {
		return fmt.Errorf("open artifact %s: %w", artEntityID, err)
	}
	defer rc.Close()

	gz, err := gzip.NewReader(rc)
	if err != nil {
		return fmt.Errorf("gzip open: %w", err)
	}
	defer func() { _ = gz.Close() }()

	dir, err := os.MkdirTemp(plugin.TempDir, "hydris-plugin-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar read: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg || strings.Contains(hdr.Name, "..") {
			continue
		}
		dst := filepath.Join(dir, filepath.Base(hdr.Name))
		f, err := os.Create(dst)
		if err != nil {
			return err
		}
		if _, err := io.Copy(f, tr); err != nil {
			f.Close()
			return err
		}
		f.Close()
	}

	bundlePath := filepath.Join(dir, "bundle.js")
	if _, err := os.Stat(bundlePath); err != nil {
		return fmt.Errorf("artifact plugin missing bundle.js")
	}

	dataDir := rt.FindDataDir(bundlePath)
	return rt.RunPluginEnv(ctx, bundlePath, dataDir, serverURL)
}

// bundleToTempFile bundles a .ts file with esbuild and writes to a temp file.
func bundleToTempFile(input string) (string, error) {
	if strings.HasSuffix(input, ".js") {
		return input, nil // already JS, no bundling needed
	}

	tmp, err := os.CreateTemp("", "hydris-plugin-*.js")
	if err != nil {
		return "", err
	}
	tmp.Close()

	result := api.Build(api.BuildOptions{
		EntryPoints: []string{input},
		Bundle:      true,
		Format:      api.FormatESModule,
		Target:      api.ES2017,
		Outfile:     tmp.Name(),
		Write:       true,
		Supported: map[string]bool{
			"top-level-await": true,
		},
	})
	if len(result.Errors) > 0 {
		os.Remove(tmp.Name())
		return "", fmt.Errorf("esbuild: %s", result.Errors[0].Text)
	}

	return tmp.Name(), nil
}
