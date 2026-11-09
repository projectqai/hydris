package builtin

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"runtime"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

//go:embed defaults.yaml
var defaultWorld []byte

//go:embed defaults_android.yaml
var androidOverrides []byte

// DefaultWorld returns the base defaults with platform-specific overrides appended.
// Overrides redeclare entities by ID; LoadDefaults deduplicates keeping the last
// occurrence, so overrides fully replace their base counterparts.
func DefaultWorld() []byte {
	switch runtime.GOOS {
	case "android":
		return append(defaultWorld, androidOverrides...)
	default:
		return defaultWorld
	}
}

// ParseEntities decodes a stream of YAML entity documents, the format of
// defaults.yaml, mission packs and plugin defaults: one Entity per document in
// protojson field naming. Empty documents are skipped.
func ParseEntities(b []byte) ([]*pb.Entity, error) {
	entities, _, err := parseEntities(b, false)
	return entities, err
}

// ParseEntitiesLenient is ParseEntities but tolerates fields the compiled-in
// schema does not know, e.g. a world file written by a newer hydris version.
// Unknown fields are dropped; each document that needed this is reported in
// discarded as the strict-mode error, so callers can surface what was lost.
func ParseEntitiesLenient(b []byte) (entities []*pb.Entity, discarded []error, err error) {
	return parseEntities(b, true)
}

func parseEntities(b []byte, lenient bool) ([]*pb.Entity, []error, error) {
	var discarded []error
	decoder := yaml.NewDecoder(bytes.NewReader(b))
	var entities []*pb.Entity
	for {
		var data map[string]interface{}
		err := decoder.Decode(&data)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, fmt.Errorf("failed to decode YAML document: %w", err)
		}
		if len(data) == 0 {
			continue
		}
		jsonBytes, err := json.Marshal(data)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to marshal to JSON: %w", err)
		}
		entity := &pb.Entity{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(jsonBytes, entity); err != nil {
			if !lenient {
				return nil, nil, fmt.Errorf("failed to unmarshal entity: %w", err)
			}
			// Retry discarding unknown fields. Anything still failing is a
			// genuine type/syntax error, not schema skew, so stay fatal.
			entity = &pb.Entity{}
			if err2 := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(jsonBytes, entity); err2 != nil {
				return nil, nil, fmt.Errorf("failed to unmarshal entity: %w", err2)
			}
			id, _ := data["id"].(string)
			discarded = append(discarded, fmt.Errorf("entity %q: %w", id, err))
		}
		entities = append(entities, entity)
	}
	return entities, discarded, nil
}
