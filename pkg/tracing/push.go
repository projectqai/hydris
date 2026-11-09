package tracing

import (
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// primaryComponents orders the components that best describe what a change
// is about; the first one present names the change's kind.
var primaryComponents = []string{
	"detection", "track", "transponder", "camera", "sensor", "chat",
	"task_execution", "target_manual_control", "manual_control", "mission",
	"artifact", "policy", "authorization", "map_layer", "locator", "link",
	"geo", "pose", "device", "config", "configurable", "metric", "label",
}

// ChangeKind summarizes a wire entity by its most descriptive component:
// "detection" for a change carrying a detection, "metric" for one carrying
// only telemetry, and so on. Low cardinality by construction, so the sampler
// can drop routine kinds by it.
func ChangeKind(e *pb.Entity) string {
	m := e.ProtoReflect()
	fields := m.Descriptor().Fields()
	for _, name := range primaryComponents {
		if fd := fields.ByName(protoreflect.Name(name)); fd != nil && m.Has(fd) {
			return name
		}
	}
	return "entity"
}
