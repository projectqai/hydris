package simcam

import (
	"math"

	pb "github.com/projectqai/proto/go"
)

const (
	circleSegments = 24
	maxRoofPoints  = 512

	ambientLight = 0.55
	diffuseLight = 0.45
	// walls darken towards their foot: cheap fake ambient occlusion
	wallFootLight = 0.72
)

// sunDir points towards the sun: south-east, 40° up.
var sunDir = func() vec3 {
	sa, ca := math.Sincos(150 * deg2rad)
	se, ce := math.Sincos(40 * deg2rad)
	return vec3{sa * ce, ca * ce, se}
}()

type geoPt struct{ lat, lon float64 }

type fillStyle struct {
	color    uint32
	texID    string
	texScale float64 // metres per texture repeat; 0 = wall height
}

// prism is an extruded outline from a GeoShape: walls along ring, and a flat
// roof when the ring is a simple closed outline.
type prism struct {
	ring    []geoPt
	closed  bool
	roof    bool
	heightM float64
	fill    fillStyle
}

func prismsFromGeometry(pg *pb.PlanarGeometry, heightM float64, fill fillStyle) []prism {
	if pg == nil {
		return nil
	}
	var out []prism
	add := func(ring []geoPt, closed, roof bool) {
		if (closed && len(ring) >= 3) || (!closed && len(ring) >= 2) {
			out = append(out, prism{ring: ring, closed: closed, roof: roof, heightM: heightM, fill: fill})
		}
	}
	switch p := pg.Plane.(type) {
	case *pb.PlanarGeometry_Polygon:
		if p.Polygon == nil {
			break
		}
		add(ringPoints(p.Polygon.Outer, true), true, len(p.Polygon.Holes) == 0)
		for _, h := range p.Polygon.Holes {
			add(ringPoints(h, true), true, false)
		}
	case *pb.PlanarGeometry_Line:
		add(ringPoints(p.Line, false), false, false)
	case *pb.PlanarGeometry_Circle:
		c := p.Circle
		if c == nil || c.Center == nil || c.RadiusM <= 0 {
			break
		}
		inner := c.GetInnerRadiusM()
		add(circleRing(c.Center, c.RadiusM), true, inner <= 0)
		if inner > 0 {
			add(circleRing(c.Center, inner), true, false)
		}
	case *pb.PlanarGeometry_Collection:
		for _, child := range p.Collection.GetGeometries() {
			out = append(out, prismsFromGeometry(child, heightM, fill)...)
		}
	}
	return out
}

func ringPoints(r *pb.PlanarRing, closed bool) []geoPt {
	if r == nil {
		return nil
	}
	pts := make([]geoPt, 0, len(r.Points))
	for _, p := range r.Points {
		g := geoPt{p.Latitude, p.Longitude}
		if n := len(pts); n > 0 && pts[n-1] == g {
			continue
		}
		pts = append(pts, g)
	}
	if closed && len(pts) > 1 && pts[0] == pts[len(pts)-1] {
		pts = pts[:len(pts)-1]
	}
	return pts
}

func circleRing(c *pb.PlanarPoint, radiusM float64) []geoPt {
	cosLat := math.Cos(c.Latitude * deg2rad)
	pts := make([]geoPt, circleSegments)
	for i := range pts {
		s, co := math.Sincos(2 * math.Pi * float64(i) / circleSegments)
		pts[i] = geoPt{
			lat: c.Latitude + radiusM*co/metersPerDegLat,
			lon: c.Longitude + radiusM*s/(metersPerDegLat*cosLat),
		}
	}
	return pts
}

// -- camera-relative mesh -----------------------------------------------------

type meshTri struct {
	p        [3]vec3
	uv       [3][2]float64 // in texture repeats
	lum      [3]float64
	color    uint32
	texID    string
	texScale float64
}

// wallSeg is a wall footprint, kept for line-of-sight tests.
type wallSeg struct {
	ax, ay, bx, by float64
	z0, z1         float64
}

type mesh struct {
	tris  []meshTri
	walls []wallSeg
}

