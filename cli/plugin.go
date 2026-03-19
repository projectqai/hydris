package cli

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/fsnotify/fsnotify"
	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/daemon"
	"github.com/google/go-containerregistry/pkg/v1/empty"
	"github.com/google/go-containerregistry/pkg/v1/mutate"
	"github.com/google/go-containerregistry/pkg/v1/tarball"
	"github.com/google/go-containerregistry/pkg/v1/types"
	"github.com/projectqai/hydris/pkg/plugin"
	"github.com/projectqai/hydris/pkg/rt"
	"github.com/spf13/cobra"
)

const pluginMediaType = types.MediaType("application/vnd.hydris.plugin.v1.tar+gzip")

var pluginCmd = &cobra.Command{
	Use:   "plugin",
	Short: "build, publish and run hydris plugins",
}

// --- plugin build ---

var pluginBuildTag string

var pluginBuildCmd = &cobra.Command{
	Use:   "build [dir]",
	Short: "bundle a TypeScript plugin into an OCI image",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) > 0 {
			dir = args[0]
		}
		dir, err := filepath.Abs(dir)
		if err != nil {
			return err
		}

		pkg, err := plugin.ReadPackageJSON(dir)
		if err != nil {
			return err
		}
		if pkg.Name == "" || pkg.Main == "" {
			return fmt.Errorf("package.json must have name and main fields")
		}

		tag := pluginBuildTag
		if tag == "" {
			// Sanitize npm-style scoped names for OCI: @scope/name → scope/name
			n := strings.TrimPrefix(pkg.Name, "@")
			tag = n
			if pkg.Version != "" {
				tag += ":" + pkg.Version
			}
		}

		slog.Info("bundling plugin", "entry", pkg.Main, "tag", tag)

		// Bundle TypeScript/JavaScript with esbuild.
		bundleData, err := esbuildBundle(filepath.Join(dir, pkg.Main))
		if err != nil {
			return err
		}

		// Read original package.json to include in the image.
		pkgData, err := os.ReadFile(filepath.Join(dir, "package.json"))
		if err != nil {
			return err
		}

		// Resolve data files from the "files" field in package.json.
		dataFiles, err := resolveFiles(dir, pkg.Files)
		if err != nil {
			return err
		}

		// Create the OCI layer.
		layer, err := makePluginLayer(pkgData, bundleData, dataFiles)
		if err != nil {
			return err
		}

		// Assemble OCI image.
		img, err := mutate.AppendLayers(empty.Image, layer)
		if err != nil {
			return fmt.Errorf("append layer: %w", err)
		}

		ref, err := name.NewTag(tag)
		if err != nil {
			return fmt.Errorf("invalid tag %q: %w", tag, err)
		}

		// Load into local Docker daemon.
		if _, err := daemon.Write(ref, img); err != nil {
			return fmt.Errorf("daemon write: %w", err)
		}

		slog.Info("image loaded into docker daemon", "ref", ref.String())
		return nil
	},
}

// --- plugin run ---

var pluginWatch bool
var pluginServer string

var pluginRunCmd = &cobra.Command{
	Use:   "run <file.ts|file.js|image-ref>",
	Short: "run a plugin from a local file or OCI image",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if pluginServer != "" {
			os.Setenv("HYDRIS_SERVER", pluginServer)
		}
		ctx := context.Background()

		arg := args[0]
		if pluginWatch && isLocalFile(arg) {
			input, err := filepath.Abs(arg)
			if err != nil {
				return err
			}
			return watchAndRun(ctx, input)
		}
		return RunPlugin(ctx, arg)
	},
}

func init() {
	pluginBuildCmd.Flags().StringVarP(&pluginBuildTag, "tag", "t", "", "image tag (default: <name>:<version> from package.json)")

	pluginRunCmd.Flags().BoolVar(&pluginWatch, "watch", false, "watch source directory, rebuild and restart on changes")
	pluginRunCmd.Flags().StringVar(&pluginServer, "server", "", "hydris server address (sets HYDRIS_SERVER)")

	pluginCmd.AddCommand(pluginBuildCmd)
	pluginCmd.AddCommand(pluginRunCmd)
	CMD.AddCommand(pluginCmd)
}

// --- OCI helpers ---

// esbuildBundle compiles a TypeScript/JavaScript entry point and returns the
// bundled source as bytes (no temp file).
func esbuildBundle(entry string) ([]byte, error) {
	result := api.Build(api.BuildOptions{
		EntryPoints: []string{entry},
		Bundle:      true,
		Format:      api.FormatESModule,
		Target:      api.ES2017,
		Write:       false,
		Supported: map[string]bool{
			"top-level-await": true,
		},
	})
	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("esbuild: %s", result.Errors[0].Text)
	}
	if len(result.OutputFiles) == 0 {
		return nil, fmt.Errorf("esbuild produced no output")
	}
	return result.OutputFiles[0].Contents, nil
}

// pluginFile is a name+data pair to include in the OCI plugin layer.
type pluginFile struct {
	name string
	data []byte
}

