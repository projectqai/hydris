package simcam

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"
)

// renderContext holds everything the renderer needs for one frame.
type renderContext struct {
	poseSnapshot
	camLat, camLon, camAlt float64
	entities               map[string]cachedEntity
	walls                  []wallSegment
	tiles                  *tileCache
	renderBehindWall       bool
}

// renderFrame returns the rendered image and whether tiles are still loading.
func renderFrame(rc renderContext, w, h int) (*image.RGBA, bool) {
	img := image.NewRGBA(image.Rect(0, 0, w, h))

	fov := effectiveFov(rc.poseSnapshot)
	pxPerDeg := float64(w) / fov
	vFov := fov * float64(h) / float64(w)
	vPxPerDeg := float64(h) / vFov
	fovRad := fov * math.Pi / 180
	focalPx := float64(w) / 2 / math.Tan(fovRad/2)
	horizonY := float64(h)/2 + rc.Tilt*vPxPerDeg

	drawSky(img, horizonY)
	pending := drawFloor(img, rc, pxPerDeg, vPxPerDeg, horizonY)
	drawHorizonLine(img, horizonY)
	depthBuf := drawWalls(img, rc, focalPx)
	drawBillboards(img, rc, pxPerDeg, vPxPerDeg, focalPx, depthBuf)
	drawCompassStrip(img, rc.Pan, pxPerDeg)
	drawCrosshair(img)
	drawLiveDot(img)
	drawHUD(img, rc.poseSnapshot, fov)
	return img, pending
}

func effectiveFov(p poseSnapshot) float64 {
	if p.FovDeg > 0 {
		return p.FovDeg
	}
	return 60
}

// -- tile cache ---------------------------------------------------------------

type tileKey struct {
	z, x, y int
}

type tileCache struct {
	mu       sync.Mutex
	tiles    map[tileKey]*image.RGBA
	access   map[tileKey]uint64
	gen      uint64
	inflight map[tileKey]bool
	failed   map[tileKey]time.Time
}

const maxCachedTiles = 256

var globalTiles = &tileCache{
	tiles:    make(map[tileKey]*image.RGBA),
	access:   make(map[tileKey]uint64),
	inflight: make(map[tileKey]bool),
	failed:   make(map[tileKey]time.Time),
}

var tileHTTP = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        10,
		MaxIdleConnsPerHost: 5,
		IdleConnTimeout:     60 * time.Second,
	},
}

func (tc *tileCache) get(key tileKey) *image.RGBA {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	img := tc.tiles[key]
	if img != nil {
		tc.gen++
		tc.access[key] = tc.gen
	}
	return img
}

func (tc *tileCache) fetchAsync(key tileKey) {
	tc.mu.Lock()
	if tc.tiles[key] != nil || tc.inflight[key] {
		tc.mu.Unlock()
		return
	}
	if t, ok := tc.failed[key]; ok && time.Since(t) < 30*time.Second {
		tc.mu.Unlock()
		return
	}
	tc.inflight[key] = true
	tc.mu.Unlock()

	go func() {
		tile := fetchTile(key.z, key.x, key.y)

		tc.mu.Lock()
		delete(tc.inflight, key)
		if tile != nil {
			tc.gen++
			tc.tiles[key] = tile
			tc.access[key] = tc.gen
			delete(tc.failed, key)
			for len(tc.tiles) > maxCachedTiles {
				var oldKey tileKey
				oldGen := tc.gen
				for k, g := range tc.access {
					if g < oldGen {
						oldGen = g
						oldKey = k
					}
				}
				delete(tc.tiles, oldKey)
				delete(tc.access, oldKey)
			}
		} else {
			tc.failed[key] = time.Now()
		}
		tc.mu.Unlock()
	}()
}

func fetchTile(z, x, y int) *image.RGBA {
	servers := [3]string{"a", "b", "c"}
	server := servers[(z+x+y)%3]
	url := fmt.Sprintf("https://%s.basemaps.cartocdn.com/rastertiles/voyager/%d/%d/%d.png",
		server, z, x, y)

	resp, err := tileHTTP.Get(url)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil
	}
	decoded, err := png.Decode(resp.Body)
	if err != nil {
		return nil
	}
	return toRGBA(decoded)
}

