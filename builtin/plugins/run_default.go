//go:build !android

package plugins

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/google/go-containerregistry/pkg/v1/tarball"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/pkg/plugin"
	"github.com/projectqai/hydris/pkg/rt"
	"github.com/projectqai/hydris/pkg/version"
	pb "github.com/projectqai/proto/go"
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
	logger.Info("starting plugin", "name", info.Name, "ref", info.Ref)

	abs, err := filepath.Abs(info.Ref)
	if err != nil {
		return fmt.Errorf("resolve path: %w", err)
	}

	if err := checkBundleCompat(filepath.Dir(abs)); err != nil {
		return err
	}
	if filepath.Base(abs) == "package.json" {
		if ok, err := runNativeDir(ctx, info, filepath.Dir(abs)); ok {
			return err
		}
		return fmt.Errorf("%w: %s declares no hydris.native binary", controller.ErrConflict, info.Ref)
	}

	bundlePath, err := bundleToTempFile(abs)
	if err != nil {
		return err
	}
	defer os.Remove(bundlePath)

	dataDir := rt.FindDataDir(abs)
	return runBundle(ctx, info, bundlePath, dataDir, serverURL)
}

func runOCIPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	logger.Info("starting plugin", "name", info.Name, "ref", info.Ref)

	if info.EntityID == "" || artifacts.Server == nil {
		return runOCIPluginDirect(ctx, info, serverURL)
	}

	store := artifacts.Server.Local()
	artID := info.EntityID

	if ok, _ := store.Exists(ctx, artID); ok && ociCacheMatchesRef(ctx, info.EntityID, info.Ref) {
		logger.Info("using cached OCI plugin", "ref", info.Ref)
		return runCachedPlugin(ctx, store, artID, info, serverURL)
	}

	img, err := plugin.PullOCIImage(info.Ref)
	if err != nil {
		return fmt.Errorf("pull %s: %w", info.Ref, err)
	}

	if err := cacheOCILayer(ctx, logger, store, artID, info.EntityID, info.Ref, img); err != nil {
		logger.Warn("failed to cache OCI plugin", "error", err)
		return runOCIPluginDirect(ctx, info, serverURL)
	}

	return runCachedPlugin(ctx, store, artID, info, serverURL)
}

func runOCIPluginDirect(ctx context.Context, info PluginInfo, serverURL string) error {
	bundlePath, dataDir, cleanup, err := plugin.ResolveOCI(info.Ref, version.Version, info.EntityID)
	if err != nil {
		return err
	}
	defer cleanup()
	if ok, err := runNativeDir(ctx, info, dataDir); ok {
		return err
	}
	return runBundle(ctx, info, bundlePath, dataDir, serverURL)
}

// ociCacheMatchesRef checks whether the cached artifact's source URL matches
// the current OCI ref. Returns false if the ref changed (triggering re-download).
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

// cacheOCILayer downloads the compressed first layer from an already-pulled
// OCI image and stores it as an artifact blob attached to the entity.
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

// runExtractedTarGz extracts a gzip'd plugin tar and runs its bundle.js. The
// OCI-cache and artifact:// paths both funnel here once they have a layer reader.
func runExtractedTarGz(ctx context.Context, r io.Reader, info PluginInfo, serverURL string) error {
	dir, err := plugin.ExtractPluginTarGz(r, info.EntityID)
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	if err := checkBundleCompat(dir); err != nil {
		return err
	}
	if ok, err := runNativeDir(ctx, info, dir); ok {
		return err
	}

	bundlePath := filepath.Join(dir, "bundle.js")
	if _, err := os.Stat(bundlePath); err != nil {
		return fmt.Errorf("plugin %q does not contain bundle.js", info.Ref)
	}

	return runBundle(ctx, info, bundlePath, rt.FindDataDir(bundlePath), serverURL)
}

// runCachedPlugin extracts a gzip-compressed tar from the artifact store and runs it.
func runCachedPlugin(ctx context.Context, store *artifacts.LocalStore, artID string, info PluginInfo, serverURL string) error {
	rc, err := store.Get(ctx, artID)
	if err != nil {
		return fmt.Errorf("open cached artifact %s: %w", artID, err)
	}
	defer rc.Close()

	return runExtractedTarGz(ctx, rc, info, serverURL)
}

// runArtifactPlugin runs a plugin from artifact://<id>, where id is the
// plugin's own entity. The blob is a
// `hydris plugin build` OCI image tarball; its first layer is the gzip'd tar
// holding bundle.js.
func runArtifactPlugin(ctx context.Context, logger *slog.Logger, info PluginInfo, serverURL string) error {
	artEntityID := strings.TrimPrefix(info.Ref, "artifact://")
	// The image must live on the plugin's own entity: authz.policy lets only
	// admin write a plugin entity, so only admin can replace the code it runs.
	if artEntityID != info.EntityID {
		return fmt.Errorf("%w: plugin %q must run from its own artifact (artifact://%s), not %s", controller.ErrConflict, info.Name, info.EntityID, info.Ref)
	}
	logger.Info("starting artifact plugin", "name", info.Name, "artifact", artEntityID)

	store := artifacts.Server.Local()

	// tarball.Image re-opens the blob per layer/manifest read, so hand it an opener.
	img, err := tarball.Image(func() (io.ReadCloser, error) {
		return store.Get(ctx, artEntityID)
	}, nil)
	if err != nil {
		return fmt.Errorf("open artifact %s as OCI image tarball: %w", artEntityID, err)
	}
	layers, err := img.Layers()
	if err != nil {
		return fmt.Errorf("read layers: %w", err)
	}
	if len(layers) == 0 {
		return fmt.Errorf("artifact %s has no layers", artEntityID)
	}
	rc, err := layers[0].Compressed()
	if err != nil {
		return fmt.Errorf("read plugin layer: %w", err)
	}
	defer rc.Close()

	return runExtractedTarGz(ctx, rc, info, serverURL)
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