// resolveFiles expands glob patterns from the package.json "files" field
// relative to dir and returns the matched files with their contents.
func resolveFiles(dir string, patterns []string) ([]pluginFile, error) {
	var files []pluginFile
	seen := make(map[string]bool)
	for _, pat := range patterns {
		matches, err := filepath.Glob(filepath.Join(dir, pat))
		if err != nil {
			return nil, fmt.Errorf("invalid files pattern %q: %w", pat, err)
		}
		for _, m := range matches {
			info, err := os.Stat(m)
			if err != nil || info.IsDir() {
				continue
			}
			rel, _ := filepath.Rel(dir, m)
			if seen[rel] {
				continue
			}
			seen[rel] = true
			data, err := os.ReadFile(m)
			if err != nil {
				return nil, fmt.Errorf("read %s: %w", rel, err)
			}
			files = append(files, pluginFile{name: rel, data: data})
		}
	}
	return files, nil
}

// makePluginLayer creates a gzipped tar layer containing package.json,
// bundle.js, and any data files declared in the "files" field.
func makePluginLayer(pkgJSON, bundle []byte, extra []pluginFile) (v1.Layer, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)

	files := append([]pluginFile{
		{"package.json", pkgJSON},
		{"bundle.js", bundle},
	}, extra...)

	for _, f := range files {
		if err := tw.WriteHeader(&tar.Header{
			Name: f.name,
			Size: int64(len(f.data)),
			Mode: 0644,
		}); err != nil {
			return nil, err
		}
		if _, err := tw.Write(f.data); err != nil {
			return nil, err
		}
	}

	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}

	return tarball.LayerFromReader(&buf, tarball.WithMediaType(pluginMediaType)) //nolint:staticcheck // SA1019 deprecated but no replacement available
}

// runFromOCI pulls an image, extracts the plugin, checks version constraints
// and runs the bundle.
func runFromOCI(ctx context.Context, ref string) error {
	bundlePath, dataDir, cleanup, err := plugin.ResolveOCI(ref, HydrisVersion)
	if err != nil {
		return err
	}
	defer cleanup()
	return rt.RunPlugin(ctx, bundlePath, dataDir)
}

// RunPlugin runs a plugin from a local file or OCI image reference.
// It autodetects whether arg is a local path or an OCI ref.
func RunPlugin(ctx context.Context, arg string) error {
	if isLocalFile(arg) {
		input, err := filepath.Abs(arg)
		if err != nil {
			return err
		}
		return buildAndRun(ctx, input)
	}
	return runFromOCI(ctx, arg)
}

// isLocalFile returns true if arg looks like a local file path rather than
// an OCI image reference.
func isLocalFile(arg string) bool {
	ext := filepath.Ext(arg)
	if ext == ".ts" || ext == ".js" {
		return true
	}
	_, err := os.Stat(arg)
	return err == nil
}

// --- local file helpers ---

func esbuildToFile(input, output string) error {
	result := api.Build(api.BuildOptions{
		EntryPoints: []string{input},
		Bundle:      true,
		Format:      api.FormatESModule,
		Target:      api.ES2017,
		Outfile:     output,
		Write:       true,
		Supported: map[string]bool{
			"top-level-await": true,
		},
	})
	if len(result.Errors) > 0 {
		return fmt.Errorf("esbuild: %s", result.Errors[0].Text)
	}
	return nil
}

func buildAndRun(ctx context.Context, input string) error {
	jsPath, cleanup, err := ensureBundle(input)
	if err != nil {
		return err
	}
	defer cleanup()
	dataDir := rt.FindDataDir(input)
	return rt.RunPlugin(ctx, jsPath, dataDir)
}

func ensureBundle(input string) (jsPath string, cleanup func(), err error) {
	noop := func() {}
	if strings.HasSuffix(input, ".js") {
		return input, noop, nil
	}
	tmp, err := os.CreateTemp("", "hydris-plugin-*.js")
	if err != nil {
		return "", noop, err
	}
	tmp.Close()
	if err := esbuildToFile(input, tmp.Name()); err != nil {
		os.Remove(tmp.Name())
		return "", noop, err
	}
	return tmp.Name(), func() { os.Remove(tmp.Name()) }, nil
}

func watchAndRun(ctx context.Context, input string) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("fsnotify: %w", err)
	}
	defer watcher.Close() //nolint:errcheck // best-effort cleanup

	dir := filepath.Dir(input)
	if err := watcher.Add(dir); err != nil {
		return fmt.Errorf("watch %s: %w", dir, err)
	}

	var (
		runCtx    context.Context
		runCancel context.CancelFunc
		runDone   chan struct{}
	)

	dataDir := rt.FindDataDir(input)

	startPlugin := func() {
		jsPath, cleanup, err := ensureBundle(input)
		if err != nil {
			slog.Error("build failed", "error", err)
			return
		}
		runCtx, runCancel = context.WithCancel(ctx)
		runDone = make(chan struct{})
		go func() {
			defer close(runDone)
			defer cleanup()
			_ = rt.RunPlugin(runCtx, jsPath, dataDir)
		}()
	}

	stopPlugin := func() {
		if runCancel != nil {
			runCancel()
			<-runDone
			runCancel = nil
		}
	}

	startPlugin()

	var debounce *time.Timer
	for {
		select {
		case ev, ok := <-watcher.Events:
			if !ok {
				stopPlugin()
				return nil
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename) == 0 {
				continue
			}
			if debounce != nil {
				debounce.Stop()
			}
			debounce = time.AfterFunc(200*time.Millisecond, func() {
				slog.Info("change detected, rebuilding", "file", ev.Name)
				stopPlugin()
				startPlugin()
			})

		case err, ok := <-watcher.Errors:
			if !ok {
				stopPlugin()
				return nil
			}
			slog.Error("watcher error", "error", err)

		case <-ctx.Done():
			stopPlugin()
			return ctx.Err()
		}
	}
}
