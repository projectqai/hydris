package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestParseEntities_SingleEntity(t *testing.T) {
	yaml := `id: "e1"
label: "tank"
`
	entities, err := parseEntities([]byte(yaml))
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 1 {
		t.Fatalf("expected 1 entity, got %d", len(entities))
	}
	if entities[0].Id != "e1" {
		t.Errorf("expected id=e1, got %s", entities[0].Id)
	}
	if entities[0].Label == nil || *entities[0].Label != "tank" {
		t.Errorf("expected label=tank, got %v", entities[0].Label)
	}
}

func TestParseEntities_MultipleDocuments(t *testing.T) {
	yaml := `id: "e1"
label: "alpha"
---
id: "e2"
label: "bravo"
`
	entities, err := parseEntities([]byte(yaml))
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 2 {
		t.Fatalf("expected 2 entities, got %d", len(entities))
	}
	if entities[0].Id != "e1" || entities[1].Id != "e2" {
		t.Errorf("expected e1,e2; got %s,%s", entities[0].Id, entities[1].Id)
	}
}

func TestParseEntities_EmptyDocument(t *testing.T) {
	yaml := `id: "e1"
---
---
id: "e2"
`
	entities, err := parseEntities([]byte(yaml))
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 2 {
		t.Fatalf("expected 2 entities (skip empty), got %d", len(entities))
	}
}

func TestParseEntities_InvalidYAML(t *testing.T) {
	_, err := parseEntities([]byte(`{{{invalid`))
	if err == nil {
		t.Error("expected error for invalid YAML")
	}
}

func TestParseEntities_EmptyInput(t *testing.T) {
	entities, err := parseEntities([]byte(""))
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 0 {
		t.Errorf("expected 0 entities, got %d", len(entities))
	}
}

func TestEntitiesToYAML_Empty(t *testing.T) {
	b, err := entitiesToYAML(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) != 0 {
		t.Errorf("expected empty output, got %q", string(b))
	}
}

func TestEntitiesToYAML_SingleEntity(t *testing.T) {
	entities := []*pb.Entity{
		{Id: "e1", Label: ptr("tank")},
	}
	b, err := entitiesToYAML(entities)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if !strings.Contains(s, "id:") || !strings.Contains(s, "e1") {
		t.Errorf("expected id in output, got %q", s)
	}
	if !strings.Contains(s, "label:") || !strings.Contains(s, "tank") {
		t.Errorf("expected label in output, got %q", s)
	}
}

func TestEntitiesToYAML_MultipleEntities(t *testing.T) {
	entities := []*pb.Entity{
		{Id: "e1"},
		{Id: "e2"},
	}
	b, err := entitiesToYAML(entities)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if !strings.Contains(s, "---") {
		t.Error("multiple entities should use multi-document separator")
	}
}

func TestEntitiesToYAML_CanonicalOrder(t *testing.T) {
	entities := []*pb.Entity{
		{
			Id:    "e1",
			Label: ptr("test"),
			Geo:   &pb.GeoSpatialComponent{Latitude: 1.0, Longitude: 2.0},
		},
	}
	b, err := entitiesToYAML(entities)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	idIdx := strings.Index(s, "id:")
	labelIdx := strings.Index(s, "label:")
	geoIdx := strings.Index(s, "geo:")
	if idIdx == -1 || labelIdx == -1 || geoIdx == -1 {
		t.Fatalf("missing expected fields in %q", s)
	}
	if idIdx > labelIdx || labelIdx > geoIdx {
		t.Error("fields should be in canonical order: id, label, ..., geo")
	}
}

func TestEntitiesToYAML_Roundtrip(t *testing.T) {
	original := []*pb.Entity{
		{Id: "e1", Label: ptr("tank")},
		{Id: "e2", Label: ptr("plane")},
	}
	b, err := entitiesToYAML(original)
	if err != nil {
		t.Fatal(err)
	}

	parsed, err := parseEntities(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed) != 2 {
		t.Fatalf("expected 2 entities after roundtrip, got %d", len(parsed))
	}
	if parsed[0].Id != "e1" || parsed[1].Id != "e2" {
		t.Error("IDs should survive roundtrip")
	}
	if parsed[0].Label == nil || *parsed[0].Label != "tank" {
		t.Error("labels should survive roundtrip")
	}
}