func toRGBA(src image.Image) *image.RGBA {
	if rgba, ok := src.(*image.RGBA); ok {
		return rgba
	}
	bounds := src.Bounds()
	rgba := image.NewRGBA(bounds)
	draw.Draw(rgba, bounds, src, bounds.Min, draw.Src)
	return rgba
}

// -- color helpers ------------------------------------------------------------

func parseHexColor(s string) color.RGBA {
	if len(s) > 0 && s[0] == '#' {
		s = s[1:]
	}
	if len(s) != 6 {
		return color.RGBA{160, 160, 160, 255}
	}
	r := hexByte(s[0])<<4 | hexByte(s[1])
	g := hexByte(s[2])<<4 | hexByte(s[3])
	b := hexByte(s[4])<<4 | hexByte(s[5])
	return color.RGBA{r, g, b, 255}
}

func hexByte(c byte) uint8 {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10
	}
	return 0
}

func lerpRGBA(a, b color.RGBA, t float64) color.RGBA {
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	return color.RGBA{
		R: uint8(float64(a.R) + t*(float64(b.R)-float64(a.R))),
		G: uint8(float64(a.G) + t*(float64(b.G)-float64(a.G))),
		B: uint8(float64(a.B) + t*(float64(b.B)-float64(a.B))),
		A: 255,
	}
}

func darken(c color.RGBA, k float64) color.RGBA {
	return color.RGBA{
		R: uint8(float64(c.R) * k),
		G: uint8(float64(c.G) * k),
		B: uint8(float64(c.B) * k),
		A: 255,
	}
}

// -- drawing primitives -------------------------------------------------------

func setPx(img *image.RGBA, x, y int, c color.RGBA) {
	b := img.Bounds()
	if x < b.Min.X || x >= b.Max.X || y < b.Min.Y || y >= b.Max.Y {
		return
	}
	i := (y-b.Min.Y)*img.Stride + (x-b.Min.X)*4
	img.Pix[i+0] = c.R
	img.Pix[i+1] = c.G
	img.Pix[i+2] = c.B
	img.Pix[i+3] = c.A
}

func fillRect(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA) {
	if x0 > x1 {
		x0, x1 = x1, x0
	}
	if y0 > y1 {
		y0, y1 = y1, y0
	}
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			setPx(img, x, y, c)
		}
	}
}

func hLine(img *image.RGBA, x0, x1, y int, c color.RGBA) {
	if x0 > x1 {
		x0, x1 = x1, x0
	}
	for x := x0; x <= x1; x++ {
		setPx(img, x, y, c)
	}
}

func vLine(img *image.RGBA, x, y0, y1 int, c color.RGBA) {
	if y0 > y1 {
		y0, y1 = y1, y0
	}
	for y := y0; y <= y1; y++ {
		setPx(img, x, y, c)
	}
}

// -- sky & floor --------------------------------------------------------------

func drawSky(img *image.RGBA, horizonY float64) {
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()

	hY := int(math.Round(horizonY))
	if hY < 0 {
		hY = 0
	}
	if hY > h {
		hY = h
	}

	skyTop := color.RGBA{30, 60, 140, 255}
	skyBot := color.RGBA{110, 160, 220, 255}

	for y := 0; y < h; y++ {
		t := float64(y) / float64(maxInt(hY, 1))
		if t > 1 {
			t = 1
		}
		c := lerpRGBA(skyTop, skyBot, t)
		for x := 0; x < w; x++ {
			setPx(img, x, y, c)
		}
	}
}

const maxGroundDist = 5000.0

// floorZoom picks a tile zoom level from the camera altitude. Uses
// round(log2(alt)) so the level only changes at power-of-2 altitude
// boundaries (~5.7m, ~11.3m, ~22.6m, ~45.3m, …), preventing oscillation
// from small altitude jitter.
func floorZoom(camAlt float64) int {
	if camAlt < 1 {
		return 18
	}
	z := 20 - int(math.Round(math.Log2(camAlt)))
	if z < 10 {
		z = 10
	}
	if z > 18 {
		z = 18
	}
	return z
}

