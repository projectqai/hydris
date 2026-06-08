package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/projectqai/hydris/pkg/missionpkg"
)

func TestRunDiagnosticInspect_DiagnosticPack(t *testing.T) {
	dir := t.TempDir()
	packPath := filepath.Join(dir, "test.tar.gz")

	f, err := os.Create(packPath)
	if err != nil {
		t.Fatal(err)
	}
	p := missionpkg.NewPacker(f, time.Date(2026, 5, 20, 12, 0, 0, 0, time.UTC))
	p.WriteWorld([]byte("id: e1\n---\nid: e2\n---\nid: e3\n"))
	p.WriteIndex(missionpkg.Index{
		Diagnostic: &missionpkg.Diagnostic{
			Timestamp: "2026-05-20T12:00:00Z", Hostname: "h1", OS: "linux", Arch: "amd64",
			Version: "0.1.0", NodeID: "abcd1234", Uptime: "5m",
		},
		MissionKit: &missionpkg.MissionKit{Layouts: map[string]string{"default": "{}", "tactical": "{}"}},
		ViewState:  json.RawMessage(`{"tab":"map"}`),
	})
	p.WriteLogs(bytes.NewBufferString("2026-05-20T12:00:00Z INFO startup\n"))
	p.WriteArtifact("tile-1", strings.NewReader("twelve bytes"))
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	var out bytes.Buffer
	if err := runDiagnosticInspect(context.Background(), &out, packPath); err != nil {
		t.Fatalf("inspect: %v", err)
	}

	got := out.String()
	for _, want := range []string{
		"node:      abcd1234",
		"version:   0.1.0",
		"host:      h1 (linux/amd64)",
		"uptime:    5m",
		"entities:  3",
		"layouts:   2",
		"view:      13 bytes",
		"artifacts: 1 (12 B)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in output:\n%s", want, got)
		}
	}
}

func TestRunDiagnosticInspect_BareMissionPack(t *testing.T) {
	dir := t.TempDir()
	packPath := filepath.Join(dir, "bare.tar.gz")

	f, err := os.Create(packPath)
	if err != nil {
		t.Fatal(err)
	}
	p := missionpkg.NewPacker(f, time.Date(2026, 5, 20, 12, 0, 0, 0, time.UTC))
	p.WriteWorld([]byte(""))
	p.WriteIndex(missionpkg.Index{})
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	var out bytes.Buffer
	if err := runDiagnosticInspect(context.Background(), &out, packPath); err != nil {
		t.Fatalf("inspect: %v", err)
	}

	got := out.String()
	if !strings.Contains(got, "diagnostic: (not present)") {
		t.Errorf("missing diagnostic-absent marker:\n%s", got)
	}
	if strings.Contains(got, "layouts:") || strings.Contains(got, "artifacts:") || strings.Contains(got, "logs:") {
		t.Errorf("printed empty sections that should be hidden:\n%s", got)
	}
}

func TestRunDiagnosticInspect_MissingFile(t *testing.T) {
	var out bytes.Buffer
	err := runDiagnosticInspect(context.Background(), &out, "/nonexistent/path.tar.gz")
	if err == nil {
		t.Error("expected error for missing file")
	}
}
