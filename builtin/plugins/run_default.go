//go:build !android

package plugins

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/projectqai/hydris/pkg/plugin"
	"github.com/projectqai/hydris/pkg/rt"
	"github.com/projectqai/hydris/pkg/version"
)

// runPlugin runs a plugin in-process using the goja runtime.
// Local .ts/.js files are bundled with esbuild first.
// OCI images are pulled and extracted, then the bundle is run.
func runPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	if isLocalRef(info.Ref) {
		return runLocalPlugin(ctx, logger, info, serverURL)
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
