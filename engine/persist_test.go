package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
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

func TestIsLocal(t *testing.T) {
	w := testWorld(nil)
	w.nodeID = "mynode"

	// No controller - not local
	if w.isLocal(&pb.Entity{Id: "e1"}) {
		t.Error("entity without controller should not be local")
	}

	// Controller with matching node - local
	if !w.isLocal(&pb.Entity{Id: "e1", Controller: &pb.Controller{Node: proto.String("mynode")}}) {
		t.Error("entity with matching controller.node should be local")
	}

	// Controller with different node - not local
	if w.isLocal(&pb.Entity{Id: "e1", Controller: &pb.Controller{Node: proto.String("other")}}) {
		t.Error("entity with different controller.node should not be local")
	}

	// Controller with nil node - not local
	if w.isLocal(&pb.Entity{Id: "e1", Controller: &pb.Controller{Id: proto.String("ctrl")}}) {
		t.Error("entity with nil controller.node should not be local")
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

	configValue, _ := structpb.NewStruct(map[string]interface{}{"key": "val"})

	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Controller: &pb.Controller{Node: proto.String("n1")}, Config: &pb.ConfigurationComponent{Value: configValue}},
		"e2": {Id: "e2", Controller: &pb.Controller{Node: proto.String("n1")}, Device: &pb.DeviceComponent{State: pb.DeviceState_DeviceStateActive}},
	})
	w.worldFile = path
	w.nodeID = "n1"

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

func TestFlushToFile_SkipsNonLocal(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	configValue, _ := structpb.NewStruct(map[string]interface{}{"key": "val"})

	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Controller: &pb.Controller{Node: proto.String("n1")}, Config: &pb.ConfigurationComponent{Value: configValue}},
		"e2": {Id: "e2", Controller: &pb.Controller{Node: proto.String("other")}, Config: &pb.ConfigurationComponent{Value: configValue}},
		"e3": {Id: "e3", Label: ptr("no-controller")},
	})
	w.worldFile = path
	w.nodeID = "n1"

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
		t.Error("e1 (local) should be in file")
	}
	if strings.Contains(s, "e2") {
		t.Error("e2 (non-local) should not be in file")
	}
	if strings.Contains(s, "e3") {
		t.Error("e3 (no controller) should not be in file")
	}
}

func TestFlushToFile_SkipsNoConfigOrDevice(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Controller: &pb.Controller{Node: proto.String("n1")}, Label: ptr("only-label")},
	})
	w.worldFile = path
	w.nodeID = "n1"

	if err := w.FlushToFile(); err != nil {
		t.Fatal(err)
	}

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(strings.TrimSpace(string(b))) != 0 {
		t.Error("entity with no config or device should not be persisted")
	}
}

func TestFlushToFile_PersistsConfigAndDevice(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	configValue, _ := structpb.NewStruct(map[string]interface{}{
		"channel": float64(5),
	})

	w := testWorld(map[string]*pb.Entity{
		"e1": {
			Id:         "e1",
			Label:      ptr("device"),
			Controller: &pb.Controller{Node: proto.String("n1"), Id: proto.String("ctrl")},
			Config:     &pb.ConfigurationComponent{Value: configValue},
			Device:     &pb.DeviceComponent{State: pb.DeviceState_DeviceStateActive},
		},
	})
	w.worldFile = path
	w.nodeID = "n1"

	if err := w.FlushToFile(); err != nil {
		t.Fatal(err)
	}

	// Load into a fresh world and verify only id+config+device survived
	w2 := testWorld(map[string]*pb.Entity{})
	if err := w2.LoadFromFile(path); err != nil {
		t.Fatal(err)
	}

	e := w2.GetHead("e1")
	if e == nil {
		t.Fatal("e1 should be in file")
	}
	if e.Config == nil || e.Config.Value == nil {
		t.Fatal("config should survive persistence")
	}
	if v, ok := e.Config.Value.Fields["channel"]; !ok || v.GetNumberValue() != 5 {
		t.Errorf("config value should survive roundtrip, got %v", e.Config.Value.Fields)
	}
	if e.Device == nil {
		t.Error("device should survive persistence")
	}
	// Controller and lifetime should survive persistence
	if e.Controller == nil {
		t.Error("controller should survive persistence")
	}
	if e.Lifetime == nil {
		t.Error("lifetime should survive persistence")
	}
	// Label should survive persistence
	if e.Label == nil || *e.Label != "device" {
		t.Error("label should survive persistence")
	}
}

func TestFlushToFile_Roundtrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	configA, _ := structpb.NewStruct(map[string]interface{}{"name": "alpha"})
	configB, _ := structpb.NewStruct(map[string]interface{}{"name": "bravo"})

	original := map[string]*pb.Entity{
		"e1": {Id: "e1", Controller: &pb.Controller{Node: proto.String("n1")}, Config: &pb.ConfigurationComponent{Value: configA}},
		"e2": {Id: "e2", Controller: &pb.Controller{Node: proto.String("n1")}, Config: &pb.ConfigurationComponent{Value: configB}},
	}

	w := testWorld(original)
	w.worldFile = path
	w.nodeID = "n1"

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
	if e1 == nil || e1.Config == nil {
		t.Error("e1 should survive roundtrip")
	}
}

func TestFlushToFile_SortsByID(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "world.yaml")

	w := testWorld(map[string]*pb.Entity{
		"z-last":  {Id: "z-last", Controller: &pb.Controller{Node: proto.String("n1")}, Device: &pb.DeviceComponent{State: pb.DeviceState_DeviceStateActive}},
		"a-first": {Id: "a-first", Controller: &pb.Controller{Node: proto.String("n1")}, Device: &pb.DeviceComponent{State: pb.DeviceState_DeviceStateActive}},
	})
	w.worldFile = path
	w.nodeID = "n1"

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