// tileOrParent looks up key in the cache. If missing, it kicks off an async
// fetch and walks up to 4 parent zoom levels looking for a cached ancestor.
// Returns the tile image, the zoom delta from the requested level (0 = exact
// match), and whether the exact tile is still pending.
func tileOrParent(tc *tileCache, z, tx, ty int) (tile *image.RGBA, delta int, pending bool) {
	key := tileKey{z, tx, ty}
	if t := tc.get(key); t != nil {
		return t, 0, false
	}
	tc.fetchAsync(key)
	for d := 1; d <= 4 && z-d >= 10; d++ {
		pk := tileKey{z - d, tx >> uint(d), ty >> uint(d)}
		if t := tc.get(pk); t != nil {
			return t, d, true
		}
	}
	return nil, 0, true
}

// drawFloor projects map tiles onto the ground plane below the horizon.
// Returns true if any tiles are still loading (caller should re-render later).
func drawFloor(img *image.RGBA, rc renderContext, pxPerDeg, vPxPerDeg, horizonY float64) bool {
	if rc.camAlt <= 0 || rc.tiles == nil {
		return false
	}

	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()

	hY := int(math.Round(horizonY)) + 1
	if hY < 0 {
		hY = 0
	}
	if hY >= h {
		return false
	}

	z := floorZoom(rc.camAlt)
	n := math.Pow(2, float64(z))
	cosLat := math.Cos(rc.camLat * math.Pi / 180)
	ground := color.RGBA{50, 50, 50, 255}

	sinH := make([]float64, w)
	cosH := make([]float64, w)
	for sx := 0; sx < w; sx++ {
		hAngle := (rc.Pan + float64(sx-w/2)/pxPerDeg) * math.Pi / 180
		sinH[sx] = math.Sin(hAngle)
		cosH[sx] = math.Cos(hAngle)
	}

	pending := false

	for sy := hY; sy < h; sy++ {
		vAngle := rc.Tilt + float64(h/2-sy)/vPxPerDeg
		if vAngle >= 0 {
			continue
		}
		groundDist := rc.camAlt / math.Tan(-vAngle*math.Pi/180)
		if groundDist > maxGroundDist || groundDist < 0 {
			continue
		}

		var lastKey tileKey
		var lastTile *image.RGBA
		var lastDelta int
		lastKeyValid := false

		for sx := 0; sx < w; sx++ {
			lat := rc.camLat + groundDist*cosH[sx]/111320
			lon := rc.camLon + groundDist*sinH[sx]/(111320*cosLat)

			tileXf := (lon + 180) / 360 * n
			latRad := lat * math.Pi / 180
			tileYf := (1 - math.Log(math.Tan(math.Pi/4+latRad/2))/math.Pi) / 2 * n

			tx := int(math.Floor(tileXf))
			ty := int(math.Floor(tileYf))

			key := tileKey{z, tx, ty}
			if !lastKeyValid || key != lastKey {
				lastKey = key
				lastKeyValid = true
				var tilePending bool
				lastTile, lastDelta, tilePending = tileOrParent(rc.tiles, z, tx, ty)
				if tilePending {
					pending = true
				}
			}
			if lastTile == nil {
				setPx(img, sx, sy, ground)
				continue
			}

			px := int((tileXf - float64(tx)) * 256)
			py := int((tileYf - float64(ty)) * 256)
			if lastDelta > 0 {
				d := uint(lastDelta)
				px = (tx&((1<<d)-1))*(256>>d) + (px >> d)
				py = (ty&((1<<d)-1))*(256>>d) + (py >> d)
			}
			if px < 0 {
				px = 0
			}
			if px > 255 {
				px = 255
			}
			if py < 0 {
				py = 0
			}
			if py > 255 {
				py = 255
			}

			i := py*lastTile.Stride + px*4
			if i+3 >= len(lastTile.Pix) {
				continue
			}
			setPx(img, sx, sy, color.RGBA{
				lastTile.Pix[i], lastTile.Pix[i+1], lastTile.Pix[i+2], 255,
			})
		}
	}
	return pending
}

