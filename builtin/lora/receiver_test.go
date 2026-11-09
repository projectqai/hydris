package lora

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func rxpkEnvelope(t *testing.T, frame []byte, rssi, lsnr float64, stat int) []byte {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"rxpk": []map[string]any{{
			"data": base64.StdEncoding.EncodeToString(frame),
			"rssi": rssi,
			"lsnr": lsnr,
			"stat": stat,
		}},
	})
	if err != nil {
		t.Fatalf("marshal rxpk envelope: %v", err)
	}
	return body
}

func captures(entities []*pb.Entity) []*pb.Entity {
	var out []*pb.Entity
	for _, e := range entities {
		if e.GetCapture() != nil {
			out = append(out, e)
		}
	}
	return out
}

func TestDecodeFrameRejectsShorterThanHeader(t *testing.T) {
	for _, frame := range [][]byte{nil, {}} {
		if _, _, ok := decodeFrame(frame); ok {
			t.Errorf("decodeFrame(%v) ok=true, want false (shorter than the header)", frame)
		}
	}
}

func TestParseGWMPPushData(t *testing.T) {
	gwEUI := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	body := []byte(`{"rxpk":[]}`)
	raw := append([]byte{0x02, 0xAB, 0xCD, gwmpPushData}, append(gwEUI, body...)...)

	pkt, err := parseGWMP(raw)
	if err != nil {
		t.Fatalf("parseGWMP: %v", err)
	}
	if pkt.kind != gwmpPushData {
		t.Errorf("kind = 0x%02X, want PUSH_DATA", pkt.kind)
	}
	if pkt.token != [2]byte{0xAB, 0xCD} {
		t.Errorf("token = %v, want [0xAB 0xCD]", pkt.token)
	}
	if string(pkt.body) != string(body) {
		t.Errorf("body = %q, want %q", pkt.body, body)
	}
}

func TestParseGWMPAckMirrorsVersionAndToken(t *testing.T) {
	pkt := gwmpPacket{version: 0x02, token: [2]byte{0x11, 0x22}, kind: gwmpPushData}
	want := []byte{0x02, 0x11, 0x22, gwmpPushAck}
	if got := pkt.ack(gwmpPushAck); string(got) != string(want) {
		t.Errorf("ack = %v, want %v", got, want)
	}
}

func TestGWMPReplyAcksPushAndPullData(t *testing.T) {
	gwEUI := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	for kind, want := range map[uint8]uint8{gwmpPushData: gwmpPushAck, gwmpPullData: gwmpPullAck} {
		pkt, err := parseGWMP(append([]byte{0x02, 0x11, 0x22, kind}, gwEUI...))
		if err != nil {
			t.Fatalf("parseGWMP(kind 0x%02X): %v", kind, err)
		}
		if got := pkt.reply(); string(got) != string([]byte{0x02, 0x11, 0x22, want}) {
			t.Errorf("reply for kind 0x%02X = %v, want ack 0x%02X", kind, got, want)
		}
	}
	if got := (gwmpPacket{kind: 0x05}).reply(); got != nil {
		t.Errorf("reply for TX_ACK = %v, want nil", got)
	}
}

func TestParseGWMPRejectsShortPackets(t *testing.T) {
	if _, err := parseGWMP([]byte{0x02, 0x00}); err == nil {
		t.Error("expected an error for a packet shorter than the GWMP header")
	}
	if _, err := parseGWMP([]byte{0x02, 0x00, 0x00, gwmpPushData}); err == nil {
		t.Error("expected an error for PUSH_DATA shorter than the gateway-EUI header")
	}
}

func TestDecodePushDataDropsBadCRC(t *testing.T) {
	body := rxpkEnvelope(t, []byte{0x4E, 0x00, 0xAA}, -97, 7.5, -1)
	if entities := decodePushData(body, "gw-1"); entities != nil {
		t.Errorf("got %d entities, want none for a bad-CRC rxpk", len(entities))
	}
}

func TestDecodePushDataDropsEmptyFrame(t *testing.T) {
	body := rxpkEnvelope(t, []byte{}, -80, 5, 1)
	if entities := decodePushData(body, "gw-1"); entities != nil {
		t.Errorf("got %d entities, want none for a frame without a port byte", len(entities))
	}
}

func TestDecodePushDataStatusOnlyBodyProducesNothing(t *testing.T) {
	body, err := json.Marshal(map[string]any{
		"stat": map[string]any{"rxnb": 1, "rxok": 1},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if entities := decodePushData(body, "gw-1"); entities != nil {
		t.Errorf("got %d entities, want none for a stat-only heartbeat", len(entities))
	}
}

func TestDecodePushDataPublishesOnlyCaptureRecords(t *testing.T) {
	for _, port := range []byte{0x4F, 0x4E, 0x01} {
		payload := []byte{0x63, 0x00, 0x07, 0x00, 0x00, 0x00, 0x09, 0xDE, 0xAD}
		body := rxpkEnvelope(t, append([]byte{port}, payload...), -101, -3.4, 1)

		entities := decodePushData(body, "gw-1")
		if len(entities) != 1 || len(captures(entities)) != 1 {
			t.Fatalf("port %#x: got %d entities, want exactly one capture record", port, len(entities))
		}
		c := entities[0]
		if c.GetCapture().GetPort() != uint32(port) {
			t.Errorf("port = %d, want %#x", c.GetCapture().GetPort(), port)
		}
		if string(c.GetCapture().GetPayload()) != string(payload) {
			t.Errorf("payload = %x, want the bytes after the port", c.GetCapture().GetPayload())
		}
		if c.GetCapture().GetCapturedBy() != "gw-1" || c.GetLink().GetVia() != "gw-1" {
			t.Error("capture must name the gateway")
		}
		if c.GetLink().GetRssiDbm() != -101 {
			t.Errorf("rssi = %d", c.GetLink().GetRssiDbm())
		}
		if c.GetRouting() != nil {
			t.Errorf("raw frames stay local, got routing %v", c.GetRouting())
		}
		if !c.GetLifetime().GetUntil().IsValid() {
			t.Error("a capture record must expire")
		}
	}
}

func TestCaptureEntityIDIsStableForTheSameFrame(t *testing.T) {
	now := time.Now()
	a := CaptureEntity("gw-1", 0x4F, []byte{1, 2, 3}, proto.Float64(-90), proto.Float64(5), now)
	b := CaptureEntity("gw-1", 0x4F, []byte{1, 2, 3}, proto.Float64(-80), proto.Float64(6), now.Add(time.Second))
	c := CaptureEntity("gw-1", 0x4F, []byte{1, 2, 4}, proto.Float64(-90), proto.Float64(5), now)
	d := CaptureEntity("gw-2", 0x4F, []byte{1, 2, 3}, proto.Float64(-90), proto.Float64(5), now)
	if a.Id != b.Id {
		t.Errorf("same frame at the same gateway must map to one entity: %s vs %s", a.Id, b.Id)
	}
	if a.Id == c.Id {
		t.Error("different frames must not collide")
	}
	if a.Id == d.Id {
		t.Error("the same frame heard by two gateways is two records")
	}
}
