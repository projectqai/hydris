package transform

import pb "github.com/projectqai/proto/go"

// Transformer is a callback-based interface for managing derived entities.
// Transformers watch pushes and GC events to maintain generated entities
// that are derived from source entities (e.g. sensor coverage from sensor range).
type Transformer interface {
	// Validate is called BEFORE merge. Return error to reject the push.
	Validate(head map[string]*pb.Entity, incoming *pb.Entity) error

	// Resolve is called AFTER an entity is merged into head.
	// Returns entities to upsert and entity IDs to delete.
	Resolve(head map[string]*pb.Entity, changedID string) (upsert []*pb.Entity, remove []string)
}

// Bus is an interface for the subset of engine.Bus that transformers need.
type Bus interface {
	Dirty(id string, entity *pb.Entity, changeType pb.EntityChange)
}

// RunTransformers runs all transformers for a changed entity, applying upserts and
// removes to head and notifying the bus. Returns the IDs of upserted and removed
// entities so callers can sync secondary stores.
func RunTransformers(transformers []Transformer, head map[string]*pb.Entity, bus Bus, changedID string) (upserted, removed []string) {
	changedIDs := []string{changedID}
	for _, t := range transformers {
		var newIDs []string
		for _, id := range changedIDs {
			upsert, remove := t.Resolve(head, id)
			for _, e := range upsert {
				head[e.Id] = e
				bus.Dirty(e.Id, e, pb.EntityChange_EntityChangeUpdated)
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
	return upserted, removed
}
