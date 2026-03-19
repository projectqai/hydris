package meshtastic

import "sync"

// msgIDMap is a bounded, bidirectional map between meshtastic packet IDs and
// hydris entity IDs. It is safe for concurrent use.
type msgIDMap struct {
	mu       sync.RWMutex
	toEntity map[uint32]string // meshtastic packet ID → hydris entity ID
	toPacket map[string]uint32 // hydris entity ID → meshtastic packet ID
	order    []uint32          // insertion order for eviction
	maxSize  int
}

func newMsgIDMap(maxSize int) *msgIDMap {
	return &msgIDMap{
		toEntity: make(map[uint32]string, maxSize),
		toPacket: make(map[string]uint32, maxSize),
		order:    make([]uint32, 0, maxSize),
		maxSize:  maxSize,
	}
}

func (m *msgIDMap) Put(packetID uint32, entityID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Evict oldest if at capacity.
	if len(m.order) >= m.maxSize {
		old := m.order[0]
		m.order = m.order[1:]
		if eid, ok := m.toEntity[old]; ok {
			delete(m.toEntity, old)
			delete(m.toPacket, eid)
		}
	}

	m.toEntity[packetID] = entityID
	m.toPacket[entityID] = packetID
	m.order = append(m.order, packetID)
}

func (m *msgIDMap) EntityID(packetID uint32) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	eid, ok := m.toEntity[packetID]
	return eid, ok
}

func (m *msgIDMap) PacketID(entityID string) (uint32, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	pid, ok := m.toPacket[entityID]
	return pid, ok
}
