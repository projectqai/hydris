// Package muxlistener provides a protocol-multiplexing net.Listener that
// peeks at the first bytes of each accepted connection to determine whether
// it speaks TLS, RTSP, HTTP, or ICE/STUN, then routes it to the appropriate
// sub-listener. TLS connections are transparently terminated and re-routed
// as HTTP/RTSP based on the decrypted stream.
package muxlistener

import (
	"bufio"
	"crypto/tls"
	"net"
	"strings"
	"sync"
	"time"
)

// rtspMethods are the RTSP request methods. If the first line of a connection
// matches "<METHOD> rtsp://" or ends with "RTSP/1.0", we treat it as RTSP.
var rtspMethods = []string{"OPTIONS", "DESCRIBE", "ANNOUNCE", "SETUP", "PLAY", "PAUSE", "TEARDOWN", "GET_PARAMETER", "SET_PARAMETER", "REDIRECT", "RECORD"}

// MuxListener wraps a net.Listener and routes accepted connections to
// either an RTSP, HTTP, or ICE sub-listener based on protocol detection.
type MuxListener struct {
	inner net.Listener

	// tlsConfig, when non-nil, is used to terminate TLS connections detected
	// by their ClientHello record. The decrypted stream is then routed as
	// HTTP or RTSP. If nil, TLS connections are routed as plain HTTP (and
	// will fail to parse), so callers serving TLS must provide a config.
	tlsConfig *tls.Config

	httpCh chan net.Conn
	rtspCh chan net.Conn
	iceCh  chan net.Conn

	once    sync.Once
	closeCh chan struct{}
}

// New creates a MuxListener that routes connections from inner. When
// tlsConfig is non-nil, connections beginning with a TLS ClientHello are
// terminated with that config before protocol detection.
// Call RTSP() and HTTP() to obtain the sub-listeners, then call Serve()
// to start accepting and routing.
func New(inner net.Listener, tlsConfig *tls.Config) *MuxListener {
	return &MuxListener{
		inner:     inner,
		tlsConfig: tlsConfig,
		httpCh:    make(chan net.Conn, 16),
		rtspCh:    make(chan net.Conn, 16),
		iceCh:     make(chan net.Conn, 16),
		closeCh:   make(chan struct{}),
	}
}

// Serve accepts connections from the inner listener and routes them.
// It blocks until the inner listener is closed or Close is called.
func (m *MuxListener) Serve() error {
	for {
		conn, err := m.inner.Accept()
		if err != nil {
			select {
			case <-m.closeCh:
				return nil
			default:
			}
			return err
		}

		go m.route(conn)
	}
}

func (m *MuxListener) route(conn net.Conn) {
	// Bound protocol detection (peek, TLS handshake, and first line) so a
	// stalled peer cannot tie up a routing goroutine indefinitely.
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))

	br := bufio.NewReaderSize(conn, 512)

	// Peek at the first byte. TLS records begin with 0x16 (handshake);
	// ICE/STUN-over-TCP uses a length prefix whose first byte is < 0x20;
	// HTTP and RTSP start with ASCII letters. TLS and STUN both fall in the
	// binary range, so check for the TLS ClientHello first.
	first, err := br.Peek(1)
	if err != nil {
		conn.Close()
		return
	}

	if first[0] == 0x16 && m.tlsConfig != nil {
		// Terminate TLS, then re-detect the decrypted protocol below.
		conn = tls.Server(&peekedConn{Conn: conn, r: br}, m.tlsConfig)
		br = bufio.NewReaderSize(conn, 512)
	} else if first[0] < 0x20 {
		_ = conn.SetReadDeadline(time.Time{})
		select {
		case m.iceCh <- &peekedConn{Conn: conn, r: br}:
		case <-m.closeCh:
			conn.Close()
		}
		return
	}

	peeked := &peekedConn{Conn: conn}
	line, err := br.ReadString('\n')

	// Detection done (this read also drove the TLS handshake). Clear the
	// deadline so it doesn't carry over to the handed-off connection.
	_ = conn.SetReadDeadline(time.Time{})

	if err != nil {
		peeked.buf = []byte(line)
		peeked.r = br
		select {
		case m.httpCh <- peeked:
		case <-m.closeCh:
			conn.Close()
		}
		return
	}

	peeked.buf = []byte(line)
	peeked.r = br

	if isRTSP(line) {
		select {
		case m.rtspCh <- peeked:
		case <-m.closeCh:
			conn.Close()
		}
	} else {
		select {
		case m.httpCh <- peeked:
		case <-m.closeCh:
			conn.Close()
		}
	}
}

func isRTSP(firstLine string) bool {
	upper := strings.ToUpper(strings.TrimSpace(firstLine))
	if strings.Contains(upper, "RTSP/") {
		return true
	}
	for _, method := range rtspMethods {
		if strings.HasPrefix(upper, method+" RTSP://") {
			return true
		}
	}
	return false
}

// HTTP returns a net.Listener that yields HTTP connections.
func (m *MuxListener) HTTP() net.Listener {
	return &subListener{ch: m.httpCh, addr: m.inner.Addr(), closeCh: m.closeCh}
}

// RTSP returns a net.Listener that yields RTSP connections.
func (m *MuxListener) RTSP() net.Listener {
	return &subListener{ch: m.rtspCh, addr: m.inner.Addr(), closeCh: m.closeCh}
}

// ICE returns a net.Listener that yields ICE/STUN TCP connections.
func (m *MuxListener) ICE() net.Listener {
	return &subListener{ch: m.iceCh, addr: m.inner.Addr(), closeCh: m.closeCh}
}

// Close stops routing and closes the inner listener.
func (m *MuxListener) Close() error {
	m.once.Do(func() { close(m.closeCh) })
	return m.inner.Close()
}

// subListener is a channel-based net.Listener.
type subListener struct {
	ch      chan net.Conn
	addr    net.Addr
	closeCh chan struct{}
}

func (s *subListener) Accept() (net.Conn, error) {
	select {
	case conn := <-s.ch:
		return conn, nil
	case <-s.closeCh:
		return nil, net.ErrClosed
	}
}

func (s *subListener) Close() error   { return nil }
func (s *subListener) Addr() net.Addr { return s.addr }

// peekedConn is a net.Conn that replays peeked bytes before reading from the
// underlying connection.
type peekedConn struct {
	net.Conn
	buf []byte // initial peeked bytes
	r   *bufio.Reader
}

// Unwrap exposes the underlying connection so callers (e.g. the policy layer
// extracting a TLS peer certificate) can traverse the wrapper chain.
func (c *peekedConn) Unwrap() net.Conn { return c.Conn }

func (c *peekedConn) Read(b []byte) (int, error) {
	if len(c.buf) > 0 {
		n := copy(b, c.buf)
		c.buf = c.buf[n:]
		if len(c.buf) == 0 {
			c.buf = nil
		}
		return n, nil
	}
	if c.r != nil {
		return c.r.Read(b)
	}
	return c.Conn.Read(b)
}
