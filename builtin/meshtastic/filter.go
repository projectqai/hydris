package meshtastic

import (
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// filterEntityForMesh returns a shallow copy of the entity with heavy
// components (Config, Device) stripped so it fits over the mesh radio.
func filterEntityForMesh(entity *pb.Entity) *pb.Entity {
	out := proto.Clone(entity).(*pb.Entity)
	out.Config = nil
	out.Device = nil
	return out
}
