//go:build android

package plugins

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/pkg/plugin"
	"github.com/projectqai/hydris/pkg/rt"
	"github.com/projectqai/hydris/pkg/version"
	pb "github.com/projectqai/proto/go"
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

	return runOCIPlugin(ctx, logger, info, serverURL)
}

func runOCIPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	logger.Info("starting plugin in-process", "name", info.Name, "ref", info.Ref)

	if info.EntityID == "" || artifacts.Server == nil {
		return runOCIPluginDirect(ctx, info, serverURL)
	}

	store := artifacts.Server.Local()
	artID := info.EntityID

	if ok, _ := store.Exists(ctx, artID); ok && ociCacheMatchesRef(ctx, info.EntityID, info.Ref) {
		logger.Info("using cached OCI plugin", "ref", info.Ref)
		return runCachedPlugin(ctx, store, artID, info.Ref, "http://"+serverURL)
	}

	img, err := plugin.PullOCIImage(info.Ref)
	if err != nil {
		return fmt.Errorf("pull %s: %w", info.Ref, err)
	}

	if err := cacheOCILayer(ctx, logger, store, artID, info.EntityID, info.Ref, img); err != nil {
		logger.Warn("failed to cache OCI plugin", "error", err)
		return runOCIPluginDirect(ctx, info, serverURL)
	}

	return runCachedPlugin(ctx, store, artID, info.Ref, "http://"+serverURL)
}

func runOCIPluginDirect(ctx context.Context, info PluginInfo, serverURL string) error {
	bundlePath, dataDir, cleanup, err := plugin.ResolveOCI(info.Ref, version.Version)
	if err != nil {
		return err
	}
	defer cleanup()
	return rt.RunPluginEnv(ctx, bundlePath, dataDir, "http://"+serverURL)
}

func ociCacheMatchesRef(ctx context.Context, entityID, ref string) bool {
	conn, err := builtin.BuiltinClientConn("plugins")
	if err != nil {
		return false
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)
	resp, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: entityID})
	if err != nil || resp.Entity == nil || resp.Entity.Artifact == nil {
		return false
	}
	for _, loc := range resp.Entity.Artifact.Location {
		if loc.Url == ref {
			return true
		}
	}
	return false
}

func cacheOCILayer(ctx context.Context, logger *slog.Logger, store *artifacts.LocalStore, artID, entityID, ref string, img plugin.OCIImage) error {
	layers, err := img.Layers()
	if err != nil {
		return fmt.Errorf("read layers: %w", err)
	}
	if len(layers) == 0 {
		return fmt.Errorf("image has no layers")
	}
	rc, err := layers[0].Compressed()
	if err != nil {
		return fmt.Errorf("read compressed layer: %w", err)
	}
	if err := store.Put(ctx, artID, rc); err != nil {
		rc.Close()
		return fmt.Errorf("store artifact: %w", err)
	}
	rc.Close()

	_ = controller.Push(ctx, controllerName, &pb.Entity{
		Id: entityID,
		Artifact: &pb.ArtifactComponent{
			Id:          artID,
			ContentType: "application/vnd.hydris.plugin.v1.tar+gzip",
			Location:    []*pb.ArtifactLocation{{Url: ref}},
		},
	})

	logger.Info("cached OCI plugin as artifact", "ref", ref, "artifact", artID)
	return nil
}

func runCachedPlugin(ctx context.Context, store *artifacts.LocalStore, artID, ref, serverURL string) error {
	rc, err := store.Get(ctx, artID)
	if err != nil {
		return fmt.Errorf("open cached artifact %s: %w", artID, err)
	}
	defer rc.Close()

	dir, err := plugin.ExtractPluginTarGz(rc)
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	if err := checkBundleCompat(dir); err != nil {
		return err
	}

	bundlePath := filepath.Join(dir, "bundle.js")
	if _, err := os.Stat(bundlePath); err != nil {
		return fmt.Errorf("plugin %q does not contain bundle.js", ref)
	}

	dataDir := rt.FindDataDir(bundlePath)
	return rt.RunPluginEnv(ctx, bundlePath, dataDir, serverURL)
}

func runArtifactPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	artEntityID := strings.TrimPrefix(info.Ref, "artifact://")
	logger.Info("starting artifact plugin in-process", "name", info.Name, "artifact", artEntityID)

	store := artifacts.Server.Local()
	return runCachedPlugin(ctx, store, artEntityID, info.Ref, "http://"+serverURL)
}
