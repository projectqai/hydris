package engine

import (
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log/slog"
	"time"

	pb "github.com/projectqai/proto/go"
)

// Trust anchors are the vendor CAs whose device certificates (IEEE 802.1AR
// IDevIDs) this node accepts. Each anchor is a configurable child device of
// authn.service, so an operator can add one from the UI like any other device.
//
// SECURITY: only that subtree is scanned. Discovering anchors by id pattern
// would let anyone who can write an entity mint a trust root; requiring
// device.parent == authn.service confines minting to a single subtree that one
// policy rule can guard.

const (
	// AuthnServiceEntity is the device parent of trust anchor entities.
	AuthnServiceEntity = "authn.service"
	// AnchorDeviceClass marks a child of authn.service as a trust anchor.
	AnchorDeviceClass = "trust_anchor"
	// AnchorPEMKey is the config field holding an anchor's PEM certificate(s).
	AnchorPEMKey = "pem"
)

// anchorSet is the compiled trust anchor pool, rebuilt whenever the
// authn.service subtree changes.
type anchorSet struct {
	pool *x509.CertPool
	ids  map[string]string // certificate DER -> anchor entity id
}

func (a *anchorSet) empty() bool { return a == nil || len(a.ids) == 0 }

// lookup maps the root of a verified chain back to the anchor entity that
// configured it. Policy keys off this id, never the issuer name, which any
// anchor could duplicate.
func (a *anchorSet) lookup(root *x509.Certificate) string {
	if a == nil || root == nil {
		return ""
	}
	return a.ids[string(root.Raw)]
}

// buildAnchorSetLocked compiles the anchors configured under authn.service.
// Caller must hold s.l.
func (s *WorldServer) buildAnchorSetLocked() *anchorSet {
	set := &anchorSet{pool: x509.NewCertPool(), ids: make(map[string]string)}
	now := time.Now()
	for id, es := range s.head {
		if !isTrustAnchorLocked(es) {
			continue
		}
		if until := lifetimeUntil(es.entity.Lifetime); !until.IsZero() && now.After(until) {
			continue
		}
		for _, cert := range parseAnchorPEM(id, es.entity) {
			set.pool.AddCert(cert)
			set.ids[string(cert.Raw)] = id
		}
	}
	return set
}

// isTrustAnchorLocked reports whether an entity is a live trust anchor.
// Caller must hold s.l.
func isTrustAnchorLocked(es *entityState) bool {
	if es == nil || es.hardExpire {
		return false
	}
	d := es.entity.GetDevice()
	return d.GetParent() == AuthnServiceEntity && d.GetClass() == AnchorDeviceClass
}

// isAuthnSubtreeLocked reports whether a changed entity id affects the anchor
// set, so a push or expiry on it triggers a policy rebuild. Caller must hold s.l.
func (s *WorldServer) isAuthnSubtreeLocked(id string) bool {
	if id == AuthnServiceEntity {
		return true
	}
	return isTrustAnchorLocked(s.head[id])
}

// ParseAnchorCerts extracts the usable CA certificates from an anchor PEM,
// along with a note for every block it had to skip. A bundle is acceptable
// exactly when it yields at least one certificate. This is the single source of
// truth for what the node will trust: both the engine (which logs and keeps the
// usable certs) and the authn controller's UI validation call it, so the
// operator's pass/fail verdict cannot drift from what the engine actually loads.
func ParseAnchorCerts(raw string) (certs []*x509.Certificate, skipped []string) {
	rest := []byte(raw)
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			skipped = append(skipped, fmt.Sprintf("unparseable certificate: %v", err))
			continue
		}
		if !cert.IsCA {
			skipped = append(skipped, fmt.Sprintf("%q is not a CA certificate", cert.Subject.CommonName))
			continue
		}
		certs = append(certs, cert)
	}
	return certs, skipped
}

// parseAnchorPEM extracts the CA certificates an anchor entity carries, skipping
// (but logging) any block that is not a usable issuing CA.
func parseAnchorPEM(id string, e *pb.Entity) []*x509.Certificate {
	raw := e.GetConfig().GetValue().GetFields()[AnchorPEMKey].GetStringValue()
	if raw == "" {
		return nil
	}
	certs, skipped := ParseAnchorCerts(raw)
	for _, s := range skipped {
		slog.Warn("trust anchor certificate skipped", "anchor", id, "reason", s)
	}
	if len(certs) == 0 {
		slog.Warn("trust anchor has no usable CA certificate", "anchor", id)
	}
	return certs
}
