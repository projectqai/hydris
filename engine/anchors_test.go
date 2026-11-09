package engine

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"path/filepath"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type testCA struct {
	cert *x509.Certificate
	key  ed25519.PrivateKey
	pem  string
}

func newTestCA(t *testing.T, cn string) *testCA {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate CA key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign,
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, pub, priv)
	if err != nil {
		t.Fatalf("create CA certificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse CA certificate: %v", err)
	}
	return &testCA{cert: cert, key: priv, pem: certPEM(t, der)}
}

// issue mints a leaf signed by the CA, optionally carrying 802.1AR naming.
func (ca *testCA) issue(t *testing.T, serial string, eku []x509.ExtKeyUsage, exts ...pkix.Extension) *x509.Certificate {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate leaf key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:    big.NewInt(2),
		Subject:         pkix.Name{CommonName: "device", SerialNumber: serial},
		NotBefore:       time.Now().Add(-time.Hour),
		NotAfter:        time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC),
		KeyUsage:        x509.KeyUsageDigitalSignature,
		ExtKeyUsage:     eku,
		ExtraExtensions: exts,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, pub, ca.key)
	if err != nil {
		t.Fatalf("issue leaf: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	return cert
}

func certPEM(t *testing.T, der []byte) string {
	t.Helper()
	var buf bytes.Buffer
	if err := pem.Encode(&buf, &pem.Block{Type: "CERTIFICATE", Bytes: der}); err != nil {
		t.Fatalf("encode PEM: %v", err)
	}
	return buf.String()
}

// anchorEntity builds a trust anchor child of authn.service.
func anchorEntity(t *testing.T, id, parent, class, pemStr string) *pb.Entity {
	t.Helper()
	value, err := structpb.NewStruct(map[string]any{AnchorPEMKey: pemStr})
	if err != nil {
		t.Fatalf("build config struct: %v", err)
	}
	return &pb.Entity{
		Id:     id,
		Device: &pb.DeviceComponent{Parent: &parent, Class: &class},
		Config: &pb.ConfigurationComponent{Value: value},
	}
}

func testAnchorWorld(t *testing.T, entities map[string]*pb.Entity) *WorldServer {
	t.Helper()
	w := testWorld(entities)
	w.worldFile = filepath.Join(t.TempDir(), "world.pb")
	w.nodeID = "testnode"
	w.InitNodeSecrets()
	return w
}

// Only children of authn.service carrying the trust_anchor class become trust
// roots. An entity that merely looks like one elsewhere in the graph is ignored,
// so writing an entity is not enough to mint a CA.
func TestBuildAnchorSet_OnlyAuthnSubtree(t *testing.T) {
	acme := newTestCA(t, "Acme Root")
	rogue := newTestCA(t, "Rogue Root")
	leafOnly := newTestCA(t, "Leaf Issuer")
	notACA := leafOnly.issue(t, "SN1", []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})

	w := testAnchorWorld(t, map[string]*pb.Entity{
		"authn.anchor.acme":  anchorEntity(t, "authn.anchor.acme", AuthnServiceEntity, AnchorDeviceClass, acme.pem),
		"elsewhere.anchor":   anchorEntity(t, "elsewhere.anchor", "other.service", AnchorDeviceClass, rogue.pem),
		"authn.anchor.wrong": anchorEntity(t, "authn.anchor.wrong", AuthnServiceEntity, "camera", rogue.pem),
		"authn.anchor.leaf":  anchorEntity(t, "authn.anchor.leaf", AuthnServiceEntity, AnchorDeviceClass, certPEM(t, notACA.Raw)),
		"authn.anchor.empty": anchorEntity(t, "authn.anchor.empty", AuthnServiceEntity, AnchorDeviceClass, ""),
	})

	set := w.buildAnchorSetLocked()
	if len(set.ids) != 1 {
		t.Fatalf("expected exactly one anchor, got %d: %v", len(set.ids), set.ids)
	}
	if got := set.lookup(acme.cert); got != "authn.anchor.acme" {
		t.Errorf("lookup(acme) = %q, want authn.anchor.acme", got)
	}
	if got := set.lookup(rogue.cert); got != "" {
		t.Errorf("an anchor outside authn.service must be ignored, got %q", got)
	}
}