func drawHorizonLine(img *image.RGBA, horizonY float64) {
	bounds := img.Bounds()
	w := bounds.Dx()
	hY := int(math.Round(horizonY))
	hLine(img, 0, w-1, hY, color.RGBA{255, 255, 255, 255})
	hLine(img, 0, w-1, hY+1, color.RGBA{0, 0, 0, 200})
}

// -- wall raycasting ----------------------------------------------------------

func drawWalls(img *image.RGBA, rc renderContext, focalPx float64) []float64 {
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	depthBuf := make([]float64, w)
	for i := range depthBuf {
		depthBuf[i] = math.MaxFloat64
	}

	if len(rc.walls) == 0 {
		return depthBuf
	}

	cosLat := math.Cos(rc.camLat * math.Pi / 180)

	type enuSeg struct {
		x0, y0, x1, y1 float64
		heightM        float64
		textureID      string
		textureScaleM  float64
		lengthM        float64
		fillColor      color.RGBA
		nx, ny         float64
	}

	panRad := rc.Pan * math.Pi / 180
	tiltRad := rc.Tilt * math.Pi / 180
	halfFovRad := effectiveFov(rc.poseSnapshot) * math.Pi / 180 / 2

	leftAng := panRad - halfFovRad
	rightAng := panRad + halfFovRad
	leftNX := math.Cos(leftAng)
	leftNY := -math.Sin(leftAng)
	rightNX := -math.Cos(rightAng)
	rightNY := math.Sin(rightAng)

	segs := make([]enuSeg, 0, len(rc.walls)/4)
	for _, ws := range rc.walls {
		e := enuSeg{
			x0:            (ws.lon0 - rc.camLon) * 111320 * cosLat,
			y0:            (ws.lat0 - rc.camLat) * 111320,
			x1:            (ws.lon1 - rc.camLon) * 111320 * cosLat,
			y1:            (ws.lat1 - rc.camLat) * 111320,
			heightM:       ws.heightM,
			textureID:     ws.textureID,
			textureScaleM: ws.textureScaleM,
			fillColor:     ws.fillColor,
		}
		if e.x0*leftNX+e.y0*leftNY < 0 && e.x1*leftNX+e.y1*leftNY < 0 {
			continue
		}
		if e.x0*rightNX+e.y0*rightNY < 0 && e.x1*rightNX+e.y1*rightNY < 0 {
			continue
		}
		dx := e.x1 - e.x0
		dy := e.y1 - e.y0
		e.lengthM = math.Sqrt(dx*dx + dy*dy)
		if e.lengthM < 0.01 {
			continue
		}
		e.nx = -dy / e.lengthM
		e.ny = dx / e.lengthM
		segs = append(segs, e)
	}

	for sx := 0; sx < w; sx++ {
		rayAngle := panRad + (float64(sx)-float64(w)/2)/focalPx
		sinR := math.Sin(rayAngle)
		cosR := math.Cos(rayAngle)

		bestDist := math.MaxFloat64
		var bestSeg *enuSeg
		var bestU float64

		for i := range segs {
			seg := &segs[i]
			dist, u := raySegIntersect(0, 0, sinR, cosR, seg.x0, seg.y0, seg.x1, seg.y1)
			if dist > 0 && dist < bestDist {
				bestDist = dist
				bestSeg = seg
				bestU = u
			}
		}

		if bestSeg == nil {
			continue
		}

		perpDist := bestDist * math.Cos(rayAngle-panRad)
		if perpDist < 0.1 {
			continue
		}

		depthBuf[sx] = perpDist

		wallBase := 0.0 - rc.camAlt
		wallTop := bestSeg.heightM - rc.camAlt

		baseAngle := math.Atan2(wallBase, perpDist) - tiltRad
		topAngle := math.Atan2(wallTop, perpDist) - tiltRad

		yBot := float64(h)/2 - baseAngle*focalPx
		yTop := float64(h)/2 - topAngle*focalPx

		if yTop > yBot {
			yTop, yBot = yBot, yTop
		}

		yTopI := int(math.Ceil(yTop))
		yBotI := int(math.Floor(yBot))
		if yTopI < 0 {
			yTopI = 0
		}
		if yBotI >= h {
			yBotI = h - 1
		}
		if yTopI > yBotI {
			continue
		}

		wallDistM := bestU * bestSeg.lengthM

		var tex *image.RGBA
		if bestSeg.textureID != "" {
			tex = globalSprites.get(bestSeg.textureID)
			if tex == nil {
				globalSprites.fetchAsync(bestSeg.textureID)
			}
		}

		distShade := 1.0 - math.Min(perpDist/rc.RangeMax, 0.7)
		orientShade := 0.65 + 0.35*math.Abs(bestSeg.nx)

		for sy := yTopI; sy <= yBotI; sy++ {
			if tex != nil {
				v := (float64(sy) - yTop) / (yBot - yTop)
				c := sampleWallTexture(tex, wallDistM, v, bestSeg.heightM, bestSeg.textureScaleM)
				setPx(img, sx, sy, darken(c, distShade))
			} else {
				setPx(img, sx, sy, darken(bestSeg.fillColor, distShade*orientShade))
			}
		}
	}
	return depthBuf
}

