package plugin_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"

	"github.com/projectqai/hydris/pkg/plugin"
)

// tarGz packs files, package.json first as `hydris plugin build` does.
func tarGz(t *testing.T, files map[string]int64, data map[string]string) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		return names[i] == "package.json" || (names[j] != "package.json" && names[i] < names[j])
	})
	for _, name := range names {
		mode := files[name]
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: mode, Size: int64(len(data[name]))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(data[name])); err != nil {
			t.Fatal(err)
		}
	}
	_ = tw.Close()
	_ = gz.Close()
	return &buf
}

func TestExtractKeepsPathsAndExecBit(t *testing.T) {
	platform := runtime.GOOS + "/" + runtime.GOARCH
	data := map[string]string{
		"package.json":   `{"name":"n","hydris":{"native":{"` + platform + `":"bin/run","plan9/mips":"bin/other"}}}`,
		"bin/other":      "not for this platform",
		"bin/run":        "#!/bin/sh\n",
		"../escape":      "x",
		"/abs/escape":    "x",
		"data/table.csv": "a,b\n",
	}
	dir, err := plugin.ExtractPluginTarGz(tarGz(t, map[string]int64{
		"package.json": 0o644, "bin/run": 0o755, "bin/other": 0o755, "../escape": 0o644, "/abs/escape": 0o644, "data/table.csv": 0o644,
	}, data), "")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	if _, err := os.Stat(filepath.Join(dir, "data", "table.csv")); err != nil {
		t.Errorf("subdirectory not kept: %v", err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "escape")); err == nil {
		t.Error("a ../ entry escaped the plugin directory")
	}
	if _, err := os.Stat(filepath.Join(dir, "bin", "other")); err == nil {
		t.Error("another platform's binary was extracted")
	}
	bin, err := plugin.NativeBinary(dir)
	if err != nil || bin != filepath.Join(dir, "bin", "run") {
		t.Fatalf("NativeBinary = %q, %v", bin, err)
	}
	if runtime.GOOS != "windows" {
		if st, _ := os.Stat(bin); st.Mode()&0o111 == 0 {
			t.Errorf("exec bit lost: %v", st.Mode())
		}
	}
}

func TestNativeBinaryOtherPlatform(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"n","hydris":{"native":{"plan9/mips":"x"}}}`), 0o644)
	if _, err := plugin.NativeBinary(dir); !errors.Is(err, plugin.ErrNoNativeBinary) {
		t.Errorf("err = %v, want ErrNoNativeBinary", err)
	}

	_ = os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"n","main":"index.ts"}`), 0o644)
	if bin, err := plugin.NativeBinary(dir); bin != "" || err != nil {
		t.Errorf("JS plugin: %q, %v", bin, err)
	}
}

func TestSetWorkDirClearsLeftovers(t *testing.T) {
	old := plugin.TempDir
	t.Cleanup(func() { plugin.TempDir = old })
	dir := t.TempDir()
	stale := filepath.Join(dir, "hydris-plugin-123")
	keep := filepath.Join(dir, "unrelated")
	for _, d := range []string{stale, keep} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := plugin.SetWorkDir(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stale); err == nil {
		t.Error("a leftover extraction survived")
	}
	if _, err := os.Stat(keep); err != nil {
		t.Error("an unrelated directory was removed")
	}
	if plugin.TempDir != dir {
		t.Errorf("TempDir = %q", plugin.TempDir)
	}
}

// A plugin extracts into a directory of its own: the same on every start, and
// emptied first, so a crash leaves at most one behind and the next start
// reuses it.
func TestExtractIntoThePluginsOwnDirectory(t *testing.T) {
	old := plugin.TempDir
	t.Cleanup(func() { plugin.TempDir = old })
	if err := plugin.SetWorkDir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	extract := func(id string, files map[string]string) string {
		t.Helper()
		modes := map[string]int64{}
		for name := range files {
			modes[name] = 0o644
		}
		dir, err := plugin.ExtractPluginTarGz(tarGz(t, modes, files), id)
		if err != nil {
			t.Fatal(err)
		}
		return dir
	}

	first := extract("sapient:x/1", map[string]string{"package.json": "{}", "old.txt": "1"})
	again := extract("sapient:x/1", map[string]string{"package.json": "{}", "new.txt": "2"})
	if first != again {
		t.Fatalf("a plugin's directory moved: %s, then %s", first, again)
	}
	if _, err := os.Stat(filepath.Join(again, "old.txt")); err == nil {
		t.Error("the previous extraction was not emptied first")
	}
	if got := filepath.Base(again); got != "sapient_3Ax_2F1" {
		t.Errorf("directory %q, want the escaped id", got)
	}
	if err := plugin.SetWorkDir(plugin.TempDir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(again, "new.txt")); err != nil {
		t.Error("startup must leave a plugin's own directory for its next start")
	}
}
