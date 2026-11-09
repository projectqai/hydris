package simcam

import (
	"encoding/binary"
	"math"
)

var (
	zenithColor  = rgb(46, 96, 170)
	horizonColor = rgb(196, 210, 222) // also the haze colour everything fades into
	groundColor  = rgb(116, 124, 100)
	groundAlt    = rgb(108, 117, 94)
)

const (
	hazeDistanceM  = 4000.0
	maxGroundDepth = 25000.0
)

func fogAmount(d float64) float64 { return 1 - math.Exp(-d/hazeDistanceM) }

func skyColor(el float64) uint32 {
	t := math.Sqrt(clamp(el/(70*deg2rad), 0, 1))
	return lerpColor(horizonColor, zenithColor, unit256(t))
}

// tileLookup memoises tile resolution for one band of one frame so the
// shared cache lock is taken once per distinct tile, not per pixel.
type tileLookup struct {
	tiles *tileCache
	cache map[tileKey]tileRef
}

type tileRef struct {
	t     *tile
	shift uint
}

func newTileLookup(tc *tileCache) *tileLookup {
	return &tileLookup{tiles: tc, cache: make(map[tileKey]tileRef)}
}

func (lk *tileLookup) reset() { clear(lk.cache) }

func (lk *tileLookup) get(k tileKey) tileRef {
	if r, ok := lk.cache[k]; ok {
		return r
	}
	var r tileRef
	if lk.tiles != nil {
		r.t, r.shift = lk.tiles.resolve(k)
	}
	lk.cache[k] = r
	return r
}

// drawBackground fills the canvas rows with sky and map-textured ground.
//
// With no roll, every pixel of a row hits the ground at the same depth, so
// the ground position is linear along the row: the inner loop is two
// fixed-point adds and a texel fetch. Map zoom (LOD) and haze are chosen
// once per row from the ground footprint of a pixel.
//
// samples (1..maxGroundSamples) is how many lengthwise samples a strongly
// foreshortened row may take.
func drawBackground(c *canvas, v *view, lk *tileLookup, samples int) {
	base := v.fwd.scale(v.focal)
	latRad := v.lat * deg2rad
	// camera position in zoom-0 Web Mercator pixels
	gx0 := (v.lon + 180) / 360 * tileSize
	gy0 := (1 - math.Log(math.Tan(math.Pi/4+latRad/2))/math.Pi) / 2 * tileSize
	mpp0 := earthCircumference * v.cosLat / tileSize // metres per zoom-0 pixel
	eye := v.alt

	for y := c.y0; y < c.y1; y++ {
		d := base.add(v.up.scale(v.cy - (float64(y) + 0.5)))
		if d.z > -1e-9 {
			c.fillRow(y, 0, c.w, skyColor(math.Atan2(d.z, math.Hypot(d.x, d.y))))
			continue
		}
		t := eye / -d.z
		if t*v.focal > maxGroundDepth {
			c.fillRow(y, 0, c.w, horizonColor)
			continue
		}
		fog := unit256(fogAmount(t * v.focal))

		// Pixel footprint on the ground: t metres across, and the distance
		// to the next row's ground point lengthwise. Near the horizon the
		// lengthwise footprint is many times wider, so the row is
		// supersampled along it, and the map zoom follows the remaining
		// footprint, rounded towards the coarser level: slight blur instead
		// of shimmering roads.
		fv := maxGroundDepth
		if dn := d.sub(v.up); dn.z < 0 {
			tn := eye / -dn.z
			fv = math.Hypot(dn.x*tn-d.x*t, dn.y*tn-d.y*t)
		}
		k := clampInt(int(math.Ceil(fv/t-0.25)), 1, samples)
		zf := math.Log2(mpp0 / math.Max(t, fv/float64(k)))
		z := clampInt(int(math.Floor(zf+0.25)), tileMinZoom, tileMaxZoom)
		scale := float64(int64(1) << z)
		kpm := scale / mpp0 // zoom-z pixels per metre

		var spans [maxGroundSamples]groundSpan
		n := 0
		for j := range k {
			dj := base.add(v.up.scale(v.cy - (float64(y) + (float64(j)+0.5)/float64(k))))
			if dj.z > -1e-9 {
				continue
			}
			tj := eye / -dj.z
			p0 := dj.add(v.right.scale(0.5 - v.cx)).scale(tj) // ground under pixel 0
			const fix = 1 << 16
			spans[n] = groundSpan{
				gx: int64((gx0*scale + p0.x*kpm) * fix), gy: int64((gy0*scale - p0.y*kpm) * fix),
				sx: int64(tj * v.right.x * kpm * fix), sy: int64(-tj * v.right.y * kpm * fix),
			}
			n++
		}
		if n == 0 {
			c.fillRow(y, 0, c.w, horizonColor)
			continue
		}
		// Filter wherever a texel spans more than ~1.5 pixels across the
		// row: close to the camera where zoom is capped, and far rows whose
		// zoom follows the long lengthwise footprint. Elsewhere nearest is
		// indistinguishable and cheaper.
		drawGroundRow(c, y, lk, z, spans[:n], fog, mpp0/scale >= 1.5*t)
	}
}