func TestShouldPersist(t *testing.T) {
	w := testWorld(nil)

	// Normal entity - should persist
	if !w.shouldPersist(&pb.Entity{Id: "e1"}) {
		t.Error("plain entity should be persisted")
	}

	// Has controller with id - skip
	if w.shouldPersist(&pb.Entity{Id: "e1", Controller: &pb.Controller{Id: proto.String("ctrl")}}) {
		t.Error("entity with controller should not be persisted")
	}

	// Has lifetime.until - skip
	if w.shouldPersist(&pb.Entity{
		Id:       "e1",
		Lifetime: &pb.Lifetime{Until: timestamppb.Now()},
	}) {
		t.Error("entity with lifetime.until should not be persisted")
	}

	// Has lifetime but no until - should persist
	if !w.shouldPersist(&pb.Entity{
		Id:       "e1",
		Lifetime: &pb.Lifetime{From: timestamppb.Now()},
	}) {
		t.Error("entity with lifetime.from only should be persisted")
	}
}

func TestLoadFromFile_NonExistent(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	err := w.LoadFromFile("/nonexistent/path.yaml")
	if err != nil {
		t.Errorf("non-existent file should return nil, got %v", err)
	}
}

func TestLoadFromFile_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.yaml")
	if err := os.WriteFile(path, []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	w := testWorld(map[string]*pb.Entity{})
	err := w.LoadFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if w.EntityCount() != 0 {
		t.Error("empty file should load 0 entities")
	}
}

func TestLoadFromFile_ValidEntities(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	yaml := `id: "e1"
label: "tank"
---
id: "e2"
label: "plane"
`
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}

	w := testWorld(map[string]*pb.Entity{})
	err := w.LoadFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if w.EntityCount() != 2 {
		t.Errorf("expected 2 entities, got %d", w.EntityCount())
	}
	if w.GetHead("e1") == nil || w.GetHead("e2") == nil {
		t.Error("loaded entities should be in head")
	}
}

func TestFlushToFile_NoWorldFile(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{})
	err := w.FlushToFile()
	if err != nil {
		t.Errorf("no world file should return nil, got %v", err)
	}
}

func TestFlushToFile_WritesEntities(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("tank")},
		"e2": {Id: "e2", Label: ptr("plane")},
	})
	w.worldFile = path

	err := w.FlushToFile()
	if err != nil {
		t.Fatal(err)
	}

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if !strings.Contains(s, "e1") || !strings.Contains(s, "e2") {
		t.Errorf("expected both entities in file, got %q", s)
	}
}

func TestFlushToFile_SkipsControlled(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("keep")},
		"e2": {Id: "e2", Controller: &pb.Controller{Id: proto.String("ctrl")}},
	})
	w.worldFile = path

	err := w.FlushToFile()
	if err != nil {
		t.Fatal(err)
	}

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if !strings.Contains(s, "e1") {
		t.Error("e1 should be in file")
	}
	if strings.Contains(s, "e2") {
		t.Error("e2 (controlled) should not be in file")
	}
}

func TestFlushToFile_Roundtrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	original := map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("alpha")},
		"e2": {Id: "e2", Label: ptr("bravo")},
	}

	w := testWorld(original)
	w.worldFile = path

	if err := w.FlushToFile(); err != nil {
		t.Fatal(err)
	}

	// Load into new world
	w2 := testWorld(map[string]*pb.Entity{})
	if err := w2.LoadFromFile(path); err != nil {
		t.Fatal(err)
	}

	if w2.EntityCount() != 2 {
		t.Errorf("expected 2 entities after roundtrip, got %d", w2.EntityCount())
	}
	e1 := w2.GetHead("e1")
	if e1 == nil || e1.Label == nil || *e1.Label != "alpha" {
		t.Error("e1 should survive roundtrip")
	}
}

func TestFlushToFile_SortsByID(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	w := testWorld(map[string]*pb.Entity{
		"z-last":  {Id: "z-last", Label: ptr("z")},
		"a-first": {Id: "a-first", Label: ptr("a")},
	})
	w.worldFile = path

	if err := w.FlushToFile(); err != nil {
		t.Fatal(err)
	}

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	aIdx := strings.Index(s, "a-first")
	zIdx := strings.Index(s, "z-last")
	if aIdx > zIdx {
		t.Error("entities should be sorted by ID")
	}
}
