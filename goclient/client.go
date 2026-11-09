package goclient

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/projectqai/hydris/pkg/tracing"
	proto "github.com/projectqai/proto/go"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// ConnectOption configures an outbound connection.
type ConnectOption func(*connectOpts)

type connectOpts struct {
	clientCert *tls.Certificate
	serverFPs  []string
}

// WithClientCert presents cert as the mTLS client certificate. It applies only
// to TLS (https) connections; plaintext connections ignore it.
func WithClientCert(cert tls.Certificate) ConnectOption {
	return func(o *connectOpts) { o.clientCert = &cert }
}

// WithServerFingerprint pins the connection to the server's TLS leaf
// certificate and forbids plaintext transports. fpHex holds one or more hex
// SHA-256 fingerprints (colons ignored), separated by commas or whitespace —
// several pins allow a staged certificate rotation; the server must present
// one of them.
func WithServerFingerprint(fpHex string) ConnectOption {
	fps := parseFingerprints(fpHex)
	return func(o *connectOpts) { o.serverFPs = fps }
}

func parseFingerprints(s string) []string {
	var fps []string
	for _, tok := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' }) {
		fps = append(fps, strings.ToLower(strings.ReplaceAll(tok, ":", "")))
	}
	return fps
}

// verifyServerFingerprint returns a VerifyPeerCertificate callback enforcing
// the pin; it runs even with InsecureSkipVerify set.
func verifyServerFingerprint(fps []string) func([][]byte, [][]*x509.Certificate) error {
	return func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return fmt.Errorf("server presented no certificate")
		}
		sum := sha256.Sum256(rawCerts[0])
		got := hex.EncodeToString(sum[:])
		for _, fp := range fps {
			if got == fp {
				return nil
			}
		}
		return fmt.Errorf("server certificate fingerprint mismatch: got %s, pinned %s", got, strings.Join(fps, ","))
	}
}

// Connection wraps a gRPC connection with optional tunnel (WireGuard, SSH, etc.)
type Connection struct {
	*grpc.ClientConn
	Tunnel io.Closer // nil for plain connections
}

// Close closes the connection and tunnel if present
func (c *Connection) Close() error {
	if c.ClientConn != nil {
		_ = c.ClientConn.Close()
	}
	if c.Tunnel != nil {
		_ = c.Tunnel.Close()
	}
	return nil
}

// Tunnel represents a network tunnel (SSH, WireGuard) that can dial
// connections and be closed.
type Tunnel interface {
	Dial(ctx context.Context, address string) (net.Conn, error)
	Close() error
}

// ParseServer parses a server address and optional WireGuard config path,
// returning a tunnel (if any), the resolved remote address, and a display label.
func ParseServer(server, wgConfigPath string) (tunnel Tunnel, remoteAddr, label string, err error) {
	if strings.HasPrefix(server, "ssh://") {
		if wgConfigPath != "" {
			return nil, "", "", fmt.Errorf("cannot use both ssh:// and --wireguard")
		}
		dest := strings.TrimPrefix(server, "ssh://")
		t, e := NewSSHTunnel(dest)
		if e != nil {
			return nil, "", "", fmt.Errorf("SSH: %w", e)
		}
		return t, "localhost:50051", "SSH → " + dest, nil
	}

	if wgConfigPath != "" {
		cfg, e := ParseWireGuardConfig(wgConfigPath)
		if e != nil {
			return nil, "", "", e
		}
		t, e := NewWireGuardTunnel(cfg)
		if e != nil {
			return nil, "", "", fmt.Errorf("WireGuard: %w", e)
		}
		return t, server, "WireGuard", nil
	}

	return nil, server, "", nil
}

