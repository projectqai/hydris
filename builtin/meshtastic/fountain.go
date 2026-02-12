package meshtastic

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"sync"
	"time"
)

// Fountain code decoder for ATAK_FORWARDER (port 257) packets.
// Implements the same LT fountain code used by the ATAK meshtastic plugin.

const (
	ftnMagic0        = 'F'
	ftnMagic1        = 'T'
	ftnMagic2        = 'N'
	ftnHeaderSize    = 11 // magic(3) + xferId(3) + seed(2) + K(1) + len(2)
	ftnBlockSize     = 220
	ftnSolitonC      = 0.1
	ftnSolitonDelta  = 0.5
	transferTypeCot  = 0x00
	transferTypeFile = 0x01
	// ASCII variants used by some versions
	transferTypeCotASCII  = 0x30
	transferTypeFileASCII = 0x31
)

type ftnDataBlock struct {
	transferID       int
	seed             int
	sourceBlockCount int // K
	totalLength      int
	payload          []byte
}

func parseFTNDataBlock(data []byte) (*ftnDataBlock, error) {
	if len(data) < ftnHeaderSize {
		return nil, fmt.Errorf("too short: %d", len(data))
	}
	if data[0] != ftnMagic0 || data[1] != ftnMagic1 || data[2] != ftnMagic2 {
		return nil, fmt.Errorf("bad magic")
	}

	xferID := int(data[3])<<16 | int(data[4])<<8 | int(data[5])
	seed := int(binary.BigEndian.Uint16(data[6:8]))
	k := int(data[8])
	totalLen := int(binary.BigEndian.Uint16(data[9:11]))
	payload := make([]byte, len(data)-ftnHeaderSize)
	copy(payload, data[ftnHeaderSize:])

	return &ftnDataBlock{
		transferID:       xferID,
		seed:             seed,
		sourceBlockCount: k,
		totalLength:      totalLen,
		payload:          payload,
	}, nil
}

func isFTNPacket(data []byte) bool {
	return len(data) >= 3 && data[0] == ftnMagic0 && data[1] == ftnMagic1 && data[2] == ftnMagic2
}

// ftnReassembler collects fountain-coded blocks and decodes them.
type ftnReassembler struct {
	mu       sync.Mutex
	sessions map[int]*ftnSession
}

type ftnSession struct {
	k          int
	totalLen   int
	blocks     map[int]*ftnDataBlock // seed → block (deduplicated)
	firstSeen  time.Time
	transferID int
}

func newFTNReassembler() *ftnReassembler {
	return &ftnReassembler{
		sessions: make(map[int]*ftnSession),
	}
}

// addBlock adds a received block. Returns (data, complete) where data is the
// reassembled and decompressed CoT XML if complete.
func (r *ftnReassembler) addBlock(block *ftnDataBlock) ([]byte, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Expire old sessions
	now := time.Now()
	for id, s := range r.sessions {
		if now.Sub(s.firstSeen) > 60*time.Second {
			delete(r.sessions, id)
		}
	}

	sess, ok := r.sessions[block.transferID]
	if !ok {
		sess = &ftnSession{
			k:          block.sourceBlockCount,
			totalLen:   block.totalLength,
			blocks:     make(map[int]*ftnDataBlock),
			firstSeen:  now,
			transferID: block.transferID,
		}
		r.sessions[block.transferID] = sess
	}

	// Deduplicate by seed
	sess.blocks[block.seed] = block

	// Try to decode if we have >= K blocks
	if len(sess.blocks) < sess.k {
		return nil, false
	}

	data := ftnDecode(sess)
	if data == nil {
		return nil, false
	}

	delete(r.sessions, block.transferID)

	// First byte is transfer type
	if len(data) < 1 {
		return nil, false
	}
	transferType := data[0]
	payload := data[1:]

	// Normalize ASCII type variants
	if transferType == transferTypeCotASCII {
		transferType = transferTypeCot
	}

	if transferType != transferTypeCot {
		return nil, false // only handle CoT for now
	}

	// Decompress zlib
	xml, err := zlibDecompress(payload)
	if err != nil {
		// Try raw — maybe it's not compressed
		if len(payload) > 0 && payload[0] == '<' {
			return payload, true
		}
		return nil, false
	}

	return xml, true
}

