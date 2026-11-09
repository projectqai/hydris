package mdns

import (
	"encoding/binary"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// wireName encodes labels verbatim, so a label may contain a '.', which
// dnsmessage refuses to build but real responders (Apple sleep proxies) send.
func wireName(labels ...string) []byte {
	var b []byte
	for _, l := range labels {
		b = append(b, byte(len(l)))
		b = append(b, l...)
	}
	return append(b, 0)
}

func rr(owner []byte, typ dnsmessage.Type, rdata []byte) []byte {
	b := append([]byte(nil), owner...)
	b = binary.BigEndian.AppendUint16(b, uint16(typ))
	b = binary.BigEndian.AppendUint16(b, uint16(dnsmessage.ClassINET))
	b = binary.BigEndian.AppendUint32(b, 120)
	b = binary.BigEndian.AppendUint16(b, uint16(len(rdata)))
	return append(b, rdata...)
}

// Replays a response whose PTR target has a dot inside one label. The
// parser stays on a record whose body fails to parse, so handlePacket must
// drop the packet instead of asking for the next header forever.
func TestHandlePacketBadRecordDoesNotHang(t *testing.T) {
	svc := wireName("_hydristest", "_tcp", "local")
	bad := rr(svc, dnsmessage.TypePTR,
		wireName("70-35-60-63.1 Wohnzimmer", "_hydristest", "_tcp", "local"))

	for _, tc := range []struct {
		name   string
		an, ar [][]byte
	}{
		{"answer", [][]byte{bad}, nil},
		{"additional", nil, [][]byte{bad}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			msg := make([]byte, 12)
			binary.BigEndian.PutUint16(msg[2:], 0x8400) // response, authoritative
			binary.BigEndian.PutUint16(msg[6:], uint16(len(tc.an)))
			binary.BigEndian.PutUint16(msg[10:], uint16(len(tc.ar)))
			for _, r := range append(tc.an, tc.ar...) {
				msg = append(msg, r...)
			}

			sn, err := serviceFQDN("_hydristest._tcp")
			if err != nil {
				t.Fatal(err)
			}
			b := &browser{serviceName: sn, instances: map[string]*instanceState{}}
			done := make(chan struct{})
			go func() {
				b.handlePacket(msg, 0)
				close(done)
			}()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Fatal("handlePacket did not return: parser stuck on a bad record")
			}
		})
	}
}
