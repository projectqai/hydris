package engine

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gopkg.in/yaml.v3"
)

// LoadDefaults loads default entities, stamping lifetime.from to now if not set.
// Entities that don't yet exist in head are inserted; existing ones are merged.
func (s *WorldServer) LoadDefaults(b []byte) error {
	if len(bytes.TrimSpace(b)) == 0 {
		return nil
	}

	entities, err := parseEntities(b)
	if err != nil {
		return err
	}

	s.l.Lock()
	defer s.l.Unlock()

	added := 0
	for _, e := range entities {
		if e.Lifetime == nil {
			e.Lifetime = &pb.Lifetime{}
		}
		if !e.Lifetime.From.IsValid() {
			e.Lifetime.From = timestamppb.Now()
		}
		if e.Lifetime.Fresh == nil || !e.Lifetime.Fresh.IsValid() {
			e.Lifetime.Fresh = e.Lifetime.From
		}

		if es, ok := s.head[e.Id]; ok {
			merged, accepted := s.mergeEntityComponents(e.Id, es, e)
			if !accepted {
				continue
			}
			es.entity = merged
			s.headView[e.Id] = merged
		} else {
			s.initEntity(e)
		}
		s.bus.Dirty(e.Id, s.head[e.Id].entity, pb.EntityChange_EntityChangeUpdated)
		added++
	}

	slog.Info("loaded default entities", "added", added, "total", len(entities))
	return nil
}

func (s *WorldServer) LoadFromFile(path string) error {
	inputBytes, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to read file: %w", err)
	}

	if len(bytes.TrimSpace(inputBytes)) == 0 {
		return nil
	}

	entities, err := parseEntities(inputBytes)
	if err != nil {
		return err
	}

	s.l.Lock()
	defer s.l.Unlock()

	for _, e := range entities {
		if e.Lifetime == nil {
			e.Lifetime = &pb.Lifetime{}
		}
		if !e.Lifetime.From.IsValid() {
			e.Lifetime.From = timestamppb.Now()
		}
		if e.Lifetime.Fresh == nil || !e.Lifetime.Fresh.IsValid() {
			e.Lifetime.Fresh = e.Lifetime.From
		}
		s.initEntity(e)
		s.bus.Dirty(e.Id, e, pb.EntityChange_EntityChangeUpdated)
	}

	slog.Info("loaded entities from file", "count", len(entities), "path", path)
	return nil
}

func parseEntities(b []byte) ([]*pb.Entity, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(b))
	var entities []*pb.Entity

	for {
		var data map[string]interface{}
		err := decoder.Decode(&data)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to decode YAML document: %w", err)
		}

		// Skip empty documents
		if len(data) == 0 {
			continue
		}

		// Convert to JSON then to protobuf
		jsonBytes, err := json.Marshal(data)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal to JSON: %w", err)
		}

		entity := &pb.Entity{}
		unmarshaler := protojson.UnmarshalOptions{
			DiscardUnknown: false,
		}

		if err := unmarshaler.Unmarshal(jsonBytes, entity); err != nil {
			return nil, fmt.Errorf("failed to unmarshal entity: %w", err)
		}

		entities = append(entities, entity)
	}

	return entities, nil
}

// isLocal reports whether the entity belongs to this node.
func (s *WorldServer) isLocal(e *pb.Entity) bool {
	return s.nodeID != "" && e.Controller != nil && e.Controller.Node != nil && *e.Controller.Node == s.nodeID
}

// FlushToFile writes the current head state to the world file atomically.
// Only local entities (controller.node == this node) are persisted, and only
// the config and device components are kept. Entities with lifetime.until
// (expiring/temporary) are skipped entirely.
func (s *WorldServer) FlushToFile() error {
	if s.worldFile == "" {
		return nil
	}

	s.l.RLock()
	entities := make([]*pb.Entity, 0, len(s.head))
	for _, es := range s.head {
		e := es.entity
		if !s.isLocal(e) {
			continue
		}

		hasSomething := false

		stub := &pb.Entity{Id: e.Id, Label: e.Label, Controller: e.Controller, Lifetime: e.Lifetime}
		if e.Config != nil {
			stub.Config = e.Config
			hasSomething = true
		}
		if e.Device != nil {
			stub.Device = e.Device
			hasSomething = true
		}

		if !hasSomething {
			continue
		}

		entities = append(entities, stub)
	}
	s.l.RUnlock()

	// Sort entities by ID for consistent output
	slices.SortFunc(entities, func(a, b *pb.Entity) int {
		return strings.Compare(a.Id, b.Id)
	})

	// Convert to YAML
	yamlBytes, err := entitiesToYAML(entities)
	if err != nil {
		return fmt.Errorf("failed to marshal entities to YAML: %w", err)
	}

	// Write atomically: write to temp file, then rename
	dir := filepath.Dir(s.worldFile)
	tmpFile, err := os.CreateTemp(dir, ".hydris-world-*.yaml.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	_, err = tmpFile.Write(yamlBytes)
	if err != nil {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to sync temp file: %w", err)
	}

	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to close temp file: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tmpPath, s.worldFile); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to rename temp file to %s: %w", s.worldFile, err)
	}

	return nil
}

