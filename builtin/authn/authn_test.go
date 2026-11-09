package authn

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/projectqai/hydris/engine"
)

func testPEM(t *testing.T, cn string, isCA bool) string {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  isCA,
		BasicConstraintsValid: true,
	}
	if isCA {
		tmpl.KeyUsage = x509.KeyUsageCertSign
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, pub, priv)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	var buf bytes.Buffer
	if err := pem.Encode(&buf, &pem.Block{Type: "CERTIFICATE", Bytes: der}); err != nil {
		t.Fatalf("encode PEM: %v", err)
	}
	return buf.String()
}

func TestParseCAs(t *testing.T) {
	ca := testPEM(t, "Acme Root", true)

	certs, err := parseCAs(ca)
	if err != nil {
		t.Fatalf("a CA certificate should parse: %v", err)
	}
	if len(certs) != 1 || certs[0].Subject.CommonName != "Acme Root" {
		t.Fatalf("unexpected parse result: %+v", certs)
	}

	if _, err := parseCAs(ca + testPEM(t, "Acme Intermediate", true)); err != nil {
		t.Errorf("a bundle of CAs should parse: %v", err)
	}
}

// The operator must be told why an anchor was rejected; the engine only ignores
// it silently.
func TestParseCAs_Rejects(t *testing.T) {
	cases := map[string]string{
		"empty":       "",
		"not PEM":     "hunter2",
		"not a CA":    testPEM(t, "Acme Device", false),
		"private key": "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
		"bad DER":     "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
	}
	for name, input := range cases {
		if _, err := parseCAs(input); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

// The UI validator's verdict must match what the engine actually loads: the
// engine skips a non-CA block and keeps the CA, so a bundle holding one usable
// CA alongside a stray leaf must be accepted here too — reporting it Failed
// would tell the operator an anchor is broken that the engine is really
// trusting. parseCAs and the engine share ParseAnchorCerts precisely so this
// cannot drift.
func TestParseCAs_MirrorsEngineOnMixedBundle(t *testing.T) {
	ca := testPEM(t, "Acme Root", true)
	leaf := testPEM(t, "Acme Device", false)

	// The engine loads exactly the CA from this bundle.
	engineCerts, _ := engine.ParseAnchorCerts(ca + leaf)
	if len(engineCerts) != 1 {
		t.Fatalf("precondition: engine should load one CA, got %d", len(engineCerts))
	}

	certs, err := parseCAs(ca + leaf)
	if err != nil {
		t.Fatalf("a bundle the engine accepts must not be reported as failed: %v", err)
	}
	if len(certs) != 1 || certs[0].Subject.CommonName != "Acme Root" {
		t.Fatalf("parseCAs disagrees with the engine: %+v", certs)
	}
}

// The schema's field name is what the operator fills in and what the engine
// reads back out; they must be the same key.
func TestAnchorSchema_MatchesEngineKey(t *testing.T) {
	props := anchorSchema().GetFields()["properties"].GetStructValue().GetFields()
	if _, ok := props[engine.AnchorPEMKey]; !ok {
		t.Fatalf("schema has no %q property, got %v", engine.AnchorPEMKey, props)
	}
}