func ftnDecode(sess *ftnSession) []byte {
	k := sess.k
	transferID := sess.transferID

	type encodedBlock struct {
		payload []byte
		indices map[int]bool
	}

	// Build encoded blocks with regenerated source indices
	var blocks []*encodedBlock
	for _, b := range sess.blocks {
		indices := ftnRegenerateIndices(b.seed, k, transferID)
		idxMap := make(map[int]bool)
		for _, idx := range indices {
			idxMap[idx] = true
		}
		payload := make([]byte, len(b.payload))
		copy(payload, b.payload)
		blocks = append(blocks, &encodedBlock{payload: payload, indices: idxMap})
	}

	// Peeling decoder
	decoded := make([][]byte, k)
	isDecoded := make([]bool, k)
	decodedCount := 0

	progress := true
	for progress && decodedCount < k {
		progress = false

		for i, eb := range blocks {
			if eb == nil {
				continue
			}

			// Remove already-decoded indices (XOR them out)
			remaining := make(map[int]bool)
			for idx := range eb.indices {
				if isDecoded[idx] {
					xorInPlace(eb.payload, decoded[idx])
				} else {
					remaining[idx] = true
				}
			}
			eb.indices = remaining

			if len(remaining) == 1 {
				// Exactly one unknown — decoded!
				for idx := range remaining {
					decoded[idx] = make([]byte, len(eb.payload))
					copy(decoded[idx], eb.payload)
					isDecoded[idx] = true
					decodedCount++
				}
				blocks[i] = nil
				progress = true
			} else if len(remaining) == 0 {
				blocks[i] = nil // redundant
			}
		}
	}

	if decodedCount < k {
		return nil
	}

	// Reassemble
	result := make([]byte, 0, sess.totalLen)
	for _, block := range decoded {
		remaining := sess.totalLen - len(result)
		if remaining <= 0 {
			break
		}
		take := len(block)
		if take > remaining {
			take = remaining
		}
		result = append(result, block[:take]...)
	}

	return result
}

// ftnRegenerateIndices regenerates source block indices from seed,
// matching the Java implementation exactly.
func ftnRegenerateIndices(seed, k, transferID int) []int {
	rng := newJavaRandom(int64(seed))

	// Check if this is block 0 (forced degree 1)
	block0Seed := (transferID * 31337) & 0xFFFF
	isFirstBlock := seed == block0Seed

	// sampleDegree consumes one nextDouble from the RNG
	cdf := buildRobustSolitonCDF(k)
	u := rng.nextDouble()
	degree := k
	for d := 1; d <= k; d++ {
		if u <= cdf[d] {
			degree = d
			break
		}
	}

	if isFirstBlock {
		// First block has forced degree 1 — but we already consumed the
		// RNG state for sampleDegree (to keep in sync), so use degree=1
		degree = 1
	}

	if degree > k {
		degree = k
	}

	// selectIndices: pick 'degree' unique random indices from [0, k)
	selected := make(map[int]bool)
	for len(selected) < degree {
		selected[rng.nextInt(k)] = true
	}

	indices := make([]int, 0, len(selected))
	for idx := range selected {
		indices = append(indices, idx)
	}
	return indices
}

func buildRobustSolitonCDF(k int) []float64 {
	kf := float64(k)
	cdf := make([]float64, k+1)

	// Ideal soliton
	rho := make([]float64, k+1)
	rho[1] = 1.0 / kf
	for d := 2; d <= k; d++ {
		rho[d] = 1.0 / float64(d*(d-1))
	}

	// Robust soliton parameters
	s := ftnSolitonC * math.Log(kf/ftnSolitonDelta) * math.Sqrt(kf)
	threshold := int(math.Floor(kf / s))

	tau := make([]float64, k+1)
	for d := 1; d <= k; d++ {
		if d < threshold {
			tau[d] = s / (kf * float64(d))
		} else if d == threshold {
			tau[d] = s * math.Log(s/ftnSolitonDelta) / kf
		}
	}

	// Combine and normalize
	z := 0.0
	mu := make([]float64, k+1)
	for d := 1; d <= k; d++ {
		mu[d] = rho[d] + tau[d]
		z += mu[d]
	}

	cum := 0.0
	for d := 1; d <= k; d++ {
		cum += mu[d] / z
		cdf[d] = cum
	}

	return cdf
}

func xorInPlace(target, source []byte) {
	n := len(target)
	if len(source) < n {
		n = len(source)
	}
	for i := 0; i < n; i++ {
		target[i] ^= source[i]
	}
}

