package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/engine/meta"
	"github.com/projectqai/hydris/engine/transform"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gopkg.in/yaml.v3"
)

// LoadDefaults loads default entities.
// Entities that don't yet exist in head are inserted; existing ones are merged.
// Defaults use a very old timestamp (Unix epoch) so they never overwrite
// entities that were loaded from persistence with a real timestamp.
func (s *WorldServer) LoadDefaults(b []byte) error {
	if len(bytes.TrimSpace(b)) == 0 {
		return nil
	}

	entities, err := ParseEntities(b)
	if err != nil {
		return err
	}
	return s.LoadDefaultEntities(entities)
}

// LoadDefaultEntities loads entities as defaults: each is stamped with a Unix
// epoch lifetime so it loses the last-writer-wins merge against any persisted
// or runtime entity, letting operators override it. Used both for the YAML
// defaults and for engine-provided defaults (e.g. the policy chain) so they go
// through one identical path.
func (s *WorldServer) LoadDefaultEntities(entities []*pb.Entity) error {
	if len(entities) == 0 {
		return nil
	}

	// Dedup by ID, last-wins, so platform overrides replace base defaults.
	seen := make(map[string]int, len(entities))
	deduped := make([]*pb.Entity, 0, len(entities))
	for _, e := range entities {
		if idx, ok := seen[e.Id]; ok {
			deduped[idx] = e
		} else {
			seen[e.Id] = len(deduped)
			deduped = append(deduped, e)
		}
	}
	entities = deduped

	s.l.Lock()
	defer func() {
		s.l.Unlock()
		// Defaults ship the policy chains and actor policies; compile them so
		// callers gated before the first Push see the loaded rules.
		if s.policyEval != nil {
			s.policyEval.Rebuild()
		}
	}()

	// Defaults must lose the LWW merge against any real runtime/persisted entity,
	// so their timestamps stay near the Unix epoch. An unset timestamp falls back
	// to the epoch; an explicitly-set one is respected so a default can be
	// versioned — bump lifetime.fresh from epoch+1 to epoch+2 to ship an updated
	// default that overrides the one already loaded on existing nodes.
	epoch := timestamppb.New(time.Unix(0, 0))
	// year2000 guards against a real wall-clock timestamp slipping into a default,
	// which would let it overwrite genuine state.
	year2000 := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)

	added := 0
	for _, e := range entities {
		if e.Lifetime == nil {
			e.Lifetime = &pb.Lifetime{}
		}
		if !e.Lifetime.From.IsValid() {
			e.Lifetime.From = epoch
		}
		if e.Lifetime.Fresh == nil || !e.Lifetime.Fresh.IsValid() {
			e.Lifetime.Fresh = e.Lifetime.From
		}
		if e.Lifetime.From.AsTime().After(year2000) || e.Lifetime.Fresh.AsTime().After(year2000) {
			panic(fmt.Sprintf("default entity %q carries a real timestamp (fresh=%s); defaults must use small epoch+N offsets", e.Id, e.Lifetime.Fresh.AsTime().Format(time.RFC3339)))
		}

		if es, ok := s.head[e.Id]; ok {
			merged, accepted, _ := s.mergeEntityComponents(e.Id, es, e, meta.Component{Reloaded: true})
			if !accepted {
				continue
			}
			es.entity = merged
			s.headView[e.Id] = merged
		} else {
			s.initEntityFrom(e, meta.Component{Reloaded: true})
		}
		transform.ReindexTransformers(s.transformers, s.headView, e.Id)
		s.bus.Dirty(context.Background(), e.Id, s.head[e.Id].entity, pb.EntityChange_EntityChangeUpdated)
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

	// The world file may have been written by a newer hydris (e.g. after a
	// downgrade) carrying fields this build doesn't know. Refusing to start
	// over that is worse than dropping them, but the next flush would erase
	// them for good, so keep a copy of the original first.
	entities, discarded, err := builtin.ParseEntitiesLenient(inputBytes)
	if err != nil {
		return err
	}
	if len(discarded) > 0 {
		backup := path + ".unknown-fields.bak"
		for _, d := range discarded {
			slog.Warn("world file: discarded unknown fields", "path", path, "error", d)
		}
		if werr := os.WriteFile(backup, inputBytes, 0o600); werr != nil {
			slog.Warn("world file: failed to back up original before discarding unknown fields", "backup", backup, "error", werr)
		} else {
			slog.Warn("world file: original kept as backup", "backup", backup, "entities_affected", len(discarded))
		}
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
		failInterrupted(e.TaskExecution)
		s.initEntityFrom(e, meta.Component{Reloaded: true})
	}

	for _, e := range entities {
		transform.ReindexTransformers(s.transformers, s.headView, e.Id)
		s.bus.Dirty(context.Background(), e.Id, e, pb.EntityChange_EntityChangeUpdated)
	}

	slog.Info("loaded entities from file", "count", len(entities), "path", path)
	return nil
}

