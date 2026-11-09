package plugin_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/registry"
	"github.com/google/go-containerregistry/pkg/v1/empty"
	"github.com/google/go-containerregistry/pkg/v1/mutate"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/tarball"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/pkg/plugin"
	pb "github.com/projectqai/proto/go"
	_goconnect "github.com/projectqai/proto/go/_goconnect"
)

// basicAuthHandler wraps an http.Handler with HTTP Basic authentication.
func basicAuthHandler(h http.Handler, user, pass string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, p, ok := r.BasicAuth()
		if !ok || u != user || p != pass {
			w.Header().Set("WWW-Authenticate", `Basic realm="test"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// buildTestPluginImage creates a minimal OCI image with a single layer
// containing package.json and bundle.js.
func buildTestPluginImage(t *testing.T) (name.Reference, string) {
	t.Helper()

	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	pkgJSON := []byte(`{"name":"test-plugin","version":"0.0.1","main":"bundle.js"}`)
	if err := tw.WriteHeader(&tar.Header{Name: "package.json", Size: int64(len(pkgJSON)), Mode: 0644}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(pkgJSON); err != nil {
		t.Fatal(err)
	}

	bundleJS := []byte(`console.log("test plugin");`)
	if err := tw.WriteHeader(&tar.Header{Name: "bundle.js", Size: int64(len(bundleJS)), Mode: 0644}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(bundleJS); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}

	tarBytes := buf.Bytes()
	layer, err := tarball.LayerFromOpener(func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(tarBytes)), nil
	})
	if err != nil {
		t.Fatal(err)
	}

	img, err := mutate.AppendLayers(empty.Image, layer)
	if err != nil {
		t.Fatal(err)
	}

	// Start a local registry with basic auth and push the image.
	const (
		testUser = "testuser"
		testPass = "testpass"
	)
	regHandler := basicAuthHandler(registry.New(), testUser, testPass)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: regHandler}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	addr := ln.Addr().String()
	ref, err := name.ParseReference(fmt.Sprintf("%s/test-plugin:latest", addr))
	if err != nil {
		t.Fatal(err)
	}

	auth := authn.FromConfig(authn.AuthConfig{Username: testUser, Password: testPass})
	if err := remote.Write(ref, img, remote.WithAuth(auth)); err != nil {
		t.Fatal(err)
	}

	return ref, addr
}

// startWorldOnBufconn starts a WorldServer served on the builtin bufconn
// listener, matching the production wiring.
func startWorldOnBufconn(t *testing.T) *engine.WorldServer {
	t.Helper()

	eng := engine.NewWorldServer()
	eng.InitNodeIdentity()

	mux := http.NewServeMux()
	worldPath, worldHandler := _goconnect.NewWorldServiceHandler(eng)
	mux.Handle(worldPath, worldHandler)

	var protos http.Protocols
	protos.SetHTTP1(true)
	protos.SetUnencryptedHTTP2(true)
	srv := &http.Server{
		Handler:   mux,
		Protocols: &protos,
	}
	go func() {
		if err := srv.Serve(builtin.GetBuiltinListener()); err != nil && err != http.ErrServerClosed {
			t.Logf("builtin server error: %v", err)
		}
	}()
	t.Cleanup(func() { _ = srv.Close() })

	time.Sleep(50 * time.Millisecond)
	return eng
}

func pushRegistryEntity(t *testing.T, eng *engine.WorldServer, registryAddr, user, pass string) {
	t.Helper()

	configValue, err := structpb.NewStruct(map[string]interface{}{
		"registry": registryAddr,
		"username": user,
		"password": pass,
	})
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	_, err = eng.Push(context.Background(), connect.NewRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id:    "registry-test",
			Label: ptr("test-registry"),
			Device: &pb.DeviceComponent{
				Class: ptr("registry"),
			},
			Config: &pb.ConfigurationComponent{
				Value: configValue,
			},
			Lifetime: &pb.Lifetime{
				From:  timestamppb.New(now),
				Until: timestamppb.New(now.Add(5 * time.Minute)),
				Fresh: timestamppb.New(now),
			},
		}},
	}))
	if err != nil {
		t.Fatal(err)
	}
}

func ptr(s string) *string { return &s }

func TestRegistryKeychainFromWorld(t *testing.T) {
	_, regAddr := buildTestPluginImage(t)
	eng := startWorldOnBufconn(t)

	// Without registry entity, pull must fail with 401.
	_, _, _, err := plugin.ResolveOCI(fmt.Sprintf("%s/test-plugin:latest", regAddr), "0.0.1", "")
	if err == nil {
		t.Fatal("expected pull to fail without credentials")
	}

	// Push registry credentials into the world.
	pushRegistryEntity(t, eng, regAddr, "testuser", "testpass")

	// Now pull should succeed via the bufconn keychain.
	bundlePath, _, cleanup, err := plugin.ResolveOCI(fmt.Sprintf("%s/test-plugin:latest", regAddr), "0.0.1", "")
	if err != nil {
		t.Fatalf("pull should succeed with credentials: %v", err)
	}
	defer cleanup()

	if bundlePath == "" {
		t.Fatal("expected non-empty bundle path")
	}
}

func newHydrisPkg(t *testing.T, compat string) *plugin.Package {
	t.Helper()
	var pkg plugin.Package
	data := fmt.Sprintf(`{"name":"test-plugin","version":"0.0.1","hydris":{"compat":%q}}`, compat)
	if err := json.Unmarshal([]byte(data), &pkg); err != nil {
		t.Fatalf("unmarshal package.json: %v", err)
	}
	return &pkg
}

// makeOCIPluginTarball writes an OCI image tarball like `hydris plugin build`:
// a gzip'd layer (package.json + bundle.js) wrapped in an image. Returns its path.
func makeOCIPluginTarball(t *testing.T, bundle string) string {
	t.Helper()

	var layerBuf bytes.Buffer
	gz := gzip.NewWriter(&layerBuf)
	tw := tar.NewWriter(gz)
	files := []struct{ name, data string }{
		{"package.json", `{"name":"hello","version":"0.0.1","main":"index.ts"}`},
		{"bundle.js", bundle},
	}
	for _, f := range files {
		if err := tw.WriteHeader(&tar.Header{Name: f.name, Size: int64(len(f.data)), Mode: 0o644}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(f.data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}

	layer, err := tarball.LayerFromReader(bytes.NewReader(layerBuf.Bytes()), //nolint:staticcheck // SA1019 deprecated but no replacement available
		tarball.WithMediaType("application/vnd.hydris.plugin.v1.tar+gzip"))
	if err != nil {
		t.Fatal(err)
	}
	img, err := mutate.AppendLayers(empty.Image, layer)
	if err != nil {
		t.Fatal(err)
	}
	ref, err := name.NewTag("hello:0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "hello_0.0.1.tar")
	if err := tarball.WriteToFile(path, ref, img); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestArtifactPluginExtractsOCITarball guards the artifact:// path against the
// "gzip: invalid header" regression: a plugin build tarball must extract without
// manual unwrapping. Mirrors runArtifactPlugin's chain (parse → layer → gunzip);
// the old code gunzipped the raw tarball and failed.
func TestArtifactPluginExtractsOCITarball(t *testing.T) {
	const bundle = `console.log("[hello] running")`
	ociPath := makeOCIPluginTarball(t, bundle)

	img, err := tarball.Image(func() (io.ReadCloser, error) { return os.Open(ociPath) }, nil)
	if err != nil {
		t.Fatalf("open OCI tarball: %v", err)
	}
	layers, err := img.Layers()
	if err != nil {
		t.Fatal(err)
	}
	if len(layers) == 0 {
		t.Fatal("no layers")
	}
	rc, err := layers[0].Compressed()
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()

	dir, err := plugin.ExtractPluginTarGz(rc, "")
	if err != nil {
		t.Fatalf("ExtractPluginTarGz on layer: %v", err)
	}
	defer os.RemoveAll(dir)

	got, err := os.ReadFile(filepath.Join(dir, "bundle.js"))
	if err != nil {
		t.Fatalf("read bundle.js: %v", err)
	}
	if string(got) != bundle {
		t.Fatalf("bundle.js = %q, want %q", got, bundle)
	}
	if _, err := os.Stat(filepath.Join(dir, "package.json")); err != nil {
		t.Fatalf("package.json missing: %v", err)
	}
}

func TestCheckHydrisVersion(t *testing.T) {
	const compat = ">=0.0.20 <0.1.0"
	pkg := newHydrisPkg(t, compat)

	tests := []struct {
		name          string
		hydrisVersion string
		wantErr       bool
	}{
		{"in range", "0.0.20", false},
		{"out of range", "0.2.0", true},
		{"all-digit bare git hash", "6216017", false},
		{"all-digit bare git hash dirty", "6216017-dirty", false},
		{"letter bare git hash", "b803049", false},
		{"letter bare git hash dirty", "b803049-dirty", false},
		{"unparseable version", "notaversion", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := plugin.CheckHydrisVersion(pkg, tt.hydrisVersion)
			if tt.wantErr && err == nil {
				t.Fatalf("CheckHydrisVersion(%q) = nil, want error", tt.hydrisVersion)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("CheckHydrisVersion(%q) = %v, want nil", tt.hydrisVersion, err)
			}
		})
	}
}