// maxGroundSamples bounds the lengthwise supersampling of a ground row.
// 2 gives a visibly sharper middle distance for roughly twice the render
// cost; cameras adapt between 1 and this from measured frame times.
const maxGroundSamples = 2

// groundSpan walks one sample line across a row in 16.16 fixed-point zoom-z
// map pixels.
type groundSpan struct{ gx, gy, sx, sy int64 }

// drawGroundRow fills one row from up to maxGroundSamples sample lines,
// averaging them, then applies the row's haze.
func drawGroundRow(c *canvas, y int, lk *tileLookup, z int, spans []groundSpan, fog uint32, filter bool) {
	n := int64(1) << z
	keep := 256 - fog
	row := c.pix[y*c.w*4 : (y+1)*c.w*4]
	var curs [maxGroundSamples]tileCursor
	inv := uint32(65536 / len(spans))
	for x := 0; x < c.w; x++ {
		var col uint32
		if len(spans) == 1 {
			col = curs[0].sample(lk, z, n, spans[0].gx, spans[0].gy, filter)
			spans[0].gx += spans[0].sx
			spans[0].gy += spans[0].sy
		} else {
			var r, g, b uint32
			for j := range spans {
				s := &spans[j]
				px := curs[j].sample(lk, z, n, s.gx, s.gy, filter)
				r += px & 0xff
				g += px >> 8 & 0xff
				b += px >> 16 & 0xff
				s.gx += s.sx
				s.gy += s.sy
			}
			col = (r*inv)>>16 | ((g*inv)>>16)<<8 | ((b*inv)>>16)<<16 | 0xff000000
		}
		binary.LittleEndian.PutUint32(row[x*4:], mix(col, horizonColor, keep, fog))
	}
}

// tileCursor remembers the tile under the previous sample of a span, so the
// lookup only happens when a span crosses into a new tile.
type tileCursor struct {
	tx, ty  int64
	ok      bool
	inWorld bool
	ref     tileRef
}

// sample returns the map colour at a 16.16 zoom-z map position, bilinearly
// filtered when filter is set or the tile is a magnified ancestor.
func (tc *tileCursor) sample(lk *tileLookup, z int, n int64, gx, gy int64, filter bool) uint32 {
	ix, iy := gx>>16, gy>>16
	if tx, ty := ix>>8, iy>>8; !tc.ok || tx != tc.tx || ty != tc.ty {
		tc.tx, tc.ty, tc.ok = tx, ty, true
		tc.inWorld = ty >= 0 && ty < n
		if tc.inWorld {
			tc.ref = lk.get(tileKey{z, int(tx & (n - 1)), int(ty)})
		}
	}
	switch {
	case !tc.inWorld:
		return horizonColor
	case tc.ref.t == nil:
		return proceduralGround(ix, iy, z)
	}
	// Filter at the resolved tile's own level (an ancestor is magnified by
	// 2^shift), with texel centres at +0.5. Neighbours are clamped to the
	// tile, which is invisible at these sizes.
	t, sh := tc.ref.t, tc.ref.shift
	if !filter && sh == 0 {
		return t.at(int(iy&255)<<8 | int(ix&255))
	}
	ux, uy := gx>>sh-1<<15, gy>>sh-1<<15
	x0 := ux>>16 - (ix>>sh)&^255
	y0 := uy>>16 - (iy>>sh)&^255
	fx, fy := uint32(ux>>8&255), uint32(uy>>8&255)
	if x0 < 0 {
		x0, fx = 0, 0
	}
	if y0 < 0 {
		y0, fy = 0, 0
	}
	x1, y1 := min(x0+1, 255), min(y0+1, 255)
	top := lerpColor(t.at(int(y0<<8|x0)), t.at(int(y0<<8|x1)), fx)
	bot := lerpColor(t.at(int(y1<<8|x0)), t.at(int(y1<<8|x1)), fx)
	return lerpColor(top, bot, fy)
}

// proceduralGround is shown while tiles load or when offline: a faint
// checkerboard of zoom-17 tiles (a few hundred metres) that still gives
// motion and distance cues.
func proceduralGround(ix, iy int64, z int) uint32 {
	var cx, cy int64
	if s := z - 9; s >= 0 {
		cx, cy = ix>>s, iy>>s
	} else {
		cx, cy = ix<<-s, iy<<-s
	}
	if (cx^cy)&1 == 0 {
		return groundColor
	}
	return groundAlt
}