func TestBuildAnchorSet_SkipsExpired(t *testing.T) {
	hard := newTestCA(t, "Hard Expired")
	lapsed := newTestCA(t, "Lapsed")

	w := testAnchorWorld(t, map[string]*pb.Entity{
		"authn.anchor.hard":   anchorEntity(t, "authn.anchor.hard", AuthnServiceEntity, AnchorDeviceClass, hard.pem),
		"authn.anchor.lapsed": anchorEntity(t, "authn.anchor.lapsed", AuthnServiceEntity, AnchorDeviceClass, lapsed.pem),
	})
	w.head["authn.anchor.hard"].hardExpire = true
	w.head["authn.anchor.lapsed"].entity.Lifetime = &pb.Lifetime{
		Until: timestamppb.New(time.Now().Add(-time.Minute)),
	}

	if set := w.buildAnchorSetLocked(); len(set.ids) != 0 {
		t.Errorf("expired anchors must not be trusted, got %v", set.ids)
	}
}

func TestVerifyMTLS_AnchorSigned(t *testing.T) {
	acme := newTestCA(t, "Acme Root")
	w := testAnchorWorld(t, map[string]*pb.Entity{
		"authn.anchor.acme": anchorEntity(t, "authn.anchor.acme", AuthnServiceEntity, AnchorDeviceClass, acme.pem),
	})
	anchors := w.buildAnchorSetLocked()

	leaf := acme.issue(t, "SN123", []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})

	v, err := w.verifyMTLS([]*x509.Certificate{leaf}, anchors)
	if err != nil {
		t.Fatalf("anchor-signed certificate should verify: %v", err)
	}
	if v.anchor != "authn.anchor.acme" {
		t.Errorf("anchor = %q, want authn.anchor.acme", v.anchor)
	}
	if v.self {
		t.Error("an anchor-signed certificate must never be self")
	}
	if v.serial != "SN123" {
		t.Errorf("serial = %q, want SN123", v.serial)
	}
}

// A certificate from a CA that is not configured as an anchor is rejected, not
// silently treated as anonymous.
func TestVerifyMTLS_UnknownCA(t *testing.T) {
	acme := newTestCA(t, "Acme Root")
	rogue := newTestCA(t, "Rogue Root")
	w := testAnchorWorld(t, map[string]*pb.Entity{
		"authn.anchor.acme": anchorEntity(t, "authn.anchor.acme", AuthnServiceEntity, AnchorDeviceClass, acme.pem),
	})

	leaf := rogue.issue(t, "SN666", []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})
	if _, err := w.verifyMTLS([]*x509.Certificate{leaf}, w.buildAnchorSetLocked()); err == nil {
		t.Fatal("a certificate from an unconfigured CA must be rejected")
	}
}

// An anchor-signed certificate must be usable as a client certificate: a
// vendor's server certificates are not device identities.
func TestVerifyMTLS_AnchorRequiresClientAuth(t *testing.T) {
	acme := newTestCA(t, "Acme Root")
	w := testAnchorWorld(t, map[string]*pb.Entity{
		"authn.anchor.acme": anchorEntity(t, "authn.anchor.acme", AuthnServiceEntity, AnchorDeviceClass, acme.pem),
	})

	leaf := acme.issue(t, "SN123", []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth})
	if _, err := w.verifyMTLS([]*x509.Certificate{leaf}, w.buildAnchorSetLocked()); err == nil {
		t.Fatal("a server-auth-only certificate must not authenticate a device")
	}
}

// Adding anchors must not disturb the node's own bootstrap identity.
func TestVerifyMTLS_NodeCertUnaffected(t *testing.T) {
	acme := newTestCA(t, "Acme Root")
	w := testAnchorWorld(t, map[string]*pb.Entity{
		"authn.anchor.acme": anchorEntity(t, "authn.anchor.acme", AuthnServiceEntity, AnchorDeviceClass, acme.pem),
	})

	node, err := w.nodeCert()
	if err != nil {
		t.Fatalf("node certificate: %v", err)
	}
	v, err := w.verifyMTLS([]*x509.Certificate{node}, w.buildAnchorSetLocked())
	if err != nil {
		t.Fatalf("node cert should verify against itself: %v", err)
	}
	if !v.self {
		t.Error("presenting the node's own certificate must still be self")
	}
	if v.anchor != "" {
		t.Errorf("node-signed chain must carry no anchor, got %q", v.anchor)
	}
}