func raySegIntersect(ox, oy, dx, dy, ax, ay, bx, by float64) (dist float64, u float64) {
	ex := bx - ax
	ey := by - ay
	denom := dx*ey - dy*ex
	if math.Abs(denom) < 1e-12 {
		return -1, 0
	}
	t := ((ax-ox)*ey - (ay-oy)*ex) / denom
	s := ((ax-ox)*dy - (ay-oy)*dx) / denom
	if t < 0 || s < 0 || s > 1 {
		return -1, 0
	}
	return t, s
}

func sampleWallTexture(tex *image.RGBA, wallDistM, v, heightM, scaleM float64) color.RGBA {
	if scaleM <= 0 {
		scaleM = heightM
	}
	texB := tex.Bounds()
	tw := texB.Dx()
	th := texB.Dy()
	if tw == 0 || th == 0 {
		return color.RGBA{160, 160, 160, 255}
	}

	uTex := wallDistM / scaleM
	vTex := v * heightM / scaleM

	px := int(math.Abs(uTex*float64(tw))) % tw
	py := int(math.Abs(vTex*float64(th))) % th

	i := (py+texB.Min.Y)*tex.Stride + (px+texB.Min.X)*4
	if i+3 >= len(tex.Pix) {
		return color.RGBA{160, 160, 160, 255}
	}
	return color.RGBA{tex.Pix[i], tex.Pix[i+1], tex.Pix[i+2], 255}
}

// -- billboard sprites --------------------------------------------------------

type spriteInfo struct {
	screenX, screenY float64
	rangM            float64
	perpDist         float64
	label            string
	sidc             string
	widthM, heightM  float32
	sprite           *image.RGBA
}

