package hydrispayload

import (
	"strings"
	"testing"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func TestEncodeDecodeRoundTrips(t *testing.T) {
	want := &pb.Entity{Id: "entity-1", Device: &pb.DeviceComponent{}}

	data, err := Encode(want)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := Decode(data)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.GetId() != want.GetId() {
		t.Errorf("id = %q, want %q", got.GetId(), want.GetId())
	}
}

func TestDecodeRoundTripsGzip(t *testing.T) {
	entity := &pb.Entity{Id: "entity-1", Label: proto.String(strings.Repeat("padding to make gzip worth it ", 20))}

	data, err := Encode(entity)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if data[0]&FlagGzip == 0 {
		t.Fatal("expected Encode to choose gzip for a compressible payload")
	}

	got, err := Decode(data)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.GetId() != entity.GetId() {
		t.Errorf("id = %q, want %q", got.GetId(), entity.GetId())
	}
}

func TestEncodeSkipsGzipWhenItWouldNotShrink(t *testing.T) {
	data, err := Encode(&pb.Entity{Id: "x"})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if data[0]&FlagGzip != 0 {
		t.Error("expected Encode to skip gzip for a tiny payload it can't shrink")
	}
}

func TestDecodeRejectsTooShort(t *testing.T) {
	if _, err := Decode(nil); err == nil {
		t.Error("expected an error for an empty payload")
	}
}

func TestDecodeRejectsUnknownMessageType(t *testing.T) {
	if _, err := Decode([]byte{0b00001110}); err == nil {
		t.Error("expected an error for an unsupported message type")
	}
}
