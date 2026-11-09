package hydrispayload

import (
	"fmt"

	"github.com/projectqai/hydris/pkg/zlibutil"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

const (
	FlagGzip   = 1 << 0
	TypeEntity = 0 << 1
	typeMask   = 0b00001110
)

// Encode marshals entity and prepends the flags byte, compressing with zlib
// only when doing so actually shrinks the payload.
func Encode(entity *pb.Entity) ([]byte, error) {
	raw, err := proto.Marshal(entity)
	if err != nil {
		return nil, fmt.Errorf("marshal entity: %w", err)
	}

	flags := byte(TypeEntity)
	payload := raw
	if compressed, err := zlibutil.Compress(raw); err == nil && len(compressed) < len(raw) {
		flags |= FlagGzip
		payload = compressed
	}

	data := make([]byte, 1+len(payload))
	data[0] = flags
	copy(data[1:], payload)
	return data, nil
}

// Decode reverses Encode.
func Decode(data []byte) (*pb.Entity, error) {
	if len(data) < 1 {
		return nil, fmt.Errorf("hydris payload shorter than the flags byte: %d bytes", len(data))
	}
	flags := data[0]
	body := data[1:]

	if flags&FlagGzip != 0 {
		decompressed, err := zlibutil.Decompress(body)
		if err != nil {
			return nil, fmt.Errorf("decompress: %w", err)
		}
		body = decompressed
	}

	if msgType := flags & typeMask; msgType != TypeEntity {
		return nil, fmt.Errorf("unsupported hydris message type: %d", msgType)
	}

	var entity pb.Entity
	if err := proto.Unmarshal(body, &entity); err != nil {
		return nil, fmt.Errorf("unmarshal entity: %w", err)
	}
	return &entity, nil
}
