package meshtastic

import (
	"encoding/binary"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin/meshtastic/meshpb"
	"google.golang.org/protobuf/proto"
)

const (
	start1             = 0x94
	start2             = 0xC3
	headerLen          = 4
	maxToFromRadioSize = 512
)

// Radio manages a connection to a meshtastic device.
type Radio struct {
	conn    io.ReadWriteCloser
	nodeNum uint32
	mu      sync.Mutex
}

// radioConn bridges gomobile callbacks to io.ReadWriteCloser.
type radioConn struct {
	writer  SerialWriter
	readBuf chan []byte
	pending []byte
	closed  chan struct{}
	once    sync.Once
}

// NewRadio creates a Radio from a direct io.ReadWriteCloser (e.g. an os.File for a serial port).
func NewRadio(conn io.ReadWriteCloser) *Radio {
	return &Radio{conn: conn}
}

// NewRadioFromCallbacks creates a Radio backed by gomobile serial callbacks.
func NewRadioFromCallbacks(writer SerialWriter, readBuf chan []byte) *Radio {
	conn := &radioConn{
		writer:  writer,
		readBuf: readBuf,
		closed:  make(chan struct{}),
	}
	return &Radio{conn: conn}
}

func (c *radioConn) Write(p []byte) (int, error) {
	return c.writer.Write(p)
}

func (c *radioConn) Read(p []byte) (int, error) {
	// Drain pending bytes first
	if len(c.pending) > 0 {
		n := copy(p, c.pending)
		c.pending = c.pending[n:]
		return n, nil
	}

	// Wait for next chunk from USB read thread
	select {
	case data, ok := <-c.readBuf:
		if !ok {
			return 0, io.EOF
		}
		n := copy(p, data)
		if n < len(data) {
			c.pending = data[n:]
		}
		return n, nil
	case <-c.closed:
		return 0, io.EOF
	}
}

func (c *radioConn) Close() error {
	c.once.Do(func() {
		close(c.closed)
	})
	return nil
}

// RadioHandshake holds the configuration received during the init handshake.
type RadioHandshake struct {
	NodeNum       uint32
	LongName      string
	ShortName     string
	Channels      []*meshpb.Chan
	Configs       []*meshpb.RadioConfig
	ModuleConfigs []*meshpb.ModConfig
}

// init performs the config handshake, collecting all config until ConfigCompleteId.
func (r *Radio) init() (*RadioHandshake, error) {
	req := &meshpb.ToRadio{
		Msg: &meshpb.ToRadio_WantConfigId{WantConfigId: 42},
	}
	if err := r.Send(req); err != nil {
		return nil, err
	}

	cfg := &RadioHandshake{}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		msg, err := r.Recv()
		if err != nil {
			return nil, err
		}
		switch v := msg.GetMsg().(type) {
		case *meshpb.FromRadio_Self:
			cfg.NodeNum = v.Self.GetNodeNum()
			r.nodeNum = cfg.NodeNum
		case *meshpb.FromRadio_Node:
			if v.Node != nil && v.Node.GetNum() == cfg.NodeNum && v.Node.Peer != nil {
				cfg.LongName = v.Node.Peer.GetLongName()
				cfg.ShortName = v.Node.Peer.GetShortName()
			}
		case *meshpb.FromRadio_Config:
			cfg.Configs = append(cfg.Configs, v.Config)
		case *meshpb.FromRadio_ModConfig:
			cfg.ModuleConfigs = append(cfg.ModuleConfigs, v.ModConfig)
		case *meshpb.FromRadio_Channel:
			cfg.Channels = append(cfg.Channels, v.Channel)
		case *meshpb.FromRadio_ConfigCompleteId:
			if cfg.NodeNum == 0 {
				return nil, fmt.Errorf("config complete but no MyInfo received")
			}
			return cfg, nil
		}
	}
	return nil, fmt.Errorf("timeout waiting for config complete")
}

// NodeNum returns the local node number obtained during init.
func (r *Radio) NodeNum() uint32 {
	return r.nodeNum
}

// Send marshals and frames a ToRadio message and writes it to the connection.
func (r *Radio) Send(msg *meshpb.ToRadio) error {
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if len(data) > maxToFromRadioSize {
		return fmt.Errorf("packet too large: %d > %d", len(data), maxToFromRadioSize)
	}

	frame := make([]byte, headerLen+len(data))
	frame[0] = start1
	frame[1] = start2
	binary.BigEndian.PutUint16(frame[2:4], uint16(len(data)))
	copy(frame[headerLen:], data)

	r.mu.Lock()
	defer r.mu.Unlock()
	_, err = r.conn.Write(frame)
	return err
}

// Recv reads one FromRadio packet from the connection. Blocks until a complete
// packet is received.
func (r *Radio) Recv() (*meshpb.FromRadio, error) {
	buf := make([]byte, 1)
	for {
		// Scan for sync marker [0x94, 0xC3]
		if _, err := io.ReadFull(r.conn, buf); err != nil {
			return nil, err
		}
		if buf[0] != start1 {
			continue
		}
		if _, err := io.ReadFull(r.conn, buf); err != nil {
			return nil, err
		}
		if buf[0] != start2 {
			continue
		}

		// Read 2-byte length
		lenBuf := make([]byte, 2)
		if _, err := io.ReadFull(r.conn, lenBuf); err != nil {
			return nil, err
		}
		pktLen := int(binary.BigEndian.Uint16(lenBuf))
		if pktLen == 0 || pktLen > maxToFromRadioSize {
			continue
		}

		// Read protobuf payload
		payload := make([]byte, pktLen)
		if _, err := io.ReadFull(r.conn, payload); err != nil {
			return nil, err
		}

		msg := &meshpb.FromRadio{}
		if err := proto.Unmarshal(payload, msg); err != nil {
			continue // skip malformed packets
		}
		return msg, nil
	}
}

// Close closes the underlying connection.
func (r *Radio) Close() error {
	return r.conn.Close()
}
