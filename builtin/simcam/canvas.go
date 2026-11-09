package simcam

import (
	"encoding/binary"
	"math"
)

// Pixels are packed little-endian as R | G<<8 | B<<16 | A<<24, which is the
// byte order of image.RGBA, so a packed value is stored with one PutUint32.
// Texture pixels use the same packing with premultiplied alpha.

func rgb(r, g, b uint8) uint32 {
	return uint32(r) | uint32(g)<<8 | uint32(b)<<16 | 0xff000000
}

// mix returns c*wc + f*wf with weights in 1/256ths. wc+wf must not exceed
// 256. Red and blue are processed together in one multiply.
func mix(c, f, wc, wf uint32) uint32 {
	rb := ((c&0xff00ff)*wc + (f&0xff00ff)*wf) >> 8 & 0xff00ff
	g := ((c&0xff00)*wc + (f&0xff00)*wf) >> 8 & 0xff00
	return rb | g | 0xff000000
}

// lerpColor blends towards f by a (0..256).
func lerpColor(c, f, a uint32) uint32 { return mix(c, f, 256-a, a) }

// over composites a premultiplied source onto an opaque destination.
func over(dst, src uint32) uint32 {
	a := src >> 24
	switch a {
	case 255:
		return src
	case 0:
		return dst
	}
	ia := 256 - a - a>>7
	rb := (dst&0xff00ff*ia)>>8&0xff00ff + src&0xff00ff
	g := (dst&0xff00*ia)>>8&0xff00 + src&0xff00
	return rb | g | 0xff000000
}

func unit256(f float64) uint32 {
	if f <= 0 {
		return 0
	}
	if f >= 1 {
		return 256
	}
	return uint32(f * 256)
}

// canvas is a view onto the shared frame and depth buffer that only touches
// rows [y0, y1), so bands can be rendered concurrently.
type canvas struct {
	pix    []byte
	zbuf   []float32 // 1/depth; 0 = nothing drawn
	w, h   int
	y0, y1 int
}

func (c *canvas) get(i int) uint32 { return binary.LittleEndian.Uint32(c.pix[i*4:]) }

func (c *canvas) set(i int, col uint32) { binary.LittleEndian.PutUint32(c.pix[i*4:], col) }

// blendPx blends col into pixel (x, y) with alpha a (0..256), clipped.
func (c *canvas) blendPx(x, y int, col, a uint32) {
	if x < 0 || x >= c.w || y < c.y0 || y >= c.y1 || a == 0 {
		return
	}
	i := y*c.w + x
	if a >= 256 {
		c.set(i, col)
		return
	}
	c.set(i, lerpColor(c.get(i), col, a))
}

// fillRow writes col to pixels [x0, x1) of row y without clipping checks.
func (c *canvas) fillRow(y, x0, x1 int, col uint32) {
	row := c.pix[(y*c.w+x0)*4 : (y*c.w+x1)*4]
	if len(row) == 0 {
		return
	}
	binary.LittleEndian.PutUint32(row, col)
	for n := 4; n < len(row); n *= 2 {
		copy(row[n:], row[:n])
	}
}

func (c *canvas) fillRect(x0, y0, x1, y1 int, col, a uint32) {
	x0, x1 = max(x0, 0), min(x1, c.w)
	y0, y1 = max(y0, c.y0), min(y1, c.y1)
	if x0 >= x1 {
		return
	}
	for y := y0; y < y1; y++ {
		if a >= 256 {
			c.fillRow(y, x0, x1, col)
			continue
		}
		for i := y*c.w + x0; i < y*c.w+x1; i++ {
			c.set(i, lerpColor(c.get(i), col, a))
		}
	}
}

func (c *canvas) hline(x0, x1, y int, col, a uint32) { c.fillRect(x0, y, x1+1, y+1, col, a) }
func (c *canvas) vline(x, y0, y1 int, col, a uint32) { c.fillRect(x, y0, x+1, y1+1, col, a) }

// line draws a 1px line. When iz > 0 each pixel is depth-tested against it.
func (c *canvas) line(x0, y0, x1, y1 float64, col, a uint32, iz float64) {
	dx, dy := x1-x0, y1-y0
	n := int(math.Ceil(math.Max(math.Abs(dx), math.Abs(dy))))
	if n > 4*(c.w+c.h) {
		return
	}
	if n == 0 {
		n = 1
	}
	sx, sy := dx/float64(n), dy/float64(n)
	x, y := x0, y0
	for k := 0; k <= n; k++ {
		px, py := int(math.Floor(x)), int(math.Floor(y))
		if iz <= 0 || c.depthOK(px, py, iz) {
			c.blendPx(px, py, col, a)
		}
		x += sx
		y += sy
	}
}

// depthOK reports whether something at inverse depth iz is in front of
// what is already at (x, y). Off-screen pixels pass.
func (c *canvas) depthOK(x, y int, iz float64) bool {
	if x < 0 || x >= c.w || y < 0 || y >= c.h {
		return true
	}
	return iz >= float64(c.zbuf[y*c.w+x])
}

// -- text ---------------------------------------------------------------------

func (c *canvas) text(s string, x, y int, col uint32) int {
	for _, r := range s {
		if g := glyphFor(r); g != nil {
			for gy := 0; gy < glyphH; gy++ {
				py := y + gy
				if py < c.y0 || py >= c.y1 {
					continue
				}
				for gx := 0; gx < glyphW; gx++ {
					if a := g[gy*glyphW+gx]; a != 0 {
						c.blendPx(x+gx, py, col, uint32(a)+uint32(a>>7))
					}
				}
			}
		}
		x += glyphW
	}
	return x
}

// shadowText draws text with a dark 1px drop shadow so it stays legible over
// any background.
func (c *canvas) shadowText(s string, x, y int, col uint32) int {
	c.text(s, x+1, y+1, rgb(0, 0, 0))
	return c.text(s, x, y, col)
}

func textWidth(s string) int {
	n := 0
	for range s {
		n++
	}
	return n * glyphW
}
