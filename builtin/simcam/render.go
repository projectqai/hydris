package simcam

import (
	"image"
	"runtime"
	"sync"
	"time"
)

const (
	maxBands    = 4
	minBandRows = 32
)

// poseSnapshot is the gimbal state a frame is rendered from.
type poseSnapshot struct {
	Pan, Tilt, Zoom float64
	// Yaw is the platform heading; the camera looks along Pan+Yaw.
	Yaw      float64
	FovDeg   float64
	RangeMax float64
	Label    string
}

// shapeSet is an immutable snapshot of the extruded shapes around a camera;
// version changes whenever the set does.
type shapeSet struct {
	version uint64
	prisms  []prism
}

// frameInput is everything one frame (or detection pass) depends on.
type frameInput struct {
	pose          poseSnapshot
	lat, lon, alt float64
	entities      []cachedEntity
	shapes        shapeSet
	occlude       bool // hide entities behind walls
	now           time.Time
}

func (in *frameInput) view(w, h int) *view {
	return newView(in.lat, in.lon, in.alt, in.pose.Pan+in.pose.Yaw, in.pose.Tilt, in.pose.FovDeg, w, h)
}

type meshKey struct {
	version       uint64
	lat, lon, alt float64
}

// renderer owns the frame and depth buffers and per-frame scratch space for
// one camera, so steady-state rendering does not allocate.
type renderer struct {
	w, h    int
	img     *image.RGBA
	zbuf    []float32
	tiles   *tileCache
	sprites *assetCache
	lookups []*tileLookup
	tris    []stri
	clipBuf [2][]cvert
	// groundSamples is the ground quality (1..maxGroundSamples).
	groundSamples int

	meshKey meshKey
	mesh    *mesh
	// lastView is the camera the last frame was rendered from.
	lastView *view
}

func newRenderer(w, h int, tiles *tileCache, sprites *assetCache) *renderer {
	r := &renderer{
		w: w, h: h,
		img:           image.NewRGBA(image.Rect(0, 0, w, h)),
		zbuf:          make([]float32, w*h),
		tiles:         tiles,
		sprites:       sprites,
		groundSamples: 1,
	}
	for range maxBands {
		r.lookups = append(r.lookups, newTileLookup(tiles))
	}
	return r
}

// meshFor returns the camera-relative mesh, rebuilding it only when the
// shapes or the camera position change.
func (r *renderer) meshFor(in *frameInput, v *view) *mesh {
	k := meshKey{in.shapes.version, v.lat, v.lon, v.alt}
	if r.mesh == nil || k != r.meshKey {
		r.mesh = buildMesh(in.shapes.prisms, v)
		r.meshKey = k
	}
	return r.mesh
}

func (r *renderer) render(in *frameInput) *image.RGBA {
	v := in.view(r.w, r.h)
	r.lastView = v
	r.prepareTris(v, r.meshFor(in, v))

	bands := min(runtime.GOMAXPROCS(0), maxBands, max(r.h/minBandRows, 1))
	if bands <= 1 {
		r.drawBand(v, 0, r.h, r.lookups[0])
	} else {
		var wg sync.WaitGroup
		for b := range bands {
			y0, y1 := r.h*b/bands, r.h*(b+1)/bands
			lk := r.lookups[b]
			wg.Go(func() { r.drawBand(v, y0, y1, lk) })
		}
		wg.Wait()
	}

	full := r.canvas(0, r.h)
	drawEntities(full, v, in, r.sprites)
	drawHUD(full, v, in.pose, in.now)
	return r.img
}

func (r *renderer) canvas(y0, y1 int) *canvas {
	return &canvas{pix: r.img.Pix, zbuf: r.zbuf, w: r.w, h: r.h, y0: y0, y1: y1}
}

func (r *renderer) drawBand(v *view, y0, y1 int, lk *tileLookup) {
	c := r.canvas(y0, y1)
	clear(r.zbuf[y0*r.w : y1*r.w])
	lk.reset()
	drawBackground(c, v, lk, r.groundSamples)
	for i := range r.tris {
		c.drawTri(&r.tris[i])
	}
}

// prepareTris transforms, near-clips and projects the mesh into r.tris.
func (r *renderer) prepareTris(v *view, m *mesh) {
	r.tris = r.tris[:0]
	texs := map[string]*texture{}
	w, h := float64(r.w), float64(r.h)

	for i := range m.tris {
		t := &m.tris[i]
		poly := r.clipBuf[0][:0]
		behind := 0
		for k := range 3 {
			cp := v.toCam(t.p[k])
			if cp.z < nearPlane {
				behind++
			}
			poly = append(poly, cvert{p: cp, a: [numAttrs]float64{
				t.uv[k][0], t.uv[k][1], t.lum[k], fogAmount(t.p[k].len()),
			}})
		}
		r.clipBuf[0] = poly
		if behind == 3 {
			continue
		}
		if behind > 0 {
			poly = clipNear(poly, r.clipBuf[1])
			r.clipBuf[1] = poly
			if len(poly) < 3 {
				continue
			}
		}

		var sv [4]svert
		minX, maxX, minY, maxY := w, 0.0, h, 0.0
		for k := range poly {
			p := &poly[k]
			s := &sv[k]
			s.x, s.y = v.project(p.p)
			s.iz = 1 / p.p.z
			for a := range s.a {
				s.a[a] = p.a[a] * s.iz
			}
			minX, maxX = min(minX, s.x), max(maxX, s.x)
			minY, maxY = min(minY, s.y), max(maxY, s.y)
		}
		if maxX < 0 || minX > w || maxY < 0 || minY > h {
			continue
		}

		mat := material{color: t.color}
		if t.texID != "" {
			tex, ok := texs[t.texID]
			if !ok {
				tex = r.sprites.get(t.texID)
				texs[t.texID] = tex
			}
			if tex != nil {
				mat.tex = tex
				mat.lodK = float64(tex.w) / (t.texScale * v.focal)
			}
		}
		for k := 1; k+1 < len(poly); k++ {
			r.tris = append(r.tris, stri{v: [3]svert{sv[0], sv[k], sv[k+1]}, mat: mat})
		}
	}
}
