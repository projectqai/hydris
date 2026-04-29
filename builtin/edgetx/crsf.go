package edgetx

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"strings"
)

const (
	crsfMaxFrameSize = 64
	crsfMinFrameLen  = 2 // type + CRC, no payload
	crsfMaxFrameLen  = 62

	crsfSyncFC     = 0xC8
	crsfSyncTX     = 0xEE
	crsfSyncRX     = 0xEC
	crsfSyncRemote = 0xEA
)

const (
	crsfFrameGPS         = 0x02
	crsfFrameVario       = 0x07
	crsfFrameBattery     = 0x08
	crsfFrameBaroAlt     = 0x09
	crsfFrameLinkStats   = 0x14
	crsfFrameRCChannels  = 0x16
	crsfFrameLinkStatsRX = 0x1C
	crsfFrameLinkStatsTX = 0x1D
	crsfFrameAttitude    = 0x1E
	crsfFrameFlightMode  = 0x21
	crsfFrameDeviceInfo  = 0x29
	crsfFrameParamPing   = 0x28
	crsfFrameRadioID     = 0x3A
)

type crsfFrame struct {
	Addr    byte
	Type    byte
	Payload []byte
}

func isValidSync(b byte) bool {
	return b == crsfSyncFC || b == crsfSyncTX || b == crsfSyncRX || b == crsfSyncRemote || b == 0x00
}

