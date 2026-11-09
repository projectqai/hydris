package attitude

import (
	"math"
	"testing"
)

const deg = math.Pi / 180

func TestDocumentedExample(t *testing.T) {
	// docs: "A heading of 030 is z = sin(-15°), not sin(15°)"
	q := FromHeading(30 * deg)
	if math.Abs(q.Z-math.Sin(-15*deg)) > 1e-12 || math.Abs(q.W-math.Cos(15*deg)) > 1e-12 || q.X != 0 || q.Y != 0 {
		t.Fatalf("heading 030: got %+v", q)
	}
}

func TestHeadingRoundTrip(t *testing.T) {
	for _, c := range []struct{ h, p, r float64 }{
		{0, 0, 0}, {45, 0, 0}, {45, 20, 0}, {45, 0, 30}, {45, 20, 30}, {90, 45, 45}, {350, 15, -25}, {200, -10, 60},
	} {
		got := Heading(FromHeadingPitchRoll(c.h*deg, c.p*deg, c.r*deg)) / deg
		if d := math.Mod(got-c.h+540, 360) - 180; math.Abs(d) > 1e-9 {
			t.Errorf("heading %v pitch %v roll %v: got %.6f", c.h, c.p, c.r, got)
		}
	}
}

// Forward points along the heading, the right wing drops for positive roll
// and the nose rises for positive pitch.
func TestAxes(t *testing.T) {
	rot := func(q [4]float64, v [3]float64) [3]float64 {
		x, y, z, w := q[0], q[1], q[2], q[3]
		// v' = q v q*
		ix := w*v[0] + y*v[2] - z*v[1]
		iy := w*v[1] + z*v[0] - x*v[2]
		iz := w*v[2] + x*v[1] - y*v[0]
		iw := -x*v[0] - y*v[1] - z*v[2]
		return [3]float64{ix*w + iw*-x + iy*-z - iz*-y, iy*w + iw*-y + iz*-x - ix*-z, iz*w + iw*-z + ix*-y - iy*-x}
	}
	arr := func(h, p, r float64) [4]float64 {
		q := FromHeadingPitchRoll(h*deg, p*deg, r*deg)
		return [4]float64{q.X, q.Y, q.Z, q.W}
	}
	if f := rot(arr(90, 0, 0), [3]float64{0, 1, 0}); math.Abs(f[0]-1) > 1e-9 {
		t.Errorf("heading 090 should face east, forward=%v", f)
	}
	if f := rot(arr(0, 10, 0), [3]float64{0, 1, 0}); f[2] <= 0 {
		t.Errorf("positive pitch should raise the nose, forward=%v", f)
	}
	if r := rot(arr(0, 0, 10), [3]float64{1, 0, 0}); r[2] >= 0 {
		t.Errorf("positive roll should drop the right wing, right=%v", r)
	}
}
