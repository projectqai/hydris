package engine

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/projectqai/hydris/pkg/plugin"
	"github.com/projectqai/hydris/pkg/rt"
)

// handlePluginDev handles POST /plugin/dev.
// Body: gzipped tar archive containing bundle.js + data files.
// Response: kept open, streams plugin logs until the client disconnects.
// When the client disconnects, the plugin context is cancelled.
func handlePluginDev(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	// Extract tar to temp dir.
	tmpDir, err := os.MkdirTemp(plugin.TempDir, "hydris-plugindev-*")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(tmpDir)

	if err := extractTar(r.Body, tmpDir); err != nil {
		http.Error(w, fmt.Sprintf("extract tar: %v", err), http.StatusBadRequest)
		return
	}

	// Find bundle.js.
	bundlePath := filepath.Join(tmpDir, "bundle.js")
	if _, err := os.Stat(bundlePath); err != nil {
		http.Error(w, "bundle.js not found in archive", http.StatusBadRequest)
		return
	}

	// Stream logs back to client.
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Transfer-Encoding", "chunked")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Use request context — cancelled when client disconnects.
	ctx := r.Context()

	// Create a writer that flushes after each write.
	logWriter := &flushWriter{w: w, f: flusher}

	fmt.Fprintln(logWriter, "plugin loaded, running...")
	slog.Info("plugin/dev: loaded plugin", "dir", tmpDir)

	// Run plugin in-process. Blocks until ctx cancelled (client disconnect).
	pluginRT := rt.New(tmpDir, rt.WithLogWriter(logWriter))
	err = pluginRT.RunFile(ctx, bundlePath)
	if err != nil && ctx.Err() == nil {
		fmt.Fprintf(logWriter, "plugin crashed: %v\n", err)
	}

	slog.Info("plugin/dev: plugin stopped", "dir", tmpDir)
}

// extractTar extracts a gzipped tar archive to dir.
func extractTar(r io.Reader, dir string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		// Maybe not gzipped — try plain tar.
		return extractPlainTar(r, dir)
	}
	defer func() { _ = gz.Close() }()
	return extractPlainTar(gz, dir)
}

func extractPlainTar(r io.Reader, dir string) error {
	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		// Sanitize path to prevent directory traversal.
		name := filepath.Clean(hdr.Name)
		if strings.HasPrefix(name, "..") {
			continue
		}
		target := filepath.Join(dir, name)

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			f, err := os.Create(target)
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				return err
			}
			f.Close()
		}
	}
}

type flushWriter struct {
	w io.Writer
	f http.Flusher
}

func (fw *flushWriter) Write(p []byte) (int, error) {
	n, err := fw.w.Write(p)
	fw.f.Flush()
	return n, err
}