func drawBillboards(img *image.RGBA, rc renderContext, pxPerDeg, vPxPerDeg, focalPx float64, depthBuf []float64) {
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	halfFov := effectiveFov(rc.poseSnapshot) / 2
	cosLat := math.Cos(rc.camLat * math.Pi / 180)
	panRad := rc.Pan * math.Pi / 180

	var sprites []spriteInfo

	for _, ent := range rc.entities {
		east := (ent.lon - rc.camLon) * 111320 * cosLat
		north := (ent.lat - rc.camLat) * 111320
		rangM := math.Sqrt(east*east + north*north)
		if rangM < 1 {
			continue
		}
		bearing := math.Atan2(east, north) * 180 / math.Pi
		relBearing := wrapSigned(bearing - rc.Pan)
		if math.Abs(relBearing) > halfFov+5 {
			continue
		}
		elev := math.Atan2(ent.alt-rc.camAlt, rangM) * 180 / math.Pi
		relElev := elev - rc.Tilt
		sx := float64(w)/2 + relBearing*pxPerDeg
		sy := float64(h)/2 - relElev*vPxPerDeg

		perpDist := east*math.Sin(panRad) + north*math.Cos(panRad)

		si := spriteInfo{
			screenX: sx, screenY: sy,
			rangM: rangM, perpDist: perpDist,
			label: ent.label, sidc: ent.sidc,
			widthM: ent.widthM, heightM: ent.heightM,
		}
		if len(ent.images) > 0 {
			id := ent.images[0]
			si.sprite = globalSprites.get(id)
			if si.sprite == nil {
				globalSprites.fetchAsync(id)
			}
		}
		sprites = append(sprites, si)
	}

	sort.Slice(sprites, func(i, j int) bool {
		return sprites[i].rangM > sprites[j].rangM
	})

	useDepth := !rc.renderBehindWall && depthBuf != nil

	for _, sp := range sprites {
		col := affiliationColor(sp.sidc)
		cx := int(math.Round(sp.screenX))
		cy := int(math.Round(sp.screenY))

		if sp.sprite != nil && sp.heightM > 0 {
			pxH := float64(sp.heightM) * focalPx / sp.rangM
			if pxH < 8 {
				pxH = 8
			}
			if pxH > float64(img.Bounds().Dy())*0.8 {
				pxH = float64(img.Bounds().Dy()) * 0.8
			}
			srcB := sp.sprite.Bounds()
			aspect := float64(srcB.Dx()) / float64(srcB.Dy())
			pxW := pxH * aspect

			if useDepth {
				drawScaledSpriteDepth(img, sp.sprite, cx, cy, int(math.Round(pxW)), int(math.Round(pxH)), depthBuf, sp.perpDist)
			} else {
				drawScaledSprite(img, sp.sprite, cx, cy, int(math.Round(pxW)), int(math.Round(pxH)))
			}
		} else {
			sizeM := float64(sp.widthM)
			if sizeM <= 0 {
				sizeM = float64(sp.heightM)
			}
			if sizeM <= 0 {
				sizeM = 1
			}
			sz := sizeM * focalPx / sp.rangM
			if sz < 4 {
				sz = 4
			}
			if sz > 30 {
				sz = 30
			}
			halfH := int(math.Round(sz))
			if useDepth {
				drawDiamondDepth(img, cx, cy, halfH, col, depthBuf, sp.perpDist)
			} else {
				drawDiamond(img, cx, cy, halfH, col)
			}
		}

	}
}

func drawScaledSprite(dst *image.RGBA, src *image.RGBA, cx, cy, dstW, dstH int) {
	srcB := src.Bounds()
	srcW := srcB.Dx()
	srcH := srcB.Dy()
	x0 := cx - dstW/2
	y0 := cy - dstH/2

	for dy := 0; dy < dstH; dy++ {
		sy := dy * srcH / dstH
		for dx := 0; dx < dstW; dx++ {
			sx := dx * srcW / dstW
			si := (sy+srcB.Min.Y)*src.Stride + (sx+srcB.Min.X)*4
			if si+3 >= len(src.Pix) {
				continue
			}
			a := src.Pix[si+3]
			if a == 0 {
				continue
			}
			setPx(dst, x0+dx, y0+dy, color.RGBA{
				src.Pix[si], src.Pix[si+1], src.Pix[si+2], a,
			})
		}
	}
}

func drawScaledSpriteDepth(dst *image.RGBA, src *image.RGBA, cx, cy, dstW, dstH int, depthBuf []float64, perpDist float64) {
	srcB := src.Bounds()
	srcW := srcB.Dx()
	srcH := srcB.Dy()
	x0 := cx - dstW/2
	y0 := cy - dstH/2

	for dy := 0; dy < dstH; dy++ {
		sy := dy * srcH / dstH
		for dx := 0; dx < dstW; dx++ {
			px := x0 + dx
			if px >= 0 && px < len(depthBuf) && perpDist > depthBuf[px] {
				continue
			}
			sx := dx * srcW / dstW
			si := (sy+srcB.Min.Y)*src.Stride + (sx+srcB.Min.X)*4
			if si+3 >= len(src.Pix) {
				continue
			}
			a := src.Pix[si+3]
			if a == 0 {
				continue
			}
			setPx(dst, px, y0+dy, color.RGBA{
				src.Pix[si], src.Pix[si+1], src.Pix[si+2], a,
			})
		}
	}
}