// failInterrupted fails an execution that was still pending or running when
// the world was saved: whoever was carrying it out stopped with hydris, so
// nobody would ever finish it.
func failInterrupted(ex *pb.TaskExecutionComponent) {
	if ex == nil {
		return
	}
	if ex.State == pb.TaskExecutionState_TaskExecutionStatePending || ex.State == pb.TaskExecutionState_TaskExecutionStateRunning {
		ex.State = pb.TaskExecutionState_TaskExecutionStateFailed
		ex.Reason = proto.String("interrupted: hydris restarted")
	}
}

func ParseEntities(b []byte) ([]*pb.Entity, error) {
	return builtin.ParseEntities(b)
}

// isLocal reports whether the entity belongs to this node.
func (s *WorldServer) isLocal(e *pb.Entity) bool {
	return s.nodeID != "" && e.Controller != nil && e.Controller.Node != nil && *e.Controller.Node == s.nodeID
}

// isDurable reports whether a component survives a FlushToFile/LoadFromFile
// round-trip: it must never expire and must not be transformer-generated.
// Generated components are recomputed from their sources; persisting them
// would make them look externally authored after a reload. Leases are never
// durable — a persisted lock would leave the entity locked to a controller
// that no longer exists after a restart.
func (es *entityState) isDurable(protoNum int32) bool {
	if protoNum == int32(pb.EntityComponent_EntityComponentLease) {
		return false
	}
	return !es.lifetimes[protoNum].Generated && es.isInfinite(protoNum)
}

// isPersisted reports whether an entity is written to the world file: it must
// be local and permanent. The entity-level Lifetime is the union of the
// tracked component lifetimes (see mergeEntityComponents), so a missing Until
// already implies durable content; persistableStub picks which components are
// kept.
func (s *WorldServer) isPersisted(es *entityState) bool {
	e := es.entity
	if !s.isLocal(e) {
		return false
	}
	lt := e.GetLifetime()
	return lt == nil || !lt.GetUntil().IsValid()
}

// persistableStub returns a copy of the entity containing only its durable
// components — the subset that survives a FlushToFile/LoadFromFile round-trip.
// Caller must hold s.l. Expiring components (tracks, detections, ...) and
// transformer-generated derivatives are dropped.
func (es *entityState) persistableStub() *pb.Entity {
	e := es.entity
	stub := &pb.Entity{Id: e.Id, Label: e.Label, Controller: e.Controller, Lifetime: e.Lifetime}
	src := reflect.ValueOf(e).Elem()
	dst := reflect.ValueOf(stub).Elem()
	for protoNum, fieldIdx := range protoNumToFieldIdx {
		f := src.Field(fieldIdx)
		if f.Kind() == reflect.Pointer && !f.IsNil() && es.isDurable(protoNum) {
			dst.Field(fieldIdx).Set(f)
		}
	}
	return stub
}

// FlushToFile writes the current head state to the world file atomically.
// Only local entities (controller.node == this node) are persisted, reduced
// to their durable components. Entities with lifetime.until
// (expiring/temporary) are skipped entirely.
func (s *WorldServer) FlushToFile() error {
	if s.worldFile == "" {
		return nil
	}

	s.l.RLock()
	entities := make([]*pb.Entity, 0, len(s.head))
	for _, es := range s.head {
		if !s.isPersisted(es) {
			continue
		}
		entities = append(entities, es.persistableStub())
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
