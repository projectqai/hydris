// Package muxlistener provides a protocol-multiplexing net.Listener that
// peeks at the first bytes of each accepted connection to determine whether
// it speaks RTSP or HTTP, then routes it to the appropriate sub-listener.
package muxlistener

import (
	"bufio"
	"net"
	"strings"
	"sync"
)

// rtspMethods are the RTSP request methods. If the first line of a connection
// matches "<METHOD> rtsp://" or ends with "RTSP/1.0", we treat it as RTSP.
var rtspMethods = []string{"OPTIONS", "DESCRIBE", "ANNOUNCE", "SETUP", "PLAY", "PAUSE", "TEARDOWN", "GET_PARAMETER", "SET_PARAMETER", "REDIRECT", "RECORD"}

// MuxListener wraps a net.Listener and routes accepted connections to
// either an RTSP or HTTP sub-listener based on protocol detection.
type MuxListener struct {
	inner net.Listener

	httpCh chan net.Conn
	rtspCh chan net.Conn

	once    sync.Once
	closeCh chan struct{}
}

// New creates a MuxListener that routes connections from inner.
// Call RTSP() and HTTP() to obtain the sub-listeners, then call Serve()
// to start accepting and routing.
func New(inner net.Listener) *MuxListener {
	return &MuxListener{
		inner:   inner,
		httpCh:  make(chan net.Conn, 16),
		rtspCh:  make(chan net.Conn, 16),
		closeCh: make(chan struct{}),
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
	peeked := &peekedConn{Conn: conn}
	br := bufio.NewReaderSize(conn, 512)

	line, err := br.ReadString('\n')
	if err != nil {
		// Can't determine protocol; default to HTTP.
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
