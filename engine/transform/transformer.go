package transform

import (
	"github.com/projectqai/hydris/engine/meta"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// Transformer is a callback-based interface for managing derived entities.
// Transformers watch pushes and GC events to maintain generated entities
// that are derived from source entities (e.g. sensor coverage from sensor range).
type Transformer interface {
	// Name returns a stable identifier (e.g. "pose", "aou"), recorded as the
	// generator of any component the transformer produces.
	Name() string

	// Validate is called BEFORE merge. Return error to reject the push.
	Validate(head map[string]*pb.Entity, incoming *pb.Entity) error

	// Reindex registers a loaded entity in internal indexes without
	// computing or mutating any components.
	// this is called by engine when loading a cold entity into hot
	Reindex(head map[string]*pb.Entity, id string)

	// Resolve is called AFTER an entity is merged into head.
	// components contains per-component metadata for the changed entity,
	// keyed by proto field number. Transformers can check Generated to know
	// whether a component was set by another transformer or externally pushed.
	// Returns entities to upsert and entity IDs to delete.
	Resolve(head map[string]*pb.Entity, changedID string, components map[int32]meta.Component) (upsert []*pb.Entity, remove []string)
}

// Bus is an interface for the subset of engine.Bus that transformers need.
type Bus interface {
	Dirty(id string, entity *pb.Entity, changeType pb.EntityChange)
}

// ReindexTransformers lets all transformers register a loaded entity in their
// internal indexes without computing or mutating any components.
func ReindexTransformers(transformers []Transformer, head map[string]*pb.Entity, id string) {
	for _, t := range transformers {
		t.Reindex(head, id)
	}
}

// RunTransformers runs all transformers for a changed entity, applying upserts and
// removes to head and notifying the bus. Returns the IDs of upserted and removed
// entities so callers can sync secondary stores, plus generatedBy: per entity, the
// proto field number of each component a transformer produced mapped to that
// transformer's Name(). Attribution is by first producer — the transformer that
// first populated the field; later transformers that only adjust its value do not
// override it.
func RunTransformers(transformers []Transformer, head map[string]*pb.Entity, bus Bus, changedID string, components map[int32]meta.Component) (upserted, removed []string, generatedBy map[string]map[int32]string) {
	generatedBy = map[string]map[int32]string{}
	attribute := func(id string, num int32, name string) {
		m := generatedBy[id]
		if m == nil {
			m = map[int32]string{}
			generatedBy[id] = m
		}
		if _, seen := m[num]; !seen {
			m[num] = name
		}
	}

	changedIDs := []string{changedID}
	for _, t := range transformers {
		name := t.Name()
		var newIDs []string
		for _, id := range changedIDs {
			before := populatedComponents(head[id])
			upsert, remove := t.Resolve(head, id, components)
			// Fields newly populated in place on the source entity.
			for num := range populatedComponents(head[id]) {
				if !before[num] {
					attribute(id, num, name)
				}
			}
			for _, e := range upsert {
				head[e.Id] = e
				bus.Dirty(e.Id, e, pb.EntityChange_EntityChangeUpdated)
				for num := range populatedComponents(e) {
					attribute(e.Id, num, name)
				}
				newIDs = append(newIDs, e.Id)
				upserted = append(upserted, e.Id)
			}
			for _, rid := range remove {
				if e, ok := head[rid]; ok {
					delete(head, rid)
					bus.Dirty(rid, e, pb.EntityChange_EntityChangeExpired)
					removed = append(removed, rid)
					newIDs = append(newIDs, rid)
				}
			}
		}
		changedIDs = append(changedIDs, newIDs...)
	}
	return upserted, removed, generatedBy
}

// populatedComponents returns the set of proto field numbers currently set on
// the entity (lifetime included; the caller skips it when stamping).
func populatedComponents(e *pb.Entity) map[int32]bool {
	out := map[int32]bool{}
	if e == nil {
		return out
	}
	e.ProtoReflect().Range(func(fd protoreflect.FieldDescriptor, _ protoreflect.Value) bool {
		out[int32(fd.Number())] = true
		return true
	})
	return out
}
