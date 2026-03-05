package engine

import (
	"time"

	"github.com/projectqai/hydris/engine/transform"
	proto "github.com/projectqai/proto/go"
)

func (s *WorldServer) gc() {
	now := time.Now()
	if s.frozen.Load() {
		now = s.frozenAt
	}

	s.l.Lock()
	var expired []string
	for k, v := range s.head {
		if v.Lifetime != nil {
			if v.Lifetime.Until.IsValid() && now.After(v.Lifetime.Until.AsTime()) {
				delete(s.head, k)
				s.bus.Dirty(k, v, proto.EntityChange_EntityChangeExpired)
				expired = append(expired, k)
			}
		}
	}
	for _, id := range expired {
		transform.RunTransformers(s.transformers, s.head, s.bus, id)
	}
	s.l.Unlock()
}