// buildMesh converts prisms into triangles in the camera's ENU frame.
func buildMesh(prisms []prism, v *view) *mesh {
	m := &mesh{}
	base := -v.alt
	for i := range prisms {
		pr := &prisms[i]
		top := base + pr.heightM
		pts := make([]vec3, len(pr.ring))
		for k, g := range pr.ring {
			pts[k] = v.enu(g.lat, g.lon, 0)
		}
		scale := pr.fill.texScale
		if scale <= 0 {
			scale = pr.heightM
		}
		vBot := pr.heightM / scale

		n := len(pts)
		segs := n - 1
		if pr.closed {
			segs = n
		}
		along := 0.0
		for s := 0; s < segs; s++ {
			a, b := pts[s], pts[(s+1)%n]
			dx, dy := b.x-a.x, b.y-a.y
			length := math.Hypot(dx, dy)
			if length < 0.01 {
				continue
			}
			m.walls = append(m.walls, wallSeg{a.x, a.y, b.x, b.y, base, top})

			// Walls are double-sided; light the side facing the camera.
			nrm := vec3{dy / length, -dx / length, 0}
			if nrm.dot(a) > 0 {
				nrm = nrm.scale(-1)
			}
			lt := ambientLight + diffuseLight*math.Max(0, nrm.dot(sunDir))
			lb := lt * wallFootLight
			u0, u1 := along/scale, (along+length)/scale
			a0, b0 := vec3{a.x, a.y, base}, vec3{b.x, b.y, base}
			a1, b1 := vec3{a.x, a.y, top}, vec3{b.x, b.y, top}
			m.tris = append(m.tris,
				meshTri{
					p:     [3]vec3{a0, b0, b1},
					uv:    [3][2]float64{{u0, vBot}, {u1, vBot}, {u1, 0}},
					lum:   [3]float64{lb, lb, lt},
					color: pr.fill.color, texID: pr.fill.texID, texScale: scale,
				},
				meshTri{
					p:     [3]vec3{a0, b1, a1},
					uv:    [3][2]float64{{u0, vBot}, {u1, 0}, {u0, 0}},
					lum:   [3]float64{lb, lt, lt},
					color: pr.fill.color, texID: pr.fill.texID, texScale: scale,
				})
			along += length
		}

		if pr.roof && n <= maxRoofPoints {
			l := ambientLight + diffuseLight*sunDir.z
			for _, t := range triangulate(pts) {
				var mt meshTri
				for k := range 3 {
					p := pts[t[k]]
					mt.p[k] = vec3{p.x, p.y, top}
					mt.lum[k] = l
				}
				mt.color = pr.fill.color
				m.tris = append(m.tris, mt)
			}
		}
	}
	return m
}

// occluded reports whether a wall blocks the line of sight from the camera
// (origin) to p.
func (m *mesh) occluded(p vec3) bool {
	for i := range m.walls {
		w := &m.walls[i]
		ex, ey := w.bx-w.ax, w.by-w.ay
		den := p.y*ex - p.x*ey
		if math.Abs(den) < 1e-12 {
			continue
		}
		f := (w.ay*ex - w.ax*ey) / den // fraction along the sight line
		s := (p.x*w.ay - p.y*w.ax) / den
		if f <= 0 || f >= 0.999 || s < 0 || s > 1 {
			continue
		}
		if z := p.z * f; z >= w.z0 && z <= w.z1 {
			return true
		}
	}
	return false
}

// triangulate ear-clips a simple polygon (x/y only) into index triples.
func triangulate(pts []vec3) [][3]int {
	n := len(pts)
	if n < 3 {
		return nil
	}
	idx := make([]int, n)
	area := 0.0
	for i := range idx {
		idx[i] = i
		j := (i + 1) % n
		area += pts[i].x*pts[j].y - pts[j].x*pts[i].y
	}
	if area < 0 {
		for i, j := 0, n-1; i < j; i, j = i+1, j-1 {
			idx[i], idx[j] = idx[j], idx[i]
		}
	}
	cross := func(a, b, c vec3) float64 {
		return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)
	}
	out := make([][3]int, 0, n-2)
	for len(idx) > 3 {
		ear := -1
		for i := range idx {
			a, b, c := idx[(i+len(idx)-1)%len(idx)], idx[i], idx[(i+1)%len(idx)]
			pa, pb, pc := pts[a], pts[b], pts[c]
			if cross(pa, pb, pc) <= 0 {
				continue
			}
			inside := false
			for _, o := range idx {
				if o == a || o == b || o == c {
					continue
				}
				po := pts[o]
				if cross(pa, pb, po) >= 0 && cross(pb, pc, po) >= 0 && cross(pc, pa, po) >= 0 {
					inside = true
					break
				}
			}
			if !inside {
				ear = i
				out = append(out, [3]int{a, b, c})
				break
			}
		}
		if ear < 0 {
			break // degenerate or self-intersecting: fan the rest
		}
		idx = append(idx[:ear], idx[ear+1:]...)
	}
	for k := 1; k+1 < len(idx); k++ {
		out = append(out, [3]int{idx[0], idx[k], idx[k+1]})
	}
	return out
}
