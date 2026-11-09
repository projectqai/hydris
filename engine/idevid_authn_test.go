package engine

import (
	"crypto/x509"
	"testing"

	pb "github.com/projectqai/proto/go"
)

// idevidWorld builds a world with one anchor and, optionally, a pre-created
// identity entity for the device, then returns an evaluator running the shipped
// authn.policy.
func idevidWorld(t *testing.T, ca *testCA, identity string) (*PolicyEvaluator, *anchorSet) {
	t.Helper()
	entities := map[string]*pb.Entity{
		"authn.anchor.acme": anchorEntity(t, "authn.anchor.acme", AuthnServiceEntity, AnchorDeviceClass, ca.pem),
		authnPolicyEntity:   defaultEntity(t, authnPolicyEntity),
	}
	if identity != "" {
		entities[identity] = &pb.Entity{Id: identity}
	}

	w := testAnchorWorld(t, entities)
	pe := NewPolicyEvaluator(w)
	pe.Rebuild()
	return pe, w.buildAnchorSetLocked()
}

func idevidLeaf(t *testing.T, ca *testCA, serial string) *x509.Certificate {
	t.Helper()
	return ca.issue(t, serial, []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})
}

// remotePeer is a non-local peer, so the trusted-connection rule cannot mask
// what the IDevID rule resolves.
func remotePeer() peerContext {
	return peerContext{address: "10.0.0.7", port: "44300"}
}

// End to end over the shipped authn.policy: an anchor-signed IDevID whose
// identity entity exists resolves to that entity.
func TestAuthn_IDevIDResolvesToPreCreatedIdentity(t *testing.T) {
	ca := newTestCA(t, "Acme Root")
	const identity = "authn.anchor.acme.SN123"
	pe, anchors := idevidWorld(t, ca, identity)

	verified, err := pe.world.verifyMTLS([]*x509.Certificate{idevidLeaf(t, ca, "SN123")}, anchors)
	if err != nil {
		t.Fatalf("IDevID should verify: %v", err)
	}
	if got := pe.evalAuthn(remotePeer(), false, verified); got != identity {
		t.Errorf("actor = %q, want %q", got, identity)
	}
}

// A genuine device from a trusted vendor that nobody enrolled is still a
// stranger: it must not gain an identity just by being authentic.
func TestAuthn_IDevIDWithoutIdentityIsAnonymous(t *testing.T) {
	ca := newTestCA(t, "Acme Root")
	pe, anchors := idevidWorld(t, ca, "")

	verified, err := pe.world.verifyMTLS([]*x509.Certificate{idevidLeaf(t, ca, "SN999")}, anchors)
	if err != nil {
		t.Fatalf("IDevID should verify: %v", err)
	}
	if got := pe.evalAuthn(remotePeer(), false, verified); got != anonymousEntity {
		t.Errorf("actor = %q, want %q", got, anonymousEntity)
	}
}

// Serials are namespaced by anchor: an identity enrolled under one anchor must
// not be reachable with the same serial issued by another.
func TestAuthn_IDevIDSerialIsNamespacedByAnchor(t *testing.T) {
	acme := newTestCA(t, "Acme Root")
	other := newTestCA(t, "Other Root")

	w := testAnchorWorld(t, map[string]*pb.Entity{
		"authn.anchor.acme":       anchorEntity(t, "authn.anchor.acme", AuthnServiceEntity, AnchorDeviceClass, acme.pem),
		"authn.anchor.other":      anchorEntity(t, "authn.anchor.other", AuthnServiceEntity, AnchorDeviceClass, other.pem),
		"authn.anchor.acme.SN123": {Id: "authn.anchor.acme.SN123"},
		authnPolicyEntity:         defaultEntity(t, authnPolicyEntity),
	})
	pe := NewPolicyEvaluator(w)
	pe.Rebuild()
	anchors := w.buildAnchorSetLocked()

	verified, err := pe.world.verifyMTLS([]*x509.Certificate{idevidLeaf(t, other, "SN123")}, anchors)
	if err != nil {
		t.Fatalf("IDevID should verify: %v", err)
	}
	if got := pe.evalAuthn(remotePeer(), false, verified); got != anonymousEntity {
		t.Errorf("a serial enrolled under a different anchor must not authenticate, got %q", got)
	}
}

