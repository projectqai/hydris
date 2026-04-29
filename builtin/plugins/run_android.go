//go:build android

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

	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/pkg/plugin"
	"github.com/projectqai/hydris/pkg/rt"
	"github.com/projectqai/hydris/pkg/version"
)

// runPlugin runs a plugin in-process using the goja JS runtime.
// On Android we cannot spawn subprocesses, so plugins are executed directly.
func runPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	ext := filepath.Ext(info.Ref)
	if ext == ".ts" || ext == ".js" {
		return fmt.Errorf("local file plugins are not supported on Android; use an OCI image built with `hydris plugin build`")
	}

	if strings.HasPrefix(info.Ref, "artifact://") {
		return runArtifactPlugin(ctx, logger, info, serverURL)
	}

	logger.Info("starting plugin in-process", "name", info.Name, "ref", info.Ref)

	bundlePath, dataDir, cleanup, err := plugin.ResolveOCI(info.Ref, version.Version)
	if err != nil {
		return err
	}
	defer cleanup()

	return rt.RunPluginEnv(ctx, bundlePath, dataDir, "http://"+serverURL)
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
	return rt.RunPluginEnv(ctx, bundlePath, dataDir, "http://"+serverURL)
}
