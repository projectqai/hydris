package simcam

import (
	"math"
	"sort"
)

const (
	// minObjectPx keeps objects too far to resolve visible as a dot. Above
	// it, on-screen size is the true projected size: no clamping, so size
	// falls off exactly with distance.
	minObjectPx = 2.0
)

var (
	colorHostile = rgb(230, 64, 60)
	colorFriend  = rgb(70, 140, 235)
	colorNeutral = rgb(70, 200, 90)
	colorUnknown = rgb(235, 210, 60)
	colorOutline = rgb(20, 20, 24)
	colorWhite   = rgb(240, 240, 240)
	colorBlack   = rgb(0, 0, 0)
)

type symbolShape int

const (
	shapeCircle symbolShape = iota
	shapeDiamond
	shapeRect
	shapeSquare
)

// affiliation maps the MIL-STD-2525 identity to colour and frame shape.
func affiliation(sidc string) (uint32, symbolShape) {
	if len(sidc) < 2 {
		return colorUnknown, shapeCircle
	}
	switch sidc[1] {
	case 'H', 'S', 'J', 'K':
		return colorHostile, shapeDiamond
	case 'F', 'A', 'D', 'M':
		return colorFriend, shapeRect
	case 'N', 'L':
		return colorNeutral, shapeSquare
	}
	return colorUnknown, shapeCircle
}

type marker struct {
	e      *cachedEntity
	pl     placement
	bottom float64
}

// drawEntities draws all entities far to near. Bodies are depth-tested
// against walls unless occlusion is disabled.
func drawEntities(c *canvas, v *view, in *frameInput, sprites *assetCache) {
	ms := make([]marker, 0, len(in.entities))
	for i := range in.entities {
		e := &in.entities[i]
		if pl, ok := v.place(e); ok {
			ms = append(ms, marker{e: e, pl: pl})
		}
	}
	sort.Slice(ms, func(i, j int) bool { return ms[i].pl.depth > ms[j].pl.depth })

	for i := range ms {
		m := &ms[i]
		drawShadow(c, v, &m.pl, in.occlude)
		iz := 1 / m.pl.depth
		if !in.occlude {
			iz = 0
		}
		var tex *texture
		if len(m.e.images) > 0 {
			tex = sprites.get(m.e.images[0])
		}
		halfH := 0.0
		if tex != nil {
			// Fit the image, undistorted, inside the true footprint.
			pw, ph := m.pl.pw, m.pl.ph
			if aspect := float64(tex.w) / float64(tex.h); pw/ph > aspect {
				pw = ph * aspect
			} else {
				ph = pw / aspect
			}
			if s := minObjectPx / math.Max(pw, ph); s > 1 {
				pw, ph = pw*s, ph*s
			}
			halfH = ph / 2
			drawSprite(c, tex, m.pl.x-pw/2, m.pl.y-halfH, pw, ph, iz)
		} else {
			col, shape := affiliation(m.e.sidc)
			size := math.Max(math.Max(m.pl.pw, m.pl.ph), minObjectPx)
			halfH = size / 2
			drawSymbol(c, m.pl.x, m.pl.y, size, shape, col, iz)
		}
		m.bottom = m.pl.y + halfH
		if m.pl.airborne && m.pl.gdepth > 0 {
			c.line(m.pl.x, m.bottom, m.pl.gx, m.pl.gy, colorWhite, 110, iz)
		}
	}
}

// drawShadow puts a soft dark ellipse on the ground under the entity.
func drawShadow(c *canvas, v *view, pl *placement, occlude bool) {
	if pl.gdepth <= 0 {
		return
	}
	wm := pl.pw * pl.depth / v.focal // back to metres
	rx := clamp(0.6*wm*v.focal/pl.gdepth, 1, 400)
	horiz := math.Hypot(pl.pos.x, pl.pos.y)
	ry := math.Max(1, rx*v.alt/math.Hypot(horiz, v.alt))
	iz := 0.0
	if occlude {
		iz = 1 / pl.gdepth
	}
	x0, x1 := int(pl.gx-rx-1), int(pl.gx+rx+1)
	y0, y1 := max(int(pl.gy-ry-1), c.y0), min(int(pl.gy+ry+1), c.y1-1)
	for y := y0; y <= y1; y++ {
		dy := (float64(y) + 0.5 - pl.gy) / ry
		for x := max(x0, 0); x <= min(x1, c.w-1); x++ {
			dx := (float64(x) + 0.5 - pl.gx) / rx
			d := dx*dx + dy*dy
			if d >= 1 || (iz > 0 && !c.depthOK(x, y, iz)) {
				continue
			}
			c.blendPx(x, y, colorBlack, uint32(110*(1-d)))
		}
	}
}

// drawSprite draws a premultiplied texture scaled into the given box,
// sampling the mip level closest to the on-screen size.
func drawSprite(c *canvas, t *texture, x, y, w, h, iz float64) {
	src := t.mipLevel(float64(t.h) / h)
	x0, y0 := int(math.Floor(x)), int(math.Floor(y))
	x1, y1 := int(math.Ceil(x+w)), int(math.Ceil(y+h))
	sxk, syk := float64(src.w)/w, float64(src.h)/h
	for py := max(y0, c.y0); py < min(y1, c.y1); py++ {
		sy := int((float64(py) + 0.5 - y) * syk)
		if sy < 0 || sy >= src.h {
			continue
		}
		srow := src.pix[sy*src.w : (sy+1)*src.w]
		for px := max(x0, 0); px < min(x1, c.w); px++ {
			sx := int((float64(px) + 0.5 - x) * sxk)
			if sx < 0 || sx >= src.w {
				continue
			}
			s := srow[sx]
			if s>>24 == 0 || (iz > 0 && !c.depthOK(px, py, iz)) {
				continue
			}
			i := py*c.w + px
			c.set(i, over(c.get(i), s))
		}
	}
}

// drawSymbol draws an anti-aliased affiliation frame with a dark outline.
func drawSymbol(c *canvas, cx, cy, size float64, shape symbolShape, fill uint32, iz float64) {
	r := size / 2
	x0, x1 := int(cx-r-2), int(cx+r+2)
	y0, y1 := max(int(cy-r-2), c.y0), min(int(cy+r+2), c.y1-1)
	for py := y0; py <= y1; py++ {
		dy := math.Abs(float64(py) + 0.5 - cy)
		for px := max(x0, 0); px <= min(x1, c.w-1); px++ {
			dx := math.Abs(float64(px) + 0.5 - cx)
			var d float64 // signed distance to the frame edge, in px
			switch shape {
			case shapeDiamond:
				d = (dx + dy - r) * math.Sqrt2 / 2
			case shapeRect:
				d = math.Max(dx-r, dy-r*0.68)
			case shapeSquare:
				d = math.Max(dx, dy) - r*0.8
			default:
				d = math.Hypot(dx, dy) - r*0.9
			}
			if d >= 0.5 || (iz > 0 && !c.depthOK(px, py, iz)) {
				continue
			}
			col := fill
			if d > -1.5 {
				col = colorOutline
			}
			c.blendPx(px, py, col, unit256(0.5-d))
		}
	}
}