// ConnectURL establishes a working gRPC connection, parsing the server address
// for ssh:// URLs and optional WireGuard config. Unless the URL pins a scheme it
// tries TLS (with mTLS when a client cert is supplied) before plaintext; http://
// forces plaintext, https:// forces TLS. Because gRPC dials lazily, each
// candidate is probed with GetLocalNode so only a transport+auth that actually
// works is returned.
func ConnectURL(ctx context.Context, server, wgConfigPath string, options ...ConnectOption) (*Connection, error) {
	var o connectOpts
	for _, opt := range options {
		opt(&o)
	}

	tunnel, remoteAddr, _, err := ParseServer(server, wgConfigPath)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for _, cand := range connectCandidates(remoteAddr, o.clientCert != nil) {
		// A pinned connection is TLS-only: never fall back to plaintext.
		if len(o.serverFPs) > 0 && !strings.HasPrefix(cand.url, "https://") {
			if lastErr == nil {
				lastErr = fmt.Errorf("fingerprint pinning requires a TLS (https) transport")
			}
			continue
		}
		var cert *tls.Certificate
		if cand.useCert {
			cert = o.clientCert
		}
		target, opts, perr := parseServerURL(cand.url, cert, o.serverFPs)
		if perr != nil {
			lastErr = perr
			continue
		}
		if tunnel != nil {
			opts = append(opts, grpc.WithContextDialer(tunnel.Dial))
		}
		conn, derr := grpc.NewClient(target, opts...)
		if derr != nil {
			lastErr = derr
			continue
		}
		if perr := probeConn(ctx, conn); perr != nil {
			lastErr = perr
			_ = conn.Close()
			continue
		}
		return &Connection{ClientConn: conn, Tunnel: tunnel}, nil
	}

	if tunnel != nil {
		_ = tunnel.Close()
	}
	return nil, fmt.Errorf("connect to %s: %w", server, lastErr)
}

// connectCandidate is one transport attempt: a scheme-qualified URL and whether
// to present the mTLS client certificate.
type connectCandidate struct {
	url     string
	useCert bool
}

// connectCandidates orders the transports to try for a server address. A pinned
// http://hostname stays plaintext and https://hostname stays TLS; a bare
// host:port tries TLS first, then plaintext. For TLS targets a client cert is
// tried first (when available), then without it for remotes that predate mTLS.
func connectCandidates(remoteAddr string, hasCert bool) []connectCandidate {
	tlsAttempts := func(u string) []connectCandidate {
		if hasCert {
			return []connectCandidate{{u, true}, {u, false}}
		}
		return []connectCandidate{{u, false}}
	}
	switch {
	case strings.HasPrefix(remoteAddr, "http://"):
		return []connectCandidate{{remoteAddr, false}}
	case strings.HasPrefix(remoteAddr, "https://"):
		return tlsAttempts(remoteAddr)
	default:
		return append(tlsAttempts("https://"+remoteAddr), connectCandidate{"http://" + remoteAddr, false})
	}
}

// probeConn verifies a lazily-dialed connection actually works (transport +
// authentication) by issuing a GetLocalNode within a short timeout.
func probeConn(ctx context.Context, conn *grpc.ClientConn) error {
	probeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, err := proto.NewWorldServiceClient(conn).GetLocalNode(probeCtx, &proto.GetLocalNodeRequest{})
	return err
}

// SplitServerURL separates an optional http(s):// scheme from a server address.
// scheme is "http", "https", or "" for a bare host:port, returned unchanged.
func SplitServerURL(server string) (scheme, hostPort string) {
	u, err := url.Parse(server)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", server
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	return u.Scheme, u.Hostname() + ":" + port
}

// parseServerURL parses a server URL and returns the gRPC target and dial
// options. Supported formats:
//
//	host:port        (plaintext gRPC)
//	http://host[:port]  (plaintext, default port 80)
//	https://host[:port] (TLS, default port 443; self-signed, optional mTLS cert)
func parseServerURL(serverURL string, cert *tls.Certificate, serverFPs []string) (target string, opts []grpc.DialOption, err error) {
	// Callers inside a span get it propagated to the server (W3C traceparent).
	opts = append(opts, tracing.DialOptions()...)

	scheme, target := SplitServerURL(serverURL)
	if scheme != "https" {
		// http:// and bare host:port are plaintext.
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
		return target, opts, nil
	}

	// The node serves a self-signed certificate. Present a client cert when
	// one was supplied for this attempt, so the server can identify us via mTLS.
	tlsCfg := &tls.Config{
		InsecureSkipVerify: true,
		NextProtos:         []string{"h2"},
	}
	if len(serverFPs) > 0 {
		tlsCfg.VerifyPeerCertificate = verifyServerFingerprint(serverFPs)
	}
	if cert != nil {
		tlsCfg.Certificates = []tls.Certificate{*cert}
	}
	opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(tlsCfg)))
	return target, opts, nil
}