func affiliationColor(sidc string) color.RGBA {
	if len(sidc) < 2 {
		return color.RGBA{200, 200, 0, 255}
	}
	switch sidc[1] {
	case 'H', 'S':
		return color.RGBA{230, 60, 60, 255}
	case 'F', 'A', 'D', 'M':
		return color.RGBA{60, 120, 230, 255}
	case 'N', 'L':
		return color.RGBA{60, 200, 60, 255}
	default:
		return color.RGBA{200, 200, 0, 255}
	}
}

func drawDiamond(img *image.RGBA, cx, cy, r int, c color.RGBA) {
	for dy := -r; dy <= r; dy++ {
		ady := dy
		if ady < 0 {
			ady = -ady
		}
		hw := r - ady
		for dx := -hw; dx <= hw; dx++ {
			setPx(img, cx+dx, cy+dy, c)
		}
	}
	outline := darken(c, 0.5)
	for i := 0; i <= r; i++ {
		setPx(img, cx+i, cy-r+i, outline)
		setPx(img, cx+r-i, cy+i, outline)
		setPx(img, cx-i, cy+r-i, outline)
		setPx(img, cx-r+i, cy-i, outline)
	}
}

func drawDiamondDepth(img *image.RGBA, cx, cy, r int, c color.RGBA, depthBuf []float64, perpDist float64) {
	for dy := -r; dy <= r; dy++ {
		ady := dy
		if ady < 0 {
			ady = -ady
		}
		hw := r - ady
		for dx := -hw; dx <= hw; dx++ {
			px := cx + dx
			if px >= 0 && px < len(depthBuf) && perpDist > depthBuf[px] {
				continue
			}
			setPx(img, px, cy+dy, c)
		}
	}
	outline := darken(c, 0.5)
	for i := 0; i <= r; i++ {
		setPx(img, cx+i, cy-r+i, outline)
		setPx(img, cx+r-i, cy+i, outline)
		setPx(img, cx-i, cy+r-i, outline)
		setPx(img, cx-r+i, cy-i, outline)
	}
}

// -- HUD overlay (kept from previous renderer) --------------------------------

func drawCompassStrip(img *image.RGBA, panDeg, pxPerDeg float64) {
	bounds := img.Bounds()
	w := bounds.Dx()
	stripH := 22
	bg := color.RGBA{0, 0, 0, 160}
	fillRect(img, 0, 0, w, stripH, bg)

	cx := w / 2
	white := color.RGBA{240, 240, 240, 255}
	dim := color.RGBA{170, 170, 170, 255}

	maxOff := float64(w) / 2 / pxPerDeg
	startTick := int(math.Floor((panDeg-maxOff)/10)) * 10
	endTick := int(math.Ceil((panDeg+maxOff)/10)) * 10
	for tickAng := startTick; tickAng <= endTick; tickAng += 10 {
		off := float64(tickAng) - panDeg
		for off > 180 {
			off -= 360
		}
		for off < -180 {
			off += 360
		}
		x := cx + int(math.Round(off*pxPerDeg))
		if x < 0 || x >= w {
			continue
		}
		ang := ((tickAng % 360) + 360) % 360
		major := ang%45 == 0
		c := dim
		tickH := 6
		if major {
			c = white
			tickH = 12
		}
		vLine(img, x, 0, tickH, c)

		if major {
			label := cardinalLabel(ang)
			drawText5x7(img, label, x-len(label)*textFace.Advance/2, 13, white)
		}
	}

	yellow := color.RGBA{255, 220, 60, 255}
	vLine(img, cx, 0, stripH-1, yellow)
	for dy := 0; dy < 5; dy++ {
		hLine(img, cx-(4-dy), cx+(4-dy), stripH+dy, yellow)
	}
}