// A certificate with no 802.1AR serial cannot select an identity, however it was
// signed.
func TestAuthn_AnchorWithoutSerialIsAnonymous(t *testing.T) {
	ca := newTestCA(t, "Acme Root")
	pe, anchors := idevidWorld(t, ca, "authn.anchor.acme.")

	leaf := ca.issue(t, "", []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})
	verified, err := pe.world.verifyMTLS([]*x509.Certificate{leaf}, anchors)
	if err != nil {
		t.Fatalf("certificate should verify: %v", err)
	}
	if got := pe.evalAuthn(remotePeer(), false, verified); got != anonymousEntity {
		t.Errorf("actor = %q, want %q", got, anonymousEntity)
	}
}

// The node's own certificate stays admin now that a second trust path exists.
func TestAuthn_NodeCertStillAdmin(t *testing.T) {
	ca := newTestCA(t, "Acme Root")
	pe, anchors := idevidWorld(t, ca, "")

	node, err := pe.world.nodeCert()
	if err != nil {
		t.Fatalf("node certificate: %v", err)
	}
	verified, err := pe.world.verifyMTLS([]*x509.Certificate{node}, anchors)
	if err != nil {
		t.Fatalf("node cert should verify: %v", err)
	}
	if got := pe.evalAuthn(remotePeer(), false, verified); got != adminActorEntity {
		t.Errorf("actor = %q, want %q", got, adminActorEntity)
	}
}

// The shipped device template: a device writes its own entity and nothing else
// — least of all its own policy.
func TestIDevIDDevicePolicy(t *testing.T) {
	const device = "authn.anchor.acme.SN123"
	pe := testPolicyEvaluator(map[string]*pb.Entity{
		device: {Id: device, Policy: &pb.PolicyComponent{Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionDefer, Cel: celStr(`"policy.idevid.device"`)},
		}}},
		"policy.idevid.device": defaultEntity(t, "policy.idevid.device"),
	})
	rules := pe.compileChain(defaultPolicy(t))

	verdictFor := func(flags map[string]bool, change *pb.Entity) policyVerdict {
		ec := evalCtx{peer: remotePeer(), actor: device}
		return pe.evalChain(rules, buildGRPCActivation(ec, testIsFlags(flags), change), 0)
	}
	write := map[string]bool{"grpc": true, "write": true, "push": true, "update": true}

	if v := verdictFor(write, &pb.Entity{Id: device}); v != verdictAllow {
		t.Errorf("device should be allowed to write its own entity, got %v", v)
	}

	denied := []string{
		"authn.anchor.acme.SN124",  // another device
		"authn.anchor.acme.SN1230", // prefix collision, not an exact match
		device + ".detection",      // only the device's own entity is writable
		"authz.policy",             // the global chain
		"authn.anchor.acme",        // its own trust anchor
	}
	for _, id := range denied {
		if v := verdictFor(write, &pb.Entity{Id: id}); v != verdictDeny {
			t.Errorf("device must not write %s, got %v", id, v)
		}
	}

	// Self-escalation: writing a policy onto its own entity.
	escalation := &pb.Entity{Id: device, Policy: &pb.PolicyComponent{Rules: []*pb.PolicyRule{
		{Action: pb.PolicyAction_PolicyActionAllow},
	}}}
	if v := verdictFor(write, escalation); v != verdictDeny {
		t.Errorf("device must not write its own policy, got %v", v)
	}

	// Re-parenting itself under authn.service would mint a trust anchor.
	parent := AuthnServiceEntity
	class := AnchorDeviceClass
	mint := &pb.Entity{Id: device, Device: &pb.DeviceComponent{Parent: &parent, Class: &class}}
	if v := verdictFor(write, mint); v != verdictDeny {
		t.Errorf("device must not turn its own entity into a trust anchor, got %v", v)
	}

	// Reads are permitted; the trailing Deny must not lock the device out.
	if v := verdictFor(map[string]bool{"grpc": true, "read": true}, &pb.Entity{}); v != verdictAllow {
		t.Errorf("device should be allowed to read, got %v", v)
	}
}
