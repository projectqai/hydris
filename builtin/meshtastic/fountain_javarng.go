package meshtastic

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