func cardinalLabel(angDeg int) string {
	switch ((angDeg%360)+360)%360 + 0 {
	case 0:
		return "N"
	case 45:
		return "NE"
	case 90:
		return "E"
	case 135:
		return "SE"
	case 180:
		return "S"
	case 225:
		return "SW"
	case 270:
		return "W"
	case 315:
		return "NW"
	}
	return ""
}

func drawCrosshair(img *image.RGBA) {
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	cx, cy := w/2, h/2
	c := color.RGBA{255, 255, 255, 230}
	gap := 6
	arm := 14
	hLine(img, cx-arm-gap, cx-gap, cy, c)
	hLine(img, cx+gap, cx+arm+gap, cy, c)
	vLine(img, cx, cy-arm-gap, cy-gap, c)
	vLine(img, cx, cy+gap, cy+arm+gap, c)
	setPx(img, cx, cy, c)
}

func bearingLabel(az float64) string {
	deg := int(math.Round(az)) % 360
	if deg < 0 {
		deg += 360
	}
	return pad3(deg) + "\xb0"
}

func pad3(n int) string {
	if n < 0 {
		n = 0
	}
	if n >= 1000 {
		return itoa(n)
	}
	if n >= 100 {
		return itoa(n)
	}
	if n >= 10 {
		return "0" + itoa(n)
	}
	return "00" + itoa(n)
}

func drawLiveDot(img *image.RGBA) {
	bounds := img.Bounds()
	w := bounds.Dx()
	x := w - 14
	y := 32
	ms := time.Now().UnixMilli() % 1000
	r := 4
	if ms < 500 {
		r = 5
	}
	red := color.RGBA{230, 60, 60, 255}
	for dy := -r; dy <= r; dy++ {
		for dx := -r; dx <= r; dx++ {
			if dx*dx+dy*dy <= r*r {
				setPx(img, x+dx, y+dy, red)
			}
		}
	}
}

func drawHUD(img *image.RGBA, p poseSnapshot, fov float64) {
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	stripH := 22
	fillRect(img, 0, h-stripH, w, h, color.RGBA{0, 0, 0, 170})

	info := bearingLabel(wrapAz(p.Pan)) +
		"  TILT " + formatAngle(p.Tilt) +
		"  FOV " + formatAngle(fov) +
		"  " + formatZoom(p.Zoom, p.RangeMax)

	label := info
	if p.Label != "" {
		label = p.Label + "  " + info
	}

	maxChars := w / textFace.Advance
	if len(label) > maxChars {
		label = label[len(label)-maxChars:]
	}

	textW := len(label) * textFace.Advance
	textX := (w - textW) / 2
	textY := h - stripH + (stripH-textFace.Height)/2
	drawText5x7(img, label, textX, textY, color.RGBA{240, 240, 240, 255})
}

// -- text helpers -------------------------------------------------------------

func formatAngle(deg float64) string {
	v := math.Round(deg*10) / 10
	if v == 0 {
		return "0\xb0"
	}
	sign := ""
	if v < 0 {
		sign = "-"
		v = -v
	}
	whole := int(v)
	frac := int(math.Round((v-float64(whole))*10)) % 10
	if frac == 0 {
		return sign + itoa(whole) + "\xb0"
	}
	return sign + itoa(whole) + "." + itoa(frac) + "\xb0"
}

func formatZoom(zoom, rangeMax float64) string {
	if rangeMax <= 0 {
		return "1.0X"
	}
	z := zoom / rangeMax * 9
	if z < 0 {
		z = 0
	}
	z += 1
	whole := int(z)
	frac := int(math.Round((z-float64(whole))*10)) % 10
	return itoa(whole) + "." + itoa(frac) + "X"
}

func wrapAz(d float64) float64 {
	r := math.Mod(d, 360)
	if r < 0 {
		r += 360
	}
	return r
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [10]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
