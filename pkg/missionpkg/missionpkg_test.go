package missionpkg

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

var fixedTime = time.Date(2026, 5, 20, 12, 0, 0, 0, time.UTC)

func TestPackUnpackRoundtrip(t *testing.T) {
	worldYAML := []byte("entities:\n  - id: example\n")
	logs := []byte("2026-05-20T12:00:00Z INFO startup\n")
	tile := []byte("\x89PNG\x0d\x0a\x1a\x0afake tile bytes")

	idx := Index{
		MissionKit: &MissionKit{Layouts: map[string]string{"default": `{"name":"d","tree":{}}`}},
		ViewState:  json.RawMessage(`{"p":"selection","tab":"map"}`),
		Diagnostic: &Diagnostic{
			Timestamp: "2026-05-20T12:00:00Z", Hostname: "host", OS: "linux", Arch: "amd64",
			Version: "0.1.0", NodeID: "abcd1234", EntityCount: 1,
			Args: []string{"hydris"}, Uptime: "5s", Goroutines: 7,
		},
		Manifest: &Manifest{
			EntityCount:       1,
			EntityIDs:         []string{"example"},
			LayoutNames:       []string{"default"},
			MissionKitPresent: true,
			ViewStatePresent:  true,
			HydrisVersion:     "0.1.0",
		},
	}

	var buf bytes.Buffer
	p := NewPacker(&buf, fixedTime)
	p.WriteWorld(worldYAML)
	p.WriteIndex(idx)
	p.WriteLogs(bytes.NewReader(logs))
	p.WriteArtifact("tile-1", bytes.NewReader(tile))
	if err := p.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	got, err := Unpack(context.Background(), bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("Unpack: %v", err)
	}

	if !bytes.Equal(got.World, worldYAML) {
		t.Errorf("world: got %q, want %q", got.World, worldYAML)
	}
	if !bytes.Equal(got.Logs, logs) {
		t.Errorf("logs: got %q, want %q", got.Logs, logs)
	}
	if len(got.Artifacts) != 1 || got.Artifacts[0].ID != "tile-1" || !bytes.Equal(got.Artifacts[0].Data, tile) {
		t.Errorf("artifacts: got %+v, want one tile-1 with %q", got.Artifacts, tile)
	}
	if got.Index.Diagnostic == nil || got.Index.Diagnostic.NodeID != "abcd1234" {
		t.Errorf("index diagnostic: got %+v", got.Index.Diagnostic)
	}
	if got.Index.MissionKit == nil || got.Index.MissionKit.Layouts["default"] == "" {
		t.Errorf("index missionkit: got %+v", got.Index.MissionKit)
	}
	if !jsonEqual(t, got.Index.ViewState, json.RawMessage(`{"p":"selection","tab":"map"}`)) {
		t.Errorf("index view_state: got %s", got.Index.ViewState)
	}
	if got.Index.Manifest == nil {
		t.Fatal("index manifest: got nil")
	}
	if got.Index.Manifest.EntityCount != 1 {
		t.Errorf("manifest entity_count: got %d, want 1", got.Index.Manifest.EntityCount)
	}
	if !got.Index.Manifest.MissionKitPresent || !got.Index.Manifest.ViewStatePresent {
		t.Errorf("manifest presence flags: got mk=%v vs=%v", got.Index.Manifest.MissionKitPresent, got.Index.Manifest.ViewStatePresent)
	}
	if got.Index.Manifest.HydrisVersion != "0.1.0" {
		t.Errorf("manifest hydris_version: got %q", got.Index.Manifest.HydrisVersion)
	}
}

// TestUnpack_TolerantToUnknownIndexFields proves backward compatibility:
// a new pack with extra fields still parses on an old receiver. Go's
// json.Unmarshal ignores unknown fields by default, but the guarantee
// matters enough to pin in a test.
func TestUnpack_TolerantToUnknownIndexFields(t *testing.T) {
	var buf bytes.Buffer
	p := NewPacker(&buf, fixedTime)
	p.WriteWorld([]byte("entities: []\n"))
	// Hand-rolled index.json with a field the current Index struct does
	// NOT define. Simulates a future pack format extension.
	p.WriteIndex(Index{MissionKit: &MissionKit{Layouts: map[string]string{"a": "{}"}}})
	if err := p.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	got, err := Unpack(context.Background(), bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("Unpack: %v", err)
	}
	if got.Index.MissionKit == nil || got.Index.MissionKit.Layouts["a"] != "{}" {
		t.Errorf("missionkit: got %+v", got.Index.MissionKit)
	}
}

func TestPackOmitsEmpty(t *testing.T) {
	var buf bytes.Buffer
	p := NewPacker(&buf, fixedTime)
	p.WriteIndex(Index{Diagnostic: &Diagnostic{Hostname: "h"}})
	if err := p.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	names := zipEntryNames(t, buf.Bytes())
	if len(names) != 1 || names[0] != "index.json" {
		t.Errorf("entries: got %v, want [index.json]", names)
	}
}

