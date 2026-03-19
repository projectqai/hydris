//go:build android

package plugins

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/projectqai/hydris/cli"
	"github.com/projectqai/hydris/pkg/plugin"
	"github.com/projectqai/hydris/pkg/rt"
)

// runPlugin runs a plugin in-process using the goja JS runtime.
// On Android we cannot spawn subprocesses, so plugins are executed directly.
func runPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string, dockerCfgDir string) error {
	ext := filepath.Ext(info.Ref)
	if ext == ".ts" || ext == ".js" {
		return fmt.Errorf("local file plugins are not supported on Android; use an OCI image built with `hydris plugin build`")
	}

	logger.Info("starting plugin in-process", "name", info.Name, "ref", info.Ref)

	if dockerCfgDir != "" {
		os.Setenv("DOCKER_CONFIG", dockerCfgDir)
	}

	bundlePath, dataDir, cleanup, err := plugin.ResolveOCI(info.Ref, cli.HydrisVersion)
	if err != nil {
		return err
	}
	defer cleanup()

	return rt.RunPluginEnv(ctx, bundlePath, dataDir, "http://"+serverURL)
}