// Connect establishes a gRPC connection to the server.
// serverURL can be "host:port", "http://host", or "https://host".
func Connect(serverURL string, options ...ConnectOption) (*Connection, error) {
	var o connectOpts
	for _, opt := range options {
		opt(&o)
	}
	if len(o.serverFPs) > 0 && !strings.HasPrefix(serverURL, "https://") {
		return nil, fmt.Errorf("fingerprint pinning requires an https:// server URL")
	}
	target, opts, err := parseServerURL(serverURL, o.clientCert, o.serverFPs)
	if err != nil {
		return nil, err
	}

	conn, err := grpc.NewClient(target, opts...)
	if err != nil {
		return nil, err
	}
	return &Connection{ClientConn: conn}, nil
}

// ConnectWithWireGuard establishes a gRPC connection through a WireGuard tunnel
func ConnectWithWireGuard(serverAddr string, wgConfigPath string) (*Connection, error) {
	cfg, err := ParseWireGuardConfig(wgConfigPath)
	if err != nil {
		return nil, err
	}

	conn, tunnel, err := ConnectViaWireGuard(serverAddr, cfg)
	if err != nil {
		return nil, err
	}

	return &Connection{ClientConn: conn, Tunnel: tunnel}, nil
}

func isRetryableStreamError(err error) bool {
	if err == nil || err == io.EOF {
		return false
	}

	st, ok := status.FromError(err)
	if !ok {
		return false
	}

	switch st.Code() {
	case codes.Unavailable, codes.ResourceExhausted, codes.Aborted, codes.Internal, codes.Unknown:
		return true
	default:
		return false
	}
}

type resilientWatchEntitiesStream struct {
	ctx     context.Context
	client  proto.WorldServiceClient
	request *proto.ListEntitiesRequest
	stream  proto.WorldService_WatchEntitiesClient
}

func WatchEntitiesWithRetry(ctx context.Context, client proto.WorldServiceClient, req *proto.ListEntitiesRequest) (proto.WorldService_WatchEntitiesClient, error) {
	stream, err := client.WatchEntities(ctx, req)
	if err != nil {
		return nil, err
	}

	return &resilientWatchEntitiesStream{
		ctx:     ctx,
		client:  client,
		request: req,
		stream:  stream,
	}, nil
}

func (r *resilientWatchEntitiesStream) Recv() (*proto.EntityChangeEvent, error) {
	for {
		msg, err := r.stream.Recv()
		if err == nil {
			return msg, nil
		}

		slog.Debug("stream recv error", "error", err, "error_type", status.Code(err))

		if err == io.EOF {
			slog.Debug("received EOF, not retrying")
			return nil, err
		}

		if !isRetryableStreamError(err) {
			slog.Debug("error not retryable", "code", status.Code(err))
			return nil, err
		}

		if r.ctx.Err() != nil {
			slog.Debug("context cancelled", "error", r.ctx.Err())
			return nil, r.ctx.Err()
		}

		retryStartTime := time.Now()
		retryInterval := 1 * time.Second
		maxRetryInterval := 30 * time.Second
		attemptCount := 0

		for {
			attemptCount++

			select {
			case <-time.After(retryInterval):
			case <-r.ctx.Done():
				slog.Debug("context cancelled during wait")
				return nil, r.ctx.Err()
			}

			stream, err := r.client.WatchEntities(r.ctx, r.request)
			if err != nil {
				slog.Warn("reconnecting to world", "error", err, "attempt", attemptCount, "elapsed", time.Since(retryStartTime))
				retryInterval = min(retryInterval*2, maxRetryInterval)
				continue
			}

			r.stream = stream
			slog.Info("stream reconnected", "attempts", attemptCount, "elapsed", time.Since(retryStartTime))
			break
		}
	}
}

func (r *resilientWatchEntitiesStream) Header() (metadata.MD, error) {
	return r.stream.Header()
}

func (r *resilientWatchEntitiesStream) Trailer() metadata.MD {
	return r.stream.Trailer()
}

func (r *resilientWatchEntitiesStream) CloseSend() error {
	return r.stream.CloseSend()
}

func (r *resilientWatchEntitiesStream) Context() context.Context {
	return r.ctx
}

func (r *resilientWatchEntitiesStream) SendMsg(m interface{}) error {
	return r.stream.SendMsg(m)
}

func (r *resilientWatchEntitiesStream) RecvMsg(m interface{}) error {
	return r.stream.RecvMsg(m)
}
