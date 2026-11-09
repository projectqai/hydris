//go:build !android

package plugins_test

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/projectqai/hydris/builtin/plugins"
)

// buildNativePlugin compiles testdata/nativeplugin into a plugin directory.
func buildNativePlugin(t *testing.T) (dir, bin string) {
	t.Helper()
	dir = t.TempDir()
	bin = filepath.Join(dir, "plugin")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	out, err := exec.Command("go", "build", "-o", bin, "./testdata/nativeplugin").CombinedOutput()
	if err != nil {
		t.Fatalf("build test plugin: %v\n%s", err, out)
	}
	manifest := `{"name":"native-test","hydris":{"native":{"` + runtime.GOOS + "/" + runtime.GOARCH + `":"` + filepath.Base(bin) + `"}}}`
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir, bin
}

func TestNativePluginRunsAsItsActor(t *testing.T) {
	startEngine(t)
	dir, bin := buildNativePlugin(t)
	info := plugins.PluginInfo{Name: "native-test", EntityID: "plugins.native-test"}

	t.Setenv("NATIVE_TEST_SECRET", "leaked")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- plugins.RunNative(ctx, info, dir, bin) }()

	deadline := time.Now().Add(20 * time.Second)
	for {
		if e := get(t, "nativetest.hello"); e != nil {
			if e.GetLabel() != info.EntityID+"|" {
				t.Fatalf("label = %q, want the plugin id %q and no hydris environment", e.GetLabel(), info.EntityID)
			}
			break
		}
		select {
		case err := <-done:
			t.Fatalf("plugin exited early: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("the plugin's entity never arrived")
		}
		time.Sleep(50 * time.Millisecond)
	}

	start := time.Now()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("stop: %v", err)
		}
		if time.Since(start) > 3*time.Second {
			t.Errorf("stop took %v: the plugin should exit when stdin closes", time.Since(start))
		}
	case <-time.After(10 * time.Second):
		t.Fatal("plugin did not stop")
	}
}

func TestNativePluginExitIsAnError(t *testing.T) {
	startEngine(t)
	dir, bin := buildNativePlugin(t)
	if err := os.WriteFile(filepath.Join(dir, "fail"), nil, 0o644); err != nil {
		t.Fatal(err)
	}

	err := plugins.RunNative(context.Background(), plugins.PluginInfo{Name: "native-fail", EntityID: "plugins.native-fail"}, dir, bin)
	if err == nil {
		t.Fatal("a plugin that exits must report an error, so it is restarted")
	}
}

func TestNativeGatewayRefusesWithoutToken(t *testing.T) {
	startEngine(t)
	info := plugins.PluginInfo{Name: "gw", EntityID: "plugins.gw"}
	if err := plugins.PrepareActors(context.Background(), info, ""); err != nil {
		t.Fatal(err)
	}
	addr, token, closeGW, err := plugins.ServeNative("", info)
	if err != nil {
		t.Fatal(err)
	}
	defer closeGW()

	for _, auth := range []string{"", "Bearer wrong", token} {
		req, _ := http.NewRequest("POST", "http://"+addr+"/world.WorldService/ListEntities", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("auth %q: status %d, want 401", auth, resp.StatusCode)
		}
	}

	req, _ := http.NewRequest("POST", "http://"+addr+"/world.WorldService/ListEntities", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("with the token: status %d, want 200", resp.StatusCode)
	}
}
