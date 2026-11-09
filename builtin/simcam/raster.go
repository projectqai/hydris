package simcam

import (
	"math"
)

// Vertex attributes carried through clipping and rasterisation.
const (
	attrU = iota
	attrV
	attrLum
	attrFog
	numAttrs
)

type material struct {
	color uint32
	tex   *texture
	lodK  float64 // base texels per pixel per metre of depth
}

// svert is a projected vertex; attributes are premultiplied by iz so they
// interpolate linearly in screen space (perspective-correct).
type svert struct {
	x, y, iz float64
	a        [numAttrs]float64
}

type stri struct {
	v   [3]svert
	mat material
}

// cvert is a camera-space vertex before projection.
type cvert struct {
	p vec3
	a [numAttrs]float64
}

// clipNear clips a polygon against z >= nearPlane (Sutherland-Hodgman).
func clipNear(in []cvert, out []cvert) []cvert {
	out = out[:0]
	for i := range in {
		a, b := &in[i], &in[(i+1)%len(in)]
		ain, bin := a.p.z >= nearPlane, b.p.z >= nearPlane
		if ain {
			out = append(out, *a)
		}
		if ain != bin {
			t := (nearPlane - a.p.z) / (b.p.z - a.p.z)
			var c cvert
			c.p = a.p.add(b.p.sub(a.p).scale(t))
			for k := range c.a {
				c.a[k] = a.a[k] + (b.a[k]-a.a[k])*t
			}
			out = append(out, c)
		}
	}
	return out
}

// drawTri rasterises one triangle into the canvas rows with depth testing.
// For each row the covered span is solved directly from the three edge
// equations, so no per-pixel inside tests are needed.
func (c *canvas) drawTri(t *stri) {
	v0, v1, v2 := &t.v[0], &t.v[1], &t.v[2]
	area := (v1.x-v0.x)*(v2.y-v0.y) - (v2.x-v0.x)*(v1.y-v0.y)
	if area < 0 {
		v1, v2 = v2, v1
		area = -area
	}
	if area < 1e-9 {
		return
	}

	minY := math.Min(v0.y, math.Min(v1.y, v2.y))
	maxY := math.Max(v0.y, math.Max(v1.y, v2.y))
	yStart := max(int(math.Ceil(minY-0.5)), c.y0)
	yEnd := min(int(math.Floor(maxY-0.5)), c.y1-1)
	if yStart > yEnd {
		return
	}

	// plane gradients for iz and the attributes
	e1x, e1y := v1.x-v0.x, v1.y-v0.y
	e2x, e2y := v2.x-v0.x, v2.y-v0.y
	grad := func(f0, f1, f2 float64) (dx, dy float64) {
		return ((f1-f0)*e2y - (f2-f0)*e1y) / area, ((f2-f0)*e1x - (f1-f0)*e2x) / area
	}
	izdx, izdy := grad(v0.iz, v1.iz, v2.iz)
	var adx, ady [numAttrs]float64
	for k := range adx {
		adx[k], ady[k] = grad(v0.a[k], v1.a[k], v2.a[k])
	}

	edges := [3][2]*svert{{v0, v1}, {v1, v2}, {v2, v0}}
	m := &t.mat
	tex := m.tex
	maxX := float64(c.w) - 1

	for py := yStart; py <= yEnd; py++ {
		yc := float64(py) + 0.5
		lo, hi := 0.0, maxX
		for _, e := range edges {
			a, b := e[0], e[1]
			// E(xc) = K + A*xc must be >= 0 for pixel centres xc = px+0.5
			A := a.y - b.y
			K := (b.x-a.x)*(yc-a.y) + (b.y-a.y)*a.x
			switch {
			case A > 0:
				lo = math.Max(lo, math.Ceil(-K/A-0.5))
			case A < 0:
				hi = math.Min(hi, math.Floor(-K/A-0.5))
			case K < 0:
				hi = -1
			}
		}
		if lo > hi {
			continue
		}
		xs, xe := int(lo), int(hi)

		ox, oy := float64(xs)+0.5-v0.x, yc-v0.y
		iz := v0.iz + izdx*ox + izdy*oy
		var a [numAttrs]float64
		for k := range a {
			a[k] = v0.a[k] + adx[k]*ox + ady[k]*oy
		}

		i := py*c.w + xs
		for px := xs; px <= xe; px, i = px+1, i+1 {
			if iz > float64(c.zbuf[i]) && iz > 0 {
				z := 1 / iz
				col := m.color
				if tex != nil {
					col = tex.mipLevel(z*m.lodK).sampleRepeat(a[attrU]*z, a[attrV]*z)
				}
				fog := unit256(a[attrFog] * z)
				lit := unit256(a[attrLum]*z) * (256 - fog) >> 8
				c.set(i, mix(col, horizonColor, lit, fog))
				c.zbuf[i] = float32(iz)
			}
			iz += izdx
			a[attrU] += adx[attrU]
			a[attrV] += adx[attrV]
			a[attrLum] += adx[attrLum]
			a[attrFog] += adx[attrFog]
		}
	}
}