// ftnEncode encodes data into fountain-coded FTN packets ready to send.
// Returns the raw packet bytes (including FTN header) for each block.
func ftnEncode(data []byte, transferID int) [][]byte {
	k := int(math.Ceil(float64(len(data)) / float64(ftnBlockSize)))
	if k == 0 {
		k = 1
	}

	// Split into source blocks (zero-padded)
	sourceBlocks := make([][]byte, k)
	for i := 0; i < k; i++ {
		sourceBlocks[i] = make([]byte, ftnBlockSize)
		start := i * ftnBlockSize
		end := start + ftnBlockSize
		if end > len(data) {
			end = len(data)
		}
		if start < len(data) {
			copy(sourceBlocks[i], data[start:end])
		}
	}

	// Adaptive overhead: more for small K
	var overhead float64
	switch {
	case k <= 10:
		overhead = 0.50
	case k <= 50:
		overhead = 0.25
	default:
		overhead = 0.15
	}
	numBlocks := int(math.Ceil(float64(k) * (1 + overhead)))

	var packets [][]byte
	for i := 0; i < numBlocks; i++ {
		seed := ftnGenerateSeed(transferID, i)

		rng := newJavaRandom(int64(seed))

		// Sample degree from robust soliton
		cdf := buildRobustSolitonCDF(k)
		u := rng.nextDouble()
		degree := k
		for d := 1; d <= k; d++ {
			if u <= cdf[d] {
				degree = d
				break
			}
		}

		// Block 0 has forced degree 1
		if i == 0 {
			degree = 1
		}
		if degree > k {
			degree = k
		}

		// Select indices
		selected := make(map[int]bool)
		for len(selected) < degree {
			selected[rng.nextInt(k)] = true
		}

		// XOR selected source blocks
		payload := make([]byte, ftnBlockSize)
		for idx := range selected {
			xorInPlace(payload, sourceBlocks[idx])
		}

		// Build FTN packet: header + payload
		pkt := make([]byte, ftnHeaderSize+ftnBlockSize)
		pkt[0] = ftnMagic0
		pkt[1] = ftnMagic1
		pkt[2] = ftnMagic2
		pkt[3] = byte((transferID >> 16) & 0xFF)
		pkt[4] = byte((transferID >> 8) & 0xFF)
		pkt[5] = byte(transferID & 0xFF)
		binary.BigEndian.PutUint16(pkt[6:8], uint16(seed))
		pkt[8] = byte(k)
		binary.BigEndian.PutUint16(pkt[9:11], uint16(len(data)))
		copy(pkt[ftnHeaderSize:], payload)

		packets = append(packets, pkt)
	}

	return packets
}

func ftnGenerateSeed(transferID, blockIndex int) int {
	return (transferID*31337 + blockIndex*7919) & 0xFFFF
}

func zlibCompress(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	w := zlib.NewWriter(&buf)
	if _, err := w.Write(data); err != nil {
		_ = w.Close()
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

const maxDecompressedSize = 1 << 20 // 1 MiB

func zlibDecompress(data []byte) ([]byte, error) {
	r, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer func() { _ = r.Close() }()
	return io.ReadAll(io.LimitReader(r, maxDecompressedSize))
}

// javaRandom replicates java.util.Random exactly.
// Java's LCG: seed = (seed * 0x5DEECE66D + 0xB) & ((1<<48) - 1)
type javaRandom struct {
	seed int64
}

const (
	javaMultiplier = 0x5DEECE66D
	javaAddend     = 0xB
	javaMask       = (1 << 48) - 1
)

func newJavaRandom(seed int64) *javaRandom {
	// Java's Random constructor: this.seed = (seed ^ multiplier) & mask
	return &javaRandom{seed: (seed ^ javaMultiplier) & javaMask}
}

func (r *javaRandom) next(bits int) int32 {
	r.seed = (r.seed*javaMultiplier + javaAddend) & javaMask
	return int32(r.seed >> (48 - bits))
}

func (r *javaRandom) nextDouble() float64 {
	// Java: (((long)(next(26)) << 27) + next(27)) / (double)(1L << 53)
	hi := int64(r.next(26))
	lo := int64(r.next(27))
	return float64((hi<<27)+lo) / float64(int64(1)<<53)
}

func (r *javaRandom) nextInt(bound int) int {
	if bound <= 0 {
		return 0
	}
	// Java's nextInt(bound) algorithm
	if bound&(bound-1) == 0 { // power of two
		return int((int64(bound) * int64(r.next(31))) >> 31)
	}
	for {
		bits := r.next(31)
		val := bits % int32(bound)
		if bits-val+(int32(bound)-1) >= 0 {
			return int(val)
		}
	}
}