func crc8DVBS2(data []byte) byte {
	var crc byte
	for _, b := range data {
		crc ^= b
		for i := 0; i < 8; i++ {
			if crc&0x80 != 0 {
				crc = (crc << 1) ^ 0xD5
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

type crsfReader struct {
	r   io.Reader
	buf [crsfMaxFrameSize]byte
}

func newCRSFReader(r io.Reader) *crsfReader {
	return &crsfReader{r: r}
}

func (c *crsfReader) readFrame() (*crsfFrame, error) {
	for {
		// Read sync byte.
		if _, err := io.ReadFull(c.r, c.buf[:1]); err != nil {
			return nil, err
		}
		if !isValidSync(c.buf[0]) {
			continue
		}
		addr := c.buf[0]

		// Read length byte.
		if _, err := io.ReadFull(c.r, c.buf[:1]); err != nil {
			return nil, err
		}
		frameLen := int(c.buf[0])
		if frameLen < crsfMinFrameLen || frameLen > crsfMaxFrameLen {
			continue
		}

		// Read type + payload + CRC.
		if _, err := io.ReadFull(c.r, c.buf[:frameLen]); err != nil {
			return nil, err
		}

		// CRC covers everything except the last byte (which is the CRC itself).
		data := c.buf[:frameLen-1]
		gotCRC := c.buf[frameLen-1]
		if crc8DVBS2(data) != gotCRC {
			continue
		}

		return &crsfFrame{
			Addr:    addr,
			Type:    data[0],
			Payload: append([]byte(nil), data[1:]...),
		}, nil
	}
}

type crsfGPS struct {
	Latitude    float64 // degrees
	Longitude   float64 // degrees
	GroundSpeed float64 // m/s
	Heading     float64 // degrees
	Altitude    float64 // meters (MSL)
	Satellites  uint8
}

func decodeGPS(p []byte) (*crsfGPS, error) {
	if len(p) < 15 {
		return nil, fmt.Errorf("GPS payload too short: %d", len(p))
	}
	return &crsfGPS{
		Latitude:    float64(int32(binary.BigEndian.Uint32(p[0:4]))) / 1e7,
		Longitude:   float64(int32(binary.BigEndian.Uint32(p[4:8]))) / 1e7,
		GroundSpeed: float64(binary.BigEndian.Uint16(p[8:10])) / 36.0, // km/h*10 → m/s
		Heading:     float64(binary.BigEndian.Uint16(p[10:12])) / 100.0,
		Altitude:    float64(int(binary.BigEndian.Uint16(p[12:14]))) - 1000.0,
		Satellites:  p[14],
	}, nil
}

type crsfBattery struct {
	Voltage      float32 // volts
	Current      float32 // amps
	CapacityUsed uint32  // mAh
	Remaining    uint8   // percent
}

func decodeBattery(p []byte) (*crsfBattery, error) {
	if len(p) < 8 {
		return nil, fmt.Errorf("battery payload too short: %d", len(p))
	}
	return &crsfBattery{
		Voltage:      float32(binary.BigEndian.Uint16(p[0:2])) / 10.0,
		Current:      float32(binary.BigEndian.Uint16(p[2:4])) / 10.0,
		CapacityUsed: uint32(p[4])<<16 | uint32(p[5])<<8 | uint32(p[6]),
		Remaining:    p[7],
	}, nil
}

type crsfLinkStats struct {
	UplinkRSSI1   int32 // dBm (negative)
	UplinkRSSI2   int32 // dBm (negative)
	UplinkLQ      uint8 // percent
	UplinkSNR     int8  // dB
	ActiveAntenna uint8
	RFMode        uint8
	UplinkTXPower uint8 // enum
	DownlinkRSSI  int32 // dBm (negative)
	DownlinkLQ    uint8 // percent
	DownlinkSNR   int8  // dB
}

var txPowerMilliwatts = map[uint8]uint32{
	0: 0, 1: 10, 2: 25, 3: 100, 4: 500, 5: 1000, 6: 2000, 7: 250, 8: 50,
}

func decodeLinkStats(p []byte) (*crsfLinkStats, error) {
	if len(p) < 10 {
		return nil, fmt.Errorf("link stats payload too short: %d", len(p))
	}
	// ELRS sends RSSI as signed int8 (e.g. 0xD6 = -42 dBm).
	// Classic CRSF uses unsigned-then-negate but ELRS values > 127
	// are already negative when read as int8.
	return &crsfLinkStats{
		UplinkRSSI1:   int32(int8(p[0])),
		UplinkRSSI2:   int32(int8(p[1])),
		UplinkLQ:      p[2],
		UplinkSNR:     int8(p[3]),
		ActiveAntenna: p[4],
		RFMode:        p[5],
		UplinkTXPower: p[6],
		DownlinkRSSI:  int32(int8(p[7])),
		DownlinkLQ:    p[8],
		DownlinkSNR:   int8(p[9]),
	}, nil
}

type crsfAttitude struct {
	PitchRad float64
	RollRad  float64
	YawRad   float64
}

func decodeAttitude(p []byte) (*crsfAttitude, error) {
	if len(p) < 6 {
		return nil, fmt.Errorf("attitude payload too short: %d", len(p))
	}
	return &crsfAttitude{
		PitchRad: float64(int16(binary.BigEndian.Uint16(p[0:2]))) / 10000.0,
		RollRad:  float64(int16(binary.BigEndian.Uint16(p[2:4]))) / 10000.0,
		YawRad:   float64(int16(binary.BigEndian.Uint16(p[4:6]))) / 10000.0,
	}, nil
}

type crsfVario struct {
	VerticalSpeed float64 // m/s (positive = climbing)
}

func decodeVario(p []byte) (*crsfVario, error) {
	if len(p) < 2 {
		return nil, fmt.Errorf("vario payload too short: %d", len(p))
	}
	return &crsfVario{
		VerticalSpeed: float64(int16(binary.BigEndian.Uint16(p[0:2]))) / 100.0,
	}, nil
}

func decodeFlightMode(p []byte) string {
	s := string(p)
	if idx := strings.IndexByte(s, 0); idx >= 0 {
		s = s[:idx]
	}
	return strings.TrimSpace(s)
}

func decodeRCChannels(p []byte) ([16]uint16, error) {
	if len(p) < 22 {
		return [16]uint16{}, fmt.Errorf("RC channels payload too short: %d", len(p))
	}
	var ch [16]uint16
	bitOffset := 0
	for i := 0; i < 16; i++ {
		byteIdx := bitOffset / 8
		bitIdx := uint(bitOffset % 8)
		raw := uint32(p[byteIdx]) | uint32(p[byteIdx+1])<<8
		if bitIdx+11 > 16 && byteIdx+2 < len(p) {
			raw |= uint32(p[byteIdx+2]) << 16
		}
		ch[i] = uint16((raw >> bitIdx) & 0x7FF)
		bitOffset += 11
	}
	return ch, nil
}

// buildCRSFFrame builds a raw CRSF frame ready to write to the serial port.
func buildCRSFFrame(addr, frameType byte, payload []byte) []byte {
	frameLen := 1 + len(payload) + 1 // type + payload + CRC
	buf := make([]byte, 2+frameLen)
	buf[0] = addr
	buf[1] = byte(frameLen)
	buf[2] = frameType
	copy(buf[3:], payload)
	buf[len(buf)-1] = crc8DVBS2(buf[2 : len(buf)-1])
	return buf
}

// buildDevicePing builds a CRSF device ping frame (extended frame 0x28).
// Broadcast ping: dest=0x00, origin=sender address.
func buildDevicePing(senderAddr byte) []byte {
	// Extended frame: type + dest + origin, no further payload.
	return buildCRSFFrame(crsfSyncRemote, crsfFrameParamPing, []byte{0x00, senderAddr})
}

type crsfDeviceInfo struct {
	Name         string
	SerialNumber uint32
	HardwareID   uint32
	FirmwareID   uint32
	ParamCount   uint8
	ParamVersion uint8
}

func decodeDeviceInfo(p []byte) *crsfDeviceInfo {
	// Extended frame payload starts with dest + origin, then device info.
	if len(p) < 2 {
		return nil
	}
	p = p[2:] // skip dest, origin

	// Name is null-terminated.
	nameEnd := 0
	for nameEnd < len(p) && p[nameEnd] != 0 {
		nameEnd++
	}
	if nameEnd >= len(p) {
		return nil
	}
	name := string(p[:nameEnd])
	rest := p[nameEnd+1:]

	if len(rest) < 10 {
		return &crsfDeviceInfo{Name: name}
	}

	return &crsfDeviceInfo{
		Name:         name,
		SerialNumber: binary.BigEndian.Uint32(rest[0:4]),
		HardwareID:   binary.BigEndian.Uint32(rest[4:8]),
		FirmwareID:   binary.BigEndian.Uint32(rest[8:12]) >> 8, // top 3 bytes
		ParamCount:   rest[10],
		ParamVersion: rest[11],
	}
}

// eulerToQuaternion converts roll, pitch, yaw (radians) to a quaternion.
// Uses ZYX (yaw-pitch-roll) convention.
func eulerToQuaternion(roll, pitch, yaw float64) (x, y, z, w float64) {
	cr := math.Cos(roll / 2)
	sr := math.Sin(roll / 2)
	cp := math.Cos(pitch / 2)
	sp := math.Sin(pitch / 2)
	cy := math.Cos(yaw / 2)
	sy := math.Sin(yaw / 2)

	w = cr*cp*cy + sr*sp*sy
	x = sr*cp*cy - cr*sp*sy
	y = cr*sp*cy + sr*cp*sy
	z = cr*cp*sy - sr*sp*cy
	return
}
