package engine

import (
	"log/slog"
	"reflect"
	"time"

	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/engine/transform"
	proto "github.com/projectqai/proto/go"
	goproto "google.golang.org/protobuf/proto"
)

func (s *WorldServer) GC() {
	now := time.Now()

	s.l.Lock()
	var changed []string
	var expired []string

	// Phase 0: Hard-expire entities marked by ExpireEntity.
	// These are removed unconditionally regardless of component lifetimes.
	for entityID, es := range s.head {
		if !es.hardExpire {
			continue
		}
		entity := es.entity
		deleteArtifactBlob(entity)
		s.deleteEntity(entityID)
		s.bus.Dirty(entityID, entity, proto.EntityChange_EntityChangeExpired)
		expired = append(expired, entityID)
	}

	// Phase 1: Per-component expiry for entities with lifetimes.
	for entityID, es := range s.head {
		if len(es.lifetimes) == 0 {
			continue
		}

		// Count how many tracked (has lifetime) components expire this tick.
		// Components pushed without a lifetime don't count toward keeping
		// the entity alive and are cleaned up together with the tracked ones.
		var expiringFields []int32
		var noLifetimeFields []int32
		tracked := 0
		for protoNum, cm := range es.lifetimes {
			if cm.noLifetime {
				noLifetimeFields = append(noLifetimeFields, protoNum)
				continue
			}
			tracked++
			if !cm.until.IsZero() && now.After(cm.until) {
				expiringFields = append(expiringFields, protoNum)
			}
		}
		if len(expiringFields) == 0 {
			continue
		}

		allExpiring := len(expiringFields) >= tracked
		if allExpiring {
			expiringFields = append(expiringFields, noLifetimeFields...)
		}

		if allExpiring {
			entity := es.entity
			deleteArtifactBlob(entity)
			s.deleteEntity(entityID)
			s.bus.Dirty(entityID, entity, proto.EntityChange_EntityChangeExpired)
			expired = append(expired, entityID)
		} else {
			// Clone so we don't mutate the pointer already shared with the bus.
			updated := goproto.Clone(es.entity).(*proto.Entity)
			v := reflect.ValueOf(updated).Elem()
			for _, protoNum := range expiringFields {
				if fieldIdx, ok := protoNumToFieldIdx[protoNum]; ok {
					f := v.Field(fieldIdx)
					if f.Kind() == reflect.Pointer && f.CanSet() {
						f.Set(reflect.Zero(f.Type()))
					}
				}
				delete(es.lifetimes, protoNum)
			}
			es.entity = updated
			s.headView[entityID] = updated
			changed = append(changed, entityID)
			s.bus.Dirty(entityID, updated, proto.EntityChange_EntityChangeUpdated)
		}
	}

	// Phase 2: Fallback entity-level expiry for entities without lifetimes
	// (e.g., transformer-generated entities that bypass Push).
	for k, es := range s.head {
		if len(es.lifetimes) > 0 {
			continue
		}
		e := es.entity
		if e.Lifetime != nil && e.Lifetime.Until.IsValid() && now.After(e.Lifetime.Until.AsTime()) {
			deleteArtifactBlob(e)
			s.deleteEntity(k)
			s.bus.Dirty(k, e, proto.EntityChange_EntityChangeExpired)
			expired = append(expired, k)
		}
	}

	for _, id := range expired {
		upserted, removed := transform.RunTransformers(s.transformers, s.headView, s.bus, id)
		s.syncTransformerResults(upserted, removed)
	}
	for _, id := range changed {
		upserted, removed := transform.RunTransformers(s.transformers, s.headView, s.bus, id)
		s.syncTransformerResults(upserted, removed)
	}
	s.l.Unlock()
}

// deleteArtifactBlob deletes the blob for an artifact entity from storage.
func deleteArtifactBlob(entity *proto.Entity) {
	if entity.Artifact == nil || entity.Artifact.Id == "" {
		return
	}
	if artifacts.Server == nil {
		return
	}
	if err := artifacts.Server.DeleteBlob(entity.Artifact.Id); err != nil {
		slog.Warn("failed to delete artifact blob on expiry", "id", entity.Artifact.Id, "error", err)
	}
}