func TestUnpackEmptyIndexIsSkipped(t *testing.T) {
	var buf bytes.Buffer
	p := NewPacker(&buf, fixedTime)
	p.writeFile("index.json", []byte("   \n"))
	if err := p.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	got, err := Unpack(context.Background(), bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("Unpack: %v", err)
	}
	if got.Index.MissionKit != nil || got.Index.Diagnostic != nil || got.Index.Manifest != nil || got.Index.ViewState != nil {
		t.Errorf("whitespace-only index.json should yield zero Index, got %+v", got.Index)
	}
}

func TestPackDeterministic(t *testing.T) {
	pack := func() []byte {
		var buf bytes.Buffer
		p := NewPacker(&buf, fixedTime)
		p.WriteWorld([]byte("a"))
		p.WriteIndex(Index{Diagnostic: &Diagnostic{Hostname: "h"}})
		p.WriteArtifact("x", strings.NewReader("y"))
		_ = p.Close()
		return buf.Bytes()
	}
	if !bytes.Equal(pack(), pack()) {
		t.Errorf("Pack output is not deterministic for identical input")
	}
}

func jsonEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var av, bv any
	if err := json.Unmarshal(a, &av); err != nil {
		return false
	}
	if err := json.Unmarshal(b, &bv); err != nil {
		return false
	}
	ab, _ := json.Marshal(av)
	bb, _ := json.Marshal(bv)
	return bytes.Equal(ab, bb)
}

func TestUnpackZipRoundtrip(t *testing.T) {
	worldYAML := []byte("entities:\n  - id: example\n")
	logs := []byte("2026-05-20T12:00:00Z INFO startup\n")
	tile := []byte("\x89PNG\x0d\x0a\x1a\x0afake tile bytes")
	idxJSON, err := json.Marshal(Index{
		MissionKit: &MissionKit{Layouts: map[string]string{"default": `{"name":"d","tree":{}}`}},
	})
	if err != nil {
		t.Fatalf("marshal index: %v", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	writeZipFile(t, zw, "world.yaml", worldYAML)
	writeZipFile(t, zw, "index.json", idxJSON)
	writeZipFile(t, zw, "logs.txt", logs)
	writeZipFile(t, zw, "artifacts/tile-1", tile)
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}

	got, err := Unpack(context.Background(), bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("Unpack: %v", err)
	}
	if !bytes.Equal(got.World, worldYAML) {
		t.Errorf("world: got %q, want %q", got.World, worldYAML)
	}
	if !bytes.Equal(got.Logs, logs) {
		t.Errorf("logs: got %q, want %q", got.Logs, logs)
	}
	if len(got.Artifacts) != 1 || got.Artifacts[0].ID != "tile-1" || !bytes.Equal(got.Artifacts[0].Data, tile) {
		t.Errorf("artifacts: got %+v, want one tile-1 with %q", got.Artifacts, tile)
	}
	if got.Index.MissionKit == nil || got.Index.MissionKit.Layouts["default"] == "" {
		t.Errorf("index missionkit: got %+v", got.Index.MissionKit)
	}
}

func TestUnpackZipRejectsPathTraversal(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	writeZipFile(t, zw, "../../etc/passwd", []byte("bad"))
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	_, err := Unpack(context.Background(), bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err == nil || !strings.Contains(err.Error(), "unsafe entry") {
		t.Errorf("path traversal: got err=%v, want unsafe-entry error", err)
	}
}

func TestUnpackRejectsNonZip(t *testing.T) {
	data := []byte("not an archive")
	_, err := Unpack(context.Background(), bytes.NewReader(data), int64(len(data)))
	if err == nil || !strings.Contains(err.Error(), "not a zip") {
		t.Errorf("non-zip input: got err=%v, want not-a-zip error", err)
	}
}

func TestUnpackRejectsDecompressionBomb(t *testing.T) {
	orig := maxDecompressedBytes
	maxDecompressedBytes = 1 << 20 // 1 MB inflated cap
	t.Cleanup(func() { maxDecompressedBytes = orig })

	// 8 MB of zeros deflates to a few KB — small compressed (under maxZipBytes),
	// huge inflated (over the 1 MB cap above). Classic zip bomb shape.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	writeZipFile(t, zw, "world.yaml", make([]byte, 8<<20))
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	if buf.Len() > 1<<20 {
		t.Fatalf("compressed bomb is %d bytes, expected it to slip under the compressed cap", buf.Len())
	}

	_, err := Unpack(context.Background(), bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err == nil || !strings.Contains(err.Error(), "decompressed contents exceed") {
		t.Errorf("decompression bomb: got err=%v, want decompressed-limit error", err)
	}
}

func writeZipFile(t *testing.T, zw *zip.Writer, name string, data []byte) {
	t.Helper()
	w, err := zw.Create(name)
	if err != nil {
		t.Fatalf("zip create %s: %v", name, err)
	}
	if _, err := w.Write(data); err != nil {
		t.Fatalf("zip write %s: %v", name, err)
	}
}

func zipEntryNames(t *testing.T, zipData []byte) []string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	return names
}
