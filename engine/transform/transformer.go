package transform

import (
	"context"
	"time"

	"github.com/projectqai/hydris/engine/meta"
	"github.com/projectqai/hydris/pkg/tracing"
	pb "github.com/projectqai/proto/go"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
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

// noopSpan stands in for transformers that produced nothing.
var noopSpan = trace.SpanFromContext(context.Background())

// Bus is an interface for the subset of engine.Bus that transformers need.
// ctx carries the span of the change being processed, so watchers can
// continue its trace.
type Bus interface {
	Dirty(ctx context.Context, id string, entity *pb.Entity, changeType pb.EntityChange)
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
//
// ctx carries the trace of the change being processed: every transformer run
// becomes a child span of it, and derived entities are notified under that
// span so the trace continues through them.
func RunTransformers(ctx context.Context, transformers []Transformer, head map[string]*pb.Entity, bus Bus, changedID string, components map[int32]meta.Component) (upserted, removed []string, generatedBy map[string]map[int32]string) {
	generatedBy = map[string]map[int32]string{}
	attributeTo := func(id string, num int32, name string) {
		m := generatedBy[id]
		if m == nil {
			m = map[int32]string{}
			generatedBy[id] = m
		}
		if _, seen := m[num]; !seen {
			m[num] = name
		}
	}

	ctx, all := tracing.Tracer().Start(ctx, "transform",
		trace.WithAttributes(tracing.AttrEntityID.String(changedID), attribute.Int("hydris.transformers", len(transformers))))
	defer func() {
		if all.IsRecording() {
			all.SetAttributes(
				attribute.Int("hydris.transform.upserted", len(upserted)),
				attribute.Int("hydris.transform.removed", len(removed)),
			)
		}
		all.End()
	}()

	changedIDs := []string{changedID}
	for _, t := range transformers {
		name := t.Name()
		var newIDs []string
		for _, id := range changedIDs {
			before := populatedComponents(head[id])
			// Each transformer's time is an attribute on the step span; a
			// transformer only gets a span of its own when it changed
			// something, so a trace shows what happened rather than every
			// no-op.
			started := time.Now()
			upsert, remove := t.Resolve(head, id, components)
			tctx := ctx
			span := noopSpan
			if len(upsert) > 0 || len(remove) > 0 {
				tctx, span = tracing.Tracer().Start(ctx, "transform."+name,
					trace.WithTimestamp(started),
					trace.WithAttributes(
						tracing.AttrTransformer.String(name), tracing.AttrEntityID.String(id),
						attribute.Int("hydris.transform.upserted", len(upsert)),
						attribute.Int("hydris.transform.removed", len(remove)),
					))
			} else if all.IsRecording() {
				all.SetAttributes(attribute.Int64("hydris.transform."+name+"_us", time.Since(started).Microseconds()))
			}
			// Fields newly populated in place on the source entity.
			for num := range populatedComponents(head[id]) {
				if !before[num] {
					attributeTo(id, num, name)
				}
			}
			for _, e := range upsert {
				head[e.Id] = e
				bus.Dirty(tctx, e.Id, e, pb.EntityChange_EntityChangeUpdated)
				for num := range populatedComponents(e) {
					attributeTo(e.Id, num, name)
				}
				newIDs = append(newIDs, e.Id)
				upserted = append(upserted, e.Id)
			}
			for _, rid := range remove {
				if e, ok := head[rid]; ok {
					delete(head, rid)
					bus.Dirty(tctx, rid, e, pb.EntityChange_EntityChangeExpired)
					removed = append(removed, rid)
					newIDs = append(newIDs, rid)
				}
			}
			span.End()
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
