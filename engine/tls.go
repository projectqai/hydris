package engine

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"path/filepath"
	"time"
)

// NodeTLSCert holds the node's TLS certificate once loaded, for use by
// federation and other subsystems that need to present it as a client cert.
var NodeTLSCert *tls.Certificate

// nodeTLSPath returns the on-disk location of the node's TLS keypair: a plain
// PEM file sitting next to the artifact store (a sibling of the artifacts/
// directory), not inside it. Secrets are not artifacts, and keeping the key out
// of the world graph means a HardReset — which wipes entities and artifact
// blobs — cannot destroy the node's stable identity. StartEngine guarantees a
// non-empty worldFile, so this always resolves to a concrete path.
func (s *WorldServer) nodeTLSPath() string {
	return filepath.Join(filepath.Dir(s.worldFile), "node-tls.pem")
}

// InitNodeSecrets ensures the node has a TLS identity: a long-lived,
// self-signed ed25519 certificate persisted as a plaintext PEM file on disk,
// exactly like a conventional server TLS key. Because the file lives outside
// the world graph, it survives a HardReset, so the node keeps a stable
// fingerprint and a stable bootstrap secret across resets.
func (s *WorldServer) InitNodeSecrets() {
	path := s.nodeTLSPath()
	if path == "" {
		return
	}
	if _, err := os.Stat(path); err == nil {
		s.logNodeFingerprint()
		return
	}

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		slog.Error("failed to generate TLS key", "error", err)
		return
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		slog.Error("failed to generate serial number", "error", err)
		return
	}

	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "hydris-node-" + s.nodeID},
		NotBefore:    now,
		NotAfter:     now.Add(10 * 365 * 24 * time.Hour),
		// The node cert doubles as a CA so it can sign peer (federation) client
		// certs; authn.policy then walks the verified chain rooted at this cert.
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		IsCA:                  true,
		BasicConstraintsValid: true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, pub, priv)
	if err != nil {
		slog.Error("failed to create TLS certificate", "error", err)
		return
	}

	keyDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		slog.Error("failed to marshal TLS key", "error", err)
		return
	}

	var buf bytes.Buffer
	if err := pem.Encode(&buf, &pem.Block{Type: "CERTIFICATE", Bytes: certDER}); err != nil {
		slog.Error("failed to encode TLS certificate", "error", err)
		return
	}
	if err := pem.Encode(&buf, &pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}); err != nil {
		slog.Error("failed to encode TLS key", "error", err)
		return
	}

	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		slog.Error("failed to store TLS certificate", "error", err)
		return
	}

	fp := sha256.Sum256(certDER)
	slog.Info("generated node TLS certificate", "fingerprint", colonHex(fp[:]))
}

// loadNodeTLS reads and parses the node's TLS keypair from disk.
func (s *WorldServer) loadNodeTLS() (*tls.Certificate, error) {
	data, err := s.nodeTLSPEM()
	if err != nil {
		return nil, fmt.Errorf("node TLS cert not found: %w", err)
	}

	var certPEM, keyPEM []byte
	for {
		block, rest := pem.Decode(data)
		if block == nil {
			break
		}
		switch block.Type {
		case "CERTIFICATE":
			certPEM = append(certPEM, pem.EncodeToMemory(block)...)
		case "PRIVATE KEY":
			keyPEM = append(keyPEM, pem.EncodeToMemory(block)...)
		}
		data = rest
	}

	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to parse TLS keypair: %w", err)
	}
	return &cert, nil
}

// logNodeFingerprint logs the SHA-256 fingerprint of the existing node
// certificate, so operators can pin it for federation.
func (s *WorldServer) logNodeFingerprint() {
	data, err := s.nodeTLSPEM()
	if err != nil {
		return
	}
	block, _ := pem.Decode(data)
	if block == nil || block.Type != "CERTIFICATE" {
		return
	}
	fp := sha256.Sum256(block.Bytes)
	slog.Info("node TLS certificate", "fingerprint", colonHex(fp[:]))
}

// nodeTLSPEM reads the raw PEM (certificate + private key) from disk.
func (s *WorldServer) nodeTLSPEM() ([]byte, error) {
	data, err := os.ReadFile(s.nodeTLSPath())
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("node TLS file is empty")
	}
	return data, nil
}

// nodeCert parses the node's own TLS leaf certificate, used to test whether a
// presented client certificate was signed by this node.
func (s *WorldServer) nodeCert() (*x509.Certificate, error) {
	tc, err := s.loadNodeTLS()
	if err != nil {
		return nil, err
	}
	if tc.Leaf != nil {
		return tc.Leaf, nil
	}
	if len(tc.Certificate) == 0 {
		return nil, fmt.Errorf("node certificate missing")
	}
	return x509.ParseCertificate(tc.Certificate[0])
}

// verifiedCert is the cryptographically validated identity of an mTLS peer:
// only populated once the presented chain checks out against this node's CA.
type verifiedCert struct {
	cn          string // leaf subject CommonName
	fingerprint string // leaf certificate SHA-256 (colon-hex)
	ca          string // issuing CA CommonName
	self        bool   // leaf IS this node's own cert (admin bootstrap)
}

// verifyMTLS validates the presented peer certificates (leaf first, optional
// intermediates) against this node's certificate as the trust root. It returns
// the verified leaf identity, or nil if no certificate was presented OR the
// chain does not validate. A non-nil error means a certificate WAS presented but
// failed validation, so the caller must deny the connection.
func (s *WorldServer) verifyMTLS(certs []*x509.Certificate) (*verifiedCert, error) {
	if len(certs) == 0 {
		return nil, nil
	}
	node, err := s.nodeCert()
	if err != nil || node == nil {
		return nil, fmt.Errorf("node CA unavailable")
	}
	roots := x509.NewCertPool()
	roots.AddCert(node)
	intermediates := x509.NewCertPool()
	for _, c := range certs[1:] {
		intermediates.AddCert(c)
	}
	if _, err := certs[0].Verify(x509.VerifyOptions{
		Roots:         roots,
		Intermediates: intermediates,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	}); err != nil {
		return nil, fmt.Errorf("mTLS certificate not signed by this node: %w", err)
	}
	leaf := certs[0]
	sum := sha256.Sum256(leaf.Raw)
	return &verifiedCert{
		cn:          leaf.Subject.CommonName,
		fingerprint: colonHex(sum[:]),
		ca:          leaf.Issuer.CommonName,
		// Only the node's own cert is byte-identical to the trust root; holding
		// that keypair is admin. Safe only because the handshake proved private-key
		// possession (the cert is public) — see SECURITY note in engine/world.go.
		self: bytes.Equal(leaf.Raw, node.Raw),
	}, nil
}
