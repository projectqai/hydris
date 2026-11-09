package simcam

import (
	"fmt"
	"image"
	"image/draw"
	"net/http"
	"sync"
	"time"
)

const (
	tileSize    = 256
	tileMinZoom = 2
	tileMaxZoom = 19
	// Satellite tiles are full-colour JPEGs held as 256 KiB each; this
	// bounds the cache to about 48 MiB.
	maxCachedTiles  = 192
	maxTileFetches  = 4
	maxQueuedTiles  = 48
	maxParentLookup = 6
)

// tileAttribution must be shown wherever the imagery is.
const tileAttribution = "Imagery © Esri"

// tileURL is Esri World Imagery, the frontend's default satellite layer.
// Note the {z}/{y}/{x} order.
func tileURL(k tileKey) string {
	return fmt.Sprintf("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/%d/%d/%d", k.z, k.y, k.x)
}

type tileKey struct{ z, x, y int }

// tile is an opaque 256x256 map tile. Paletted tiles are kept as indices
// plus palette (64 KiB) instead of expanded RGBA.
type tile struct {
	idx []uint8
	pal *[256]uint32
	rgb []uint32
}

func (t *tile) at(i int) uint32 {
	if t.idx != nil {
		return t.pal[t.idx[i]]
	}
	return t.rgb[i]
}

type cachedTile struct {
	t    *tile
	used uint64
}

type tileCache struct {
	mu    sync.Mutex
	tiles map[tileKey]*cachedTile
	// pending holds requested tiles not yet fetched, newest last; queued
	// covers those plus the ones being fetched.
	pending []tileKey
	queued  map[tileKey]bool
	workers int
	failed  map[tileKey]time.Time
	gen     uint64
	fetch   func(tileKey) *tile
	loaded  broadcast
}

func newTileCache(fetch func(tileKey) *tile) *tileCache {
	return &tileCache{
		tiles:  make(map[tileKey]*cachedTile),
		queued: make(map[tileKey]bool),
		failed: make(map[tileKey]time.Time),
		fetch:  fetch,
	}
}

var globalTiles = newTileCache(fetchTile)

// coarseLead is how many levels up the fallback tile requested alongside a
// missing tile sits: one fetch covers 16x16 tiles with blurry imagery, so a
// fast-moving view never shows bare ground for long.
const coarseLead = 4

// resolve returns the best available tile for k: the tile itself (shift 0)
// or the closest cached ancestor, with shift = zoom levels up. Missing
// tiles are requested in the background.
func (tc *tileCache) resolve(k tileKey) (*tile, uint) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.gen++
	if ct := tc.tiles[k]; ct != nil {
		ct.used = tc.gen
		return ct.t, 0
	}
	tc.requestLocked(k)
	var found *cachedTile
	var shift uint
	for d := 1; d <= maxParentLookup && k.z-d >= tileMinZoom; d++ {
		pk := tileKey{k.z - d, k.x >> d, k.y >> d}
		if ct := tc.tiles[pk]; ct != nil {
			found, shift = ct, uint(d)
			break
		}
	}
	// Without a fallback at least coarseLead levels up, ask for one; it is
	// queued last, so it is fetched first.
	if found == nil || shift < coarseLead {
		if d := min(coarseLead, k.z-tileMinZoom); d > 0 {
			tc.requestLocked(tileKey{k.z - d, k.x >> d, k.y >> d})
		}
	}
	if found == nil {
		return nil, 0
	}
	found.used = tc.gen
	return found.t, shift
}

// requestLocked queues a fetch. The queue is served newest first, since in
// a moving view the latest requests are the ones on screen; when full, the
// oldest request is dropped (it is asked for again if still needed).
func (tc *tileCache) requestLocked(k tileKey) {
	if tc.fetch == nil || tc.queued[k] || tc.tiles[k] != nil {
		return
	}
	if t, ok := tc.failed[k]; ok && time.Since(t) < assetRetryAfter {
		return
	}
	tc.queued[k] = true
	tc.pending = append(tc.pending, k)
	if len(tc.pending) > maxQueuedTiles {
		delete(tc.queued, tc.pending[0])
		tc.pending = tc.pending[1:]
	}
	if tc.workers < maxTileFetches {
		tc.workers++
		go tc.worker()
	}
}

func (tc *tileCache) worker() {
	for {
		tc.mu.Lock()
		n := len(tc.pending)
		if n == 0 {
			tc.workers--
			tc.mu.Unlock()
			return
		}
		k := tc.pending[n-1]
		tc.pending = tc.pending[:n-1]
		tc.mu.Unlock()

		t := tc.fetch(k)

		tc.mu.Lock()
		delete(tc.queued, k)
		if t == nil {
			tc.failed[k] = time.Now()
			tc.mu.Unlock()
			continue
		}
		delete(tc.failed, k)
		tc.gen++
		tc.tiles[k] = &cachedTile{t: t, used: tc.gen}
		for len(tc.tiles) > maxCachedTiles {
			var oldest tileKey
			oldGen := tc.gen + 1
			for key, ct := range tc.tiles {
				if ct.used < oldGen {
					oldest, oldGen = key, ct.used
				}
			}
			delete(tc.tiles, oldest)
		}
		tc.mu.Unlock()
		tc.loaded.fire()
	}
}

var tileHTTP = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        maxTileFetches,
		MaxIdleConnsPerHost: maxTileFetches,
		IdleConnTimeout:     60 * time.Second,
	},
}

func fetchTile(k tileKey) *tile {
	req, err := http.NewRequest("GET", tileURL(k), nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "hydris-simcam/1.0 (https://github.com/Project-q-ai)")
	resp, err := tileHTTP.Do(req)
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	img, _, err := image.Decode(resp.Body)
	if err != nil {
		return nil
	}
	return newTile(img)
}

// newTile flattens any transparency onto the ground colour.
func newTile(img image.Image) *tile {
	b := img.Bounds()
	if b.Dx() != tileSize || b.Dy() != tileSize {
		return nil
	}
	if p, ok := img.(*image.Paletted); ok && p.Stride == tileSize && len(p.Palette) <= 256 {
		pal := new([256]uint32)
		for i, c := range p.Palette {
			r, g, b, a := c.RGBA()
			pal[i] = flatten(r, g, b, a)
		}
		return &tile{idx: p.Pix[:tileSize*tileSize], pal: pal}
	}
	rgba := image.NewRGBA(image.Rect(0, 0, tileSize, tileSize))
	draw.Draw(rgba, rgba.Bounds(), img, b.Min, draw.Src)
	t := &tile{rgb: make([]uint32, tileSize*tileSize)}
	for i := range t.rgb {
		p := rgba.Pix[i*4 : i*4+4]
		t.rgb[i] = flatten(uint32(p[0])*0x101, uint32(p[1])*0x101, uint32(p[2])*0x101, uint32(p[3])*0x101)
	}
	return t
}

// flatten composites a 16-bit premultiplied colour over groundColor.
func flatten(r, g, b, a uint32) uint32 {
	ia := 0xffff - a
	ch := func(c, bg uint32) uint8 { return uint8((c + bg*0x101*ia/0xffff) >> 8) }
	return rgb(ch(r, groundColor&0xff), ch(g, groundColor>>8&0xff), ch(b, groundColor>>16&0xff))
}