// No client certificate remains "no identity", not an error.
func TestVerifyMTLS_NoCert(t *testing.T) {
	w := testAnchorWorld(t, nil)
	v, err := w.verifyMTLS(nil, w.buildAnchorSetLocked())
	if v != nil || err != nil {
		t.Errorf("no certificate should yield (nil, nil), got (%v, %v)", v, err)
	}
}

func TestAuthnService_ShippedInDefaults(t *testing.T) {
	e := defaultEntity(t, AuthnServiceEntity)
	classes := e.GetConfigurable().GetSupportedDeviceClasses()
	for _, c := range classes {
		if c.Class == AnchorDeviceClass {
			return
		}
	}
	t.Fatalf("%s must offer the %s device class, got %v", AuthnServiceEntity, AnchorDeviceClass, classes)
}

// The shipped authz.policy must not let an untrusted caller mint a trust root.
func TestDefaultPolicy_TrustAnchorCreation(t *testing.T) {
	pe := testPolicyEvaluator(map[string]*pb.Entity{
		"admin.actor":       defaultEntity(t, "admin.actor"),
		"auth:anonymous":    defaultEntity(t, "auth:anonymous"),
		"authn.anchor.acme": anchorEntity(t, "authn.anchor.acme", AuthnServiceEntity, AnchorDeviceClass, ""),
	})
	rules := pe.compileChain(defaultPolicy(t))

	verdictFor := func(actor string, flags map[string]bool, change *pb.Entity) policyVerdict {
		ec := evalCtx{peer: peerContext{address: "10.0.0.1", port: "5000"}, actor: actor}
		return pe.evalChain(rules, buildGRPCActivation(ec, testIsFlags(flags), change), 0)
	}

	write := map[string]bool{"grpc": true, "write": true, "push": true, "create": true}
	parent := AuthnServiceEntity
	class := AnchorDeviceClass
	newAnchor := &pb.Entity{
		Id:     "authn.anchor.rogue",
		Device: &pb.DeviceComponent{Parent: &parent, Class: &class},
	}

	if v := verdictFor("auth:anonymous", write, newAnchor); v != verdictDeny {
		t.Errorf("anonymous must not create a trust anchor, got %v", v)
	}
	// Re-pointing an existing entity into the subtree is the same escalation.
	if v := verdictFor("auth:anonymous", write, &pb.Entity{Id: "innocent", Device: &pb.DeviceComponent{Parent: &parent}}); v != verdictDeny {
		t.Errorf("anonymous must not re-parent an entity under authn.service, got %v", v)
	}
	// Nor may it overwrite the PEM of an anchor that already exists.
	if v := verdictFor("auth:anonymous", write, &pb.Entity{Id: "authn.anchor.acme"}); v != verdictDeny {
		t.Errorf("anonymous must not rewrite an existing anchor, got %v", v)
	}
	// Expiring one is equally an attack on the trust set.
	expire := map[string]bool{"grpc": true, "write": true, "expire": true}
	if v := verdictFor("auth:anonymous", expire, &pb.Entity{Id: "authn.anchor.acme"}); v != verdictDeny {
		t.Errorf("anonymous must not expire an anchor, got %v", v)
	}
	// Admin is unaffected: its allow-all chain verdicts at the defer, before the guard.
	if v := verdictFor("admin.actor", write, newAnchor); v != verdictAllow {
		t.Errorf("admin.actor must still manage trust anchors, got %v", v)
	}
	// Ordinary entities are untouched by the guard.
	if v := verdictFor("auth:anonymous", write, &pb.Entity{Id: "sensor.1"}); v != verdictAllow {
		t.Errorf("the guard must not affect ordinary writes, got %v", v)
	}
}
