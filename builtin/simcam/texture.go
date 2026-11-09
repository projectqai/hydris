package simcam

import (
	"context"
	"image"
	"image/draw"
	_ "image/jpeg" // sprite and texture artifacts may be JPEG
	_ "image/png"
	"io"
	"math"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin/artifacts"
)

const (
	maxTextureSize  = 1024
	assetRetryAfter = 30 * time.Second
)

// broadcast wakes every waiter once when fire is called. Render loops use it
// to redraw as soon as a tile or sprite finishes loading.
type broadcast struct {
	mu sync.Mutex
	ch chan struct{}
}

func (b *broadcast) wait() <-chan struct{} {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ch == nil {
		b.ch = make(chan struct{})
	}
	return b.ch
}

func (b *broadcast) fire() {
	b.mu.Lock()
	if b.ch != nil {
		close(b.ch)
		b.ch = nil
	}
	b.mu.Unlock()
}

// texture is a premultiplied RGBA image with a box-filtered mip chain;
// mips[0] is the texture itself.
type texture struct {
	w, h int
	pix  []uint32
	mips []*texture
}

func newTexture(img image.Image) *texture {
	b := img.Bounds()
	if b.Dx() <= 0 || b.Dy() <= 0 {
		return nil
	}
	rgba, ok := img.(*image.RGBA)
	if !ok || rgba.Stride != b.Dx()*4 {
		rgba = image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
		draw.Draw(rgba, rgba.Bounds(), img, b.Min, draw.Src)
	}
	t := &texture{w: b.Dx(), h: b.Dy(), pix: make([]uint32, b.Dx()*b.Dy())}
	for i := range t.pix {
		p := rgba.Pix[i*4 : i*4+4]
		t.pix[i] = uint32(p[0]) | uint32(p[1])<<8 | uint32(p[2])<<16 | uint32(p[3])<<24
	}

	var chain []*texture
	for m := t; ; m = m.half() {
		chain = append(chain, m)
		if m.w == 1 && m.h == 1 {
			break
		}
	}
	// Huge source images only cost memory and cache misses; start the chain
	// at the first level that fits.
	for len(chain) > 1 && (chain[0].w > maxTextureSize || chain[0].h > maxTextureSize) {
		chain = chain[1:]
	}
	for _, m := range chain {
		m.mips = nil
	}
	chain[0].mips = chain
	return chain[0]
}

// half returns a 2x2 box-filtered copy at half resolution.
func (t *texture) half() *texture {
	w, h := max(t.w/2, 1), max(t.h/2, 1)
	out := &texture{w: w, h: h, pix: make([]uint32, w*h)}
	for y := 0; y < h; y++ {
		y0, y1 := min(2*y, t.h-1), min(2*y+1, t.h-1)
		for x := 0; x < w; x++ {
			x0, x1 := min(2*x, t.w-1), min(2*x+1, t.w-1)
			a, b := t.pix[y0*t.w+x0], t.pix[y0*t.w+x1]
			c, d := t.pix[y1*t.w+x0], t.pix[y1*t.w+x1]
			var px uint32
			for s := uint(0); s < 32; s += 8 {
				sum := (a>>s)&0xff + (b>>s)&0xff + (c>>s)&0xff + (d>>s)&0xff
				px |= ((sum + 2) / 4) << s
			}
			out.pix[y*w+x] = px
		}
	}
	return out
}

// mipLevel picks the level whose texels are closest to one per pixel given
// how many base texels cover a pixel.
func (t *texture) mipLevel(texelsPerPx float64) *texture {
	if texelsPerPx < 2 {
		return t
	}
	// floor(log2) straight from the float exponent
	l := int(math.Float64bits(texelsPerPx)>>52&0x7ff) - 1023
	if l >= len(t.mips) {
		l = len(t.mips) - 1
	}
	return t.mips[l]
}

// sampleRepeat samples at (u, v) in texture repeats, wrapping both axes.
func (t *texture) sampleRepeat(u, v float64) uint32 {
	x := int(math.Floor(u*float64(t.w))) % t.w
	y := int(math.Floor(v*float64(t.h))) % t.h
	if x < 0 {
		x += t.w
	}
	if y < 0 {
		y += t.h
	}
	return t.pix[y*t.w+x]
}

// -- sprite cache -------------------------------------------------------------

// assetCache loads artifact images in the background and returns them as
// textures once ready. Misses never block rendering.
type assetCache struct {
	mu      sync.Mutex
	images  map[string]*texture
	pending map[string]bool
	failed  map[string]time.Time
	load    func(id string) *texture
	loaded  broadcast
}

func newAssetCache(load func(string) *texture) *assetCache {
	return &assetCache{
		images:  make(map[string]*texture),
		pending: make(map[string]bool),
		failed:  make(map[string]time.Time),
		load:    load,
	}
}

var globalSprites = newAssetCache(loadArtifactTexture)

// get returns the texture for id, or nil and starts loading it.
func (ac *assetCache) get(id string) *texture {
	if ac == nil || id == "" {
		return nil
	}
	ac.mu.Lock()
	defer ac.mu.Unlock()
	if t := ac.images[id]; t != nil {
		return t
	}
	if ac.pending[id] {
		return nil
	}
	if t, ok := ac.failed[id]; ok && time.Since(t) < assetRetryAfter {
		return nil
	}
	ac.pending[id] = true
	go func() {
		t := ac.load(id)
		ac.mu.Lock()
		delete(ac.pending, id)
		if t != nil {
			ac.images[id] = t
			delete(ac.failed, id)
		} else {
			ac.failed[id] = time.Now()
		}
		ac.mu.Unlock()
		if t != nil {
			ac.loaded.fire()
		}
	}()
	return nil
}

func loadArtifactTexture(id string) *texture {
	srv := artifacts.Server
	if srv == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rc, err := srv.Local().Get(ctx, id)
	if err != nil {
		return nil
	}
	defer func() { _ = rc.Close() }()
	img, _, err := image.Decode(io.LimitReader(rc, 10<<20))
	if err != nil {
		return nil
	}
	return newTexture(img)
}
