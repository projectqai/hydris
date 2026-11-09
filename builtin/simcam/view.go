package simcam

import "math"

const (
	deg2rad = math.Pi / 180

	metersPerDegLat    = 111320.0
	earthCircumference = 40075016.686

	// nearPlane is the camera-space depth (m) below which geometry is clipped.
	nearPlane = 0.25
	// minEyeHeight keeps the camera above the ground plane so the floor
	// always renders, even for cameras published at altitude 0.
	minEyeHeight = 1.0

	defaultEntitySizeM = 2.0
)

type vec3 struct{ x, y, z float64 }

func (a vec3) add(b vec3) vec3      { return vec3{a.x + b.x, a.y + b.y, a.z + b.z} }
func (a vec3) sub(b vec3) vec3      { return vec3{a.x - b.x, a.y - b.y, a.z - b.z} }
func (a vec3) scale(k float64) vec3 { return vec3{a.x * k, a.y * k, a.z * k} }
func (a vec3) dot(b vec3) float64   { return a.x*b.x + a.y*b.y + a.z*b.z }
func (a vec3) len() float64         { return math.Sqrt(a.dot(a)) }

// view is a pinhole camera in a local east-north-up frame centred on the
// camera (x east, y north, z up, metres). The gimbal has no roll, so right is
// always horizontal: every screen row then maps to a single ground depth,
// which the floor renderer relies on.
type view struct {
	w, h           int
	cx, cy         float64
	focal          float64 // pixels
	fwd, right, up vec3
	lat, lon, alt  float64
	cosLat         float64
}

func newView(lat, lon, alt, panDeg, tiltDeg, hfovDeg float64, w, h int) *view {
	if alt < minEyeHeight {
		alt = minEyeHeight
	}
	hfovDeg = clamp(hfovDeg, 0.5, 170)
	sa, ca := math.Sincos(panDeg * deg2rad)
	se, ce := math.Sincos(clamp(tiltDeg, -89.9, 89.9) * deg2rad)
	return &view{
		w: w, h: h,
		cx: float64(w) / 2, cy: float64(h) / 2,
		focal:  float64(w) / 2 / math.Tan(hfovDeg*deg2rad/2),
		fwd:    vec3{sa * ce, ca * ce, se},
		right:  vec3{ca, -sa, 0},
		up:     vec3{-sa * se, -ca * se, ce},
		lat:    lat,
		lon:    lon,
		alt:    alt,
		cosLat: math.Cos(lat * deg2rad),
	}
}

// enu returns a geodetic point relative to the camera. Flat-earth is plenty
// accurate within the few kilometres a camera covers.
func (v *view) enu(lat, lon, alt float64) vec3 {
	return vec3{
		(lon - v.lon) * metersPerDegLat * v.cosLat,
		(lat - v.lat) * metersPerDegLat,
		alt - v.alt,
	}
}

// toCam converts an ENU offset to camera space (x right, y up, z depth).
func (v *view) toCam(p vec3) vec3 {
	return vec3{p.dot(v.right), p.dot(v.up), p.dot(v.fwd)}
}

// project maps a camera-space point with z > 0 to pixel coordinates.
func (v *view) project(c vec3) (x, y float64) {
	k := v.focal / c.z
	return v.cx + c.x*k, v.cy - c.y*k
}

// -- entity placement ---------------------------------------------------------

// placement is where an entity lands on screen. Both the renderer and the
// detection emitter use it, so bounding boxes always match the picture.
type placement struct {
	pos      vec3    // ENU centre of the object
	depth    float64 // camera-space depth of the centre
	rangeM   float64
	x, y     float64 // screen centre
	pw, ph   float64 // projected physical size in pixels
	airborne bool

	// ground point beneath the object; valid when gdepth > 0
	gx, gy, gdepth float64
}

func entitySize(e *cachedEntity) (w, h float64) {
	w, h = float64(e.widthM), float64(e.heightM)
	if w <= 0 {
		w = h
	}
	if h <= 0 {
		h = w
	}
	if w <= 0 {
		w, h = defaultEntitySizeM, defaultEntitySizeM
	}
	return w, h
}

// place projects an entity. Objects lower than their own height are treated
// as standing on the ground (bottom at altitude); others are centred on
// their altitude.
func (v *view) place(e *cachedEntity) (placement, bool) {
	wm, hm := entitySize(e)
	p := v.enu(e.lat, e.lon, e.alt)
	airborne := e.alt >= hm
	if !airborne {
		p.z = math.Max(e.alt, 0) - v.alt + hm/2
	}
	c := v.toCam(p)
	if c.z < nearPlane {
		return placement{}, false
	}
	x, y := v.project(c)
	k := v.focal / c.z
	pl := placement{
		pos: p, depth: c.z, rangeM: p.len(),
		x: x, y: y, pw: wm * k, ph: hm * k,
		airborne: airborne,
	}
	margin := math.Max(math.Max(pl.pw, pl.ph), 64)
	if x < -margin || x > float64(v.w)+margin || y < -margin || y > float64(v.h)+margin {
		return pl, false
	}
	if g := v.toCam(vec3{p.x, p.y, -v.alt}); g.z >= nearPlane {
		pl.gx, pl.gy = v.project(g)
		pl.gdepth = g.z
	}
	return pl, true
}