// Canonical field order for YAML output
var canonicalFieldOrder = []string{"id", "label", "controller", "lifetime", "priority", "symbol", "geo"}

// entitiesToYAML converts entities to multi-document YAML format with canonical field order.
func entitiesToYAML(entities []*pb.Entity) ([]byte, error) {
	if len(entities) == 0 {
		return []byte{}, nil
	}

	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}

	var buf bytes.Buffer

	for i, entity := range entities {
		if i > 0 {
			buf.WriteString("---\n")
		}

		// Convert proto to JSON first
		jsonBytes, err := marshaler.Marshal(entity)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal entity %s to JSON: %w", entity.Id, err)
		}

		// Convert JSON to map
		var data map[string]interface{}
		if err := json.Unmarshal(jsonBytes, &data); err != nil {
			return nil, fmt.Errorf("failed to unmarshal JSON for entity %s: %w", entity.Id, err)
		}

		// Build ordered YAML node
		node := buildOrderedYAMLNode(data)

		// Marshal to YAML
		yamlBytes, err := yaml.Marshal(node)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal entity %s to YAML: %w", entity.Id, err)
		}

		buf.Write(yamlBytes)
	}

	return buf.Bytes(), nil
}

// buildOrderedYAMLNode creates a yaml.Node with fields in canonical order.
func buildOrderedYAMLNode(data map[string]interface{}) *yaml.Node {
	node := &yaml.Node{
		Kind: yaml.MappingNode,
	}

	// First add canonical fields in order
	for _, key := range canonicalFieldOrder {
		if val, ok := data[key]; ok {
			addKeyValue(node, key, val)
		}
	}

	// Collect remaining keys and sort them
	var remainingKeys []string
	for key := range data {
		if !slices.Contains(canonicalFieldOrder, key) {
			remainingKeys = append(remainingKeys, key)
		}
	}
	slices.Sort(remainingKeys)

	// Add remaining fields in sorted order
	for _, key := range remainingKeys {
		addKeyValue(node, key, data[key])
	}

	return node
}

// addKeyValue adds a key-value pair to a yaml mapping node.
func addKeyValue(node *yaml.Node, key string, val interface{}) {
	keyNode := &yaml.Node{
		Kind:  yaml.ScalarNode,
		Value: key,
	}
	var valNode yaml.Node
	_ = valNode.Encode(val)
	node.Content = append(node.Content, keyNode, &valNode)
}

// StartPeriodicFlush starts a goroutine that periodically flushes the head to the world file.
// It also starts a debounce goroutine that flushes shortly after config changes.
func (s *WorldServer) StartPeriodicFlush(interval time.Duration) {
	if s.worldFile == "" {
		return
	}

	s.persistNotify = make(chan struct{}, 1)

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			if err := s.FlushToFile(); err != nil {
				slog.Warn("failed to flush world state", "error", err)
			}
		}
	}()

	// Debounced flush: wait for a config change signal, then debounce
	// additional signals within a short window before flushing.
	go func() {
		const debounce = 2 * time.Second
		for {
			// Block until a config change is signalled.
			_, ok := <-s.persistNotify
			if !ok {
				return
			}
			// Drain any additional signals that arrive within the debounce window.
			timer := time.NewTimer(debounce)
		drain:
			for {
				select {
				case _, ok := <-s.persistNotify:
					if !ok {
						timer.Stop()
						return
					}
				case <-timer.C:
					break drain
				}
			}
			if err := s.FlushToFile(); err != nil {
				slog.Warn("failed to flush world state (debounced)", "error", err)
			}
		}
	}()
}

// notifyPersist signals the debounced flush goroutine that a config change occurred.
func (s *WorldServer) notifyPersist() {
	if s.persistNotify == nil {
		return
	}
	select {
	case s.persistNotify <- struct{}{}:
	default:
		// Already signalled, debounce will pick it up.
	}
}
