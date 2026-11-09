package goclient

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestParseFingerprints(t *testing.T) {
	got := parseFingerprints("AA:BB, ccdd\n ee")
	want := []string{"aabb", "ccdd", "ee"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("token %d: got %q, want %q", i, got[i], want[i])
		}
	}
	if parseFingerprints("") != nil {
		t.Error("empty input should yield no fingerprints")
	}
}

func TestVerifyServerFingerprint(t *testing.T) {
	cert := []byte("not-a-real-cert-but-hashing-works")
	sum := sha256.Sum256(cert)
	fp := hex.EncodeToString(sum[:])

	if err := verifyServerFingerprint([]string{fp})([][]byte{cert}, nil); err != nil {
		t.Errorf("exact pin should verify: %v", err)
	}
	// Any pin in the set is enough (staged rotation).
	if err := verifyServerFingerprint([]string{strings.Repeat("0", 64), fp})([][]byte{cert}, nil); err != nil {
		t.Errorf("pin set containing the cert should verify: %v", err)
	}
	if err := verifyServerFingerprint([]string{strings.Repeat("0", 64)})([][]byte{cert}, nil); err == nil {
		t.Error("wrong pin should be rejected")
	}
	if err := verifyServerFingerprint([]string{fp})(nil, nil); err == nil {
		t.Error("missing certificate should be rejected")
	}
}

func TestSplitServerURL(t *testing.T) {
	cases := []struct {
		server, scheme, hostPort string
	}{
		{"192.168.11.101:50051", "", "192.168.11.101:50051"},
		{"localhost:50051", "", "localhost:50051"},
		{"https://192.168.11.101:50051", "https", "192.168.11.101:50051"},
		{"http://localhost:50051", "http", "localhost:50051"},
		{"https://node.example", "https", "node.example:443"},
		{"http://node.example", "http", "node.example:80"},
	}
	for _, c := range cases {
		scheme, hostPort := SplitServerURL(c.server)
		if scheme != c.scheme || hostPort != c.hostPort {
			t.Errorf("SplitServerURL(%q) = (%q, %q), want (%q, %q)", c.server, scheme, hostPort, c.scheme, c.hostPort)
		}
	}
}
