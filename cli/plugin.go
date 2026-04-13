package cli

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
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

		// Write OCI tarball to disk.
		outFile := strings.ReplaceAll(strings.ReplaceAll(ref.String(), "/", "_"), ":", "_") + ".tar"
		if err := tarball.WriteToFile(outFile, ref, img); err != nil {
			return fmt.Errorf("write tarball: %w", err)
		}

		slog.Info("image written", "ref", ref.String(), "file", outFile)

		// Load into Docker daemon so `docker push` can find it.
		loadCmd := exec.Command("docker", "load", "-i", outFile)
		loadCmd.Stdout = os.Stdout
		loadCmd.Stderr = os.Stderr
		if err := loadCmd.Run(); err != nil {
			return fmt.Errorf("docker load: %w", err)
		}

		return nil
	},
}

// --- plugin run ---

var pluginRunServer string

var pluginRunCmd = &cobra.Command{
	Use:   "run <file.ts|file.js>",
	Short: "bundle and load a plugin into a running engine (unloads on disconnect)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		input, err := filepath.Abs(args[0])
		if err != nil {
			return err
		}
		return runPluginDev(cmd.Context(), input, pluginRunServer)
	},
}

func runPluginDev(ctx context.Context, input, server string) error {
	// Bundle with esbuild.
	bundle, err := esbuildBundle(input)
	if err != nil {
		return fmt.Errorf("bundle: %w", err)
	}

	// Collect data files from package.json "files" field.
	dataDir := rt.FindDataDir(input)
	var extra []pluginFile
	if dataDir != "" {
		if pkg, err := plugin.ReadPackageJSON(dataDir); err == nil {
			extra, _ = resolveFiles(dataDir, pkg.Files)
		}
	}

	// Create tar archive with bundle.js + data files.
	var tarBuf bytes.Buffer
	gz := gzip.NewWriter(&tarBuf)
	tw := tar.NewWriter(gz)

	if err := tw.WriteHeader(&tar.Header{
		Name: "bundle.js",
		Size: int64(len(bundle)),
		Mode: 0o644,
	}); err != nil {
		return err
	}
	if _, err := tw.Write(bundle); err != nil {
		return err
	}

	for _, f := range extra {
		if err := tw.WriteHeader(&tar.Header{
			Name: f.name,
			Size: int64(len(f.data)),
			Mode: 0o644,
		}); err != nil {
			return err
		}
		if _, err := tw.Write(f.data); err != nil {
			return err
		}
	}

	if err := tw.Close(); err != nil {
		return err
	}
	if err := gz.Close(); err != nil {
		return err
	}

	// Upload to engine.
	url := fmt.Sprintf("http://%s/plugin/dev", server)
	slog.Info("uploading plugin to engine", "url", url, "size", tarBuf.Len())

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &tarBuf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/gzip")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("upload to engine: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("engine returned %d: %s", resp.StatusCode, string(body))
	}

	// Stream logs from engine until cancelled.
	_, err = io.Copy(os.Stdout, resp.Body)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return fmt.Errorf("disconnected: %w", err)
	}
	return fmt.Errorf("disconnected")
}

func init() {
	pluginBuildCmd.Flags().StringVarP(&pluginBuildTag, "tag", "t", "", "image tag (default: <name>:<version> from package.json)")

	pluginRunCmd.Flags().StringVar(&pluginRunServer, "server", "localhost:50051", "engine address")

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
			Mode: 0o644,
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
