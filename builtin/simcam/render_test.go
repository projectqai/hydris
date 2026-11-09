package simcam

import (
	"bytes"
	"context"
	"fmt"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
)

// syntheticTile draws a continuous street grid so ground projection can be
// checked without network access.
func syntheticTile(k tileKey) *tile {
	t := &tile{rgb: make([]uint32, tileSize*tileSize)}
	for y := 0; y < tileSize; y++ {
		for x := 0; x < tileSize; x++ {
			gx, gy := (k.x*tileSize+x)<<(tileMaxZoom-k.z), (k.y*tileSize+y)<<(tileMaxZoom-k.z)
			c := rgb(236, 230, 214)
			switch {
			case gx%160 < 14 || gy%160 < 14:
				c = rgb(255, 255, 255)
			case (gx/160+gy/160)%5 == 0:
				c = rgb(176, 214, 160)
			}
			t.rgb[y*tileSize+x] = c
		}
	}
	return t
}

// loadedTiles renders until every tile the scene needs has been fetched.
func loadedTiles(t testing.TB, r *renderer, in *frameInput) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		r.render(in)
		r.tiles.mu.Lock()
		n := len(r.tiles.queued)
		r.tiles.mu.Unlock()
		if n == 0 {
			r.render(in)
			r.tiles.mu.Lock()
			n = len(r.tiles.queued)
			r.tiles.mu.Unlock()
			if n == 0 {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("tiles did not load")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func offset(lat, lon, eastM, northM float64) (float64, float64) {
	return lat + northM/metersPerDegLat, lon + eastM/(metersPerDegLat*math.Cos(lat*deg2rad))
}

func testScene() *frameInput {
	lat, lon := anchorLatitude, anchorLongitude
	box := func(e, n, w, d float64) []geoPt {
		var pts []geoPt
		for _, c := range [][2]float64{{e, n}, {e + w, n}, {e + w, n + d}, {e, n + d}} {
			la, lo := offset(lat, lon, c[0], c[1])
			pts = append(pts, geoPt{la, lo})
		}
		return pts
	}
	prisms := []prism{
		{ring: box(-40, 120, 30, 20), closed: true, roof: true, heightM: 18, fill: fillStyle{color: rgb(190, 150, 120)}},
		{ring: box(30, 200, 50, 30), closed: true, roof: true, heightM: 30, fill: fillStyle{color: rgb(150, 160, 175)}},
		{ring: box(-20, 60, 2, 0.5)[:2], heightM: 3, fill: fillStyle{color: rgb(120, 120, 120)}},
	}
	ent := func(id, sidc string, e, n, alt float64) cachedEntity {
		la, lo := offset(lat, lon, e, n)
		return cachedEntity{id: id, lat: la, lon: lo, alt: alt, sidc: sidc, label: id, widthM: 4, heightM: 2}
	}
	return &frameInput{
		pose:     poseSnapshot{Pan: 0, Tilt: -8, Zoom: 0, FovDeg: 60, RangeMax: 2000, Label: "Test Camera"},
		lat:      lat,
		lon:      lon,
		alt:      12,
		entities: []cachedEntity{ent("hostile", "SHGP", 15, 90, 0), ent("friend", "SFAP", -5, 150, 22), ent("hidden", "SNGP", -25, 160, 0)},
		shapes:   shapeSet{version: 1, prisms: prisms},
		occlude:  true,
		now:      time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC),
	}
}

func px(r *renderer, x, y int) (uint8, uint8, uint8) {
	i := y*r.img.Stride + x*4
	return r.img.Pix[i], r.img.Pix[i+1], r.img.Pix[i+2]
}

func TestRenderScene(t *testing.T) {
	r := newRenderer(streamWidth, streamHeight, newTileCache(syntheticTile), newAssetCache(func(string) *texture { return nil }))
	in := testScene()
	loadedTiles(t, r, in)
	img := r.render(in)

	if path := os.Getenv("SIMCAM_DUMP"); path != "" {
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		_ = png.Encode(f, img)
		_ = f.Close()
	}

	// sky above the horizon is blue-ish
	if rr, _, b := px(r, 20, 60); b <= rr {
		t.Errorf("sky pixel not blue: r=%d b=%d", rr, b)
	}
	// the near ground shows the synthetic map, not the procedural fallback
	if rr, g, b := px(r, 20, streamHeight-30); rr < 170 || g < 170 || b < 140 {
		t.Errorf("ground pixel not textured: %d,%d,%d", rr, g, b)
	}
	// the 30 m building ahead-right occupies its projected position
	v := in.view(streamWidth, streamHeight)
	c := v.toCam(v.enuGround(offset(in.lat, in.lon, 55, 200)).add(vec3{0, 0, 15}))
	bx, by := v.project(c)
	if rr, g, b := px(r, int(bx), int(by)); math.Abs(float64(rr)-float64(b)) > 60 || g < 60 {
		t.Errorf("expected grey building at %.0f,%.0f, got %d,%d,%d", bx, by, rr, g, b)
	}
	if r.zbuf[int(by)*streamWidth+int(bx)] == 0 {
		t.Error("building did not write depth")
	}
}

// enuGround takes the (lat, lon) pair from offset at ground level.
func (v *view) enuGround(lat, lon float64) vec3 { return v.enu(lat, lon, 0) }

func TestViewProjection(t *testing.T) {
	v := newView(anchorLatitude, anchorLongitude, 10, 90, 0, 60, 640, 360)
	// a point due east at camera height lands in the centre
	x, y := v.project(v.toCam(vec3{100, 0, 0}))
	if math.Abs(x-320) > 1e-6 || math.Abs(y-180) > 1e-6 {
		t.Fatalf("centre: got %.2f,%.2f", x, y)
	}
	// 30° right of boresight lands on the right edge for a 60° HFOV
	x, _ = v.project(v.toCam(vec3{100, -100 * math.Tan(30*deg2rad), 0}))
	if math.Abs(x-640) > 1e-6 {
		t.Fatalf("edge: got %.2f", x)
	}
	// ground is below the centre
	_, y = v.project(v.toCam(vec3{100, 0, -10}))
	if y <= 180 {
		t.Fatalf("ground above centre: %.2f", y)
	}
}

func TestTriangulateConcave(t *testing.T) {
	// L-shape, clockwise to exercise the orientation fix
	pts := []vec3{{0, 0, 0}, {0, 2, 0}, {1, 2, 0}, {1, 1, 0}, {2, 1, 0}, {2, 0, 0}}
	tris := triangulate(pts)
	if len(tris) != len(pts)-2 {
		t.Fatalf("got %d triangles", len(tris))
	}
	area := 0.0
	for _, tr := range tris {
		a, b, c := pts[tr[0]], pts[tr[1]], pts[tr[2]]
		area += math.Abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)) / 2
	}
	if math.Abs(area-3) > 1e-9 {
		t.Fatalf("area %.3f, want 3", area)
	}
}

func TestOcclusionAndDetections(t *testing.T) {
	in := testScene()
	v := in.view(streamWidth, streamHeight)
	m := buildMesh(in.shapes.prisms, v)

	dets := computeDetections("cam", v, in, m)
	got := map[string]bool{}
	for _, d := range dets {
		got[d.Detection.Evidence[0]] = true
		b := d.Detection.ImageBbox
		if b.X+b.Width > streamWidth || b.Y+b.Height > streamHeight || b.Width == 0 || b.Height == 0 {
			t.Errorf("bad bbox for %s: %+v", d.Id, b)
		}
	}
	if !got["hostile"] || !got["friend"] {
		t.Errorf("visible entities missing: %v", got)
	}
	if got["hidden"] {
		t.Error("entity behind the building was detected")
	}

	in.occlude = false
	if n := len(computeDetections("cam", v, in, m)); n != 3 {
		t.Errorf("with occlusion off got %d detections, want 3", n)
	}
}

func TestCamStateMotion(t *testing.T) {
	s := &camState{rangeMax: 2000, fovWide: 60, fovTele: 8}
	s.setTarget(90, 10, 0)
	changed, moving := s.advance(0.5)
	if !changed || !moving {
		t.Fatalf("expected motion, got changed=%v moving=%v", changed, moving)
	}
	for range 10 {
		_, moving = s.advance(0.5)
	}
	if moving {
		t.Fatal("still moving after reaching the target")
	}
	if changed, _ = s.advance(0.5); changed {
		t.Fatal("idle gimbal reported a change")
	}
}

func TestFrameStoreViewers(t *testing.T) {
	fs := newFrameStore()
	if fs.hasViewers() {
		t.Fatal("new store has viewers")
	}
	fs.addViewer()
	select {
	case <-fs.joined:
	default:
		t.Fatal("joining did not signal")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go fs.put([]byte{1})
	if f, seq, err := fs.wait(ctx, 0); err != nil || seq != 1 || len(f) != 1 {
		t.Fatalf("wait: %v %d %v", f, seq, err)
	}
	fs.removeViewer()
	if fs.hasViewers() {
		t.Fatal("viewer not removed")
	}
}

func benchRenderer(b *testing.B) (*renderer, *frameInput) {
	r := newRenderer(streamWidth, streamHeight, newTileCache(syntheticTile), newAssetCache(func(string) *texture { return nil }))
	in := testScene()
	loadedTiles(b, r, in)
	b.ResetTimer()
	return r, in
}

func BenchmarkRender(b *testing.B) {
	for samples := 1; samples <= maxGroundSamples; samples++ {
		b.Run(fmt.Sprintf("ground%d", samples), func(b *testing.B) {
			r, in := benchRenderer(b)
			r.groundSamples = samples
			for i := 0; b.Loop(); i++ {
				in.pose.Pan = float64(i % 360)
				r.render(in)
			}
		})
	}
}

func TestNextQuality(t *testing.T) {
	const interval = 40 * time.Millisecond // 25 fps
	ms := func(f float64) time.Duration { return time.Duration(f * float64(time.Millisecond)) }
	for _, c := range []struct {
		name           string
		q              int
		render, encode float64
		want           int
	}{
		{"fast machine steps up", 1, 1.8, 2.7, 2},
		{"fast machine stays sharp", 2, 3.8, 2.7, 2},
		{"slow board stays fast", 1, 18, 27, 1},
		{"overloaded drops", 2, 20, 15, 1},
		{"sharp but no headroom: no flap", 1, 6, 4, 1},
	} {
		if got := nextQuality(c.q, ms(c.render), ms(c.encode), interval); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}

func TestFrameStatsTake(t *testing.T) {
	var s frameStats
	s.record(2*time.Millisecond, 4*time.Millisecond)
	s.record(4*time.Millisecond, 2*time.Millisecond)
	if n, r, e := s.take(); n != 2 || r != 3*time.Millisecond || e != 3*time.Millisecond {
		t.Fatalf("take: %d %v %v", n, r, e)
	}
	if n, _, _ := s.take(); n != 0 {
		t.Fatal("take did not reset")
	}
}

func BenchmarkRenderAndEncode(b *testing.B) {
	r, in := benchRenderer(b)
	var buf bytes.Buffer
	for i := 0; b.Loop(); i++ {
		in.pose.Pan = float64(i % 360)
		buf.Reset()
		_ = jpeg.Encode(&buf, r.render(in), &jpeg.Options{Quality: jpegQuality})
	}
}

// A config change restarts a camera without waiting for the old instance;
// its late teardown must not unregister the new instance's stream.
func TestCameraRestartKeepsStream(t *testing.T) {
	ctx := context.Background()
	const id = "restart.cam"

	releaseOld, err := claimInstance(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	oldStore := newFrameStore()
	registerFrameStore(id, oldStore)

	// the new instance must wait for the old one to finish tearing down
	claimed := make(chan func())
	go func() {
		release, _ := claimInstance(ctx, id)
		claimed <- release
	}()
	select {
	case <-claimed:
		t.Fatal("new instance started before the old one released")
	case <-time.After(20 * time.Millisecond):
	}

	// even if a successor registered first, a stale unregister is harmless
	newStore := newFrameStore()
	registerFrameStore(id, newStore)
	unregisterFrameStore(id, oldStore)
	if getFrameStore(id) != newStore {
		t.Fatal("old instance unregistered the new instance's stream")
	}

	releaseOld()
	releaseNew := <-claimed
	unregisterFrameStore(id, newStore)
	releaseNew()
	if getFrameStore(id) != nil {
		t.Fatal("stream still registered after shutdown")
	}
}

// Detections must line up with what the same frame actually shows.
func TestDetectionsMatchRenderedFrame(t *testing.T) {
	r := newRenderer(streamWidth, streamHeight, nil, newAssetCache(func(string) *texture { return nil }))
	in := testScene()
	for _, pan := range []float64{-6, 0, 5} {
		in.pose.Pan = pan
		r.render(in)
		for _, d := range computeDetections("cam", r.lastView, in, r.mesh) {
			if d.Detection.Evidence[0] != "hostile" {
				continue
			}
			// centroid of the hostile symbol's red fill, outside the HUD
			// (its live dot is red too)
			var sx, sy, n int
			for y := tapeH + 30; y < streamHeight-statusH; y++ {
				for x := 0; x < streamWidth; x++ {
					if rr, g, b := px(r, x, y); rr > 200 && g < 90 && b < 90 {
						sx, sy, n = sx+x, sy+y, n+1
					}
				}
			}
			if n == 0 {
				t.Fatalf("pan %v: hostile symbol not drawn", pan)
			}
			b := d.Detection.ImageBbox
			cx, cy := float64(b.X)+float64(b.Width)/2, float64(b.Y)+float64(b.Height)/2
			if math.Abs(cx-float64(sx)/float64(n)) > 2 || math.Abs(cy-float64(sy)/float64(n)) > 2 {
				t.Errorf("pan %v: box centre %.1f,%.1f vs symbol %.1f,%.1f", pan, cx, cy,
					float64(sx)/float64(n), float64(sy)/float64(n))
			}
		}
	}
}

type fakeWorld struct {
	pb.WorldServiceClient
	pushed  [][]string
	expired []string
}

func (f *fakeWorld) Push(_ context.Context, req *pb.EntityChangeRequest, _ ...grpc.CallOption) (*pb.EntityChangeResponse, error) {
	var ids []string
	for _, e := range req.Changes {
		ids = append(ids, e.Id)
	}
	f.pushed = append(f.pushed, ids)
	return &pb.EntityChangeResponse{}, nil
}

func (f *fakeWorld) ExpireEntity(_ context.Context, req *pb.ExpireEntityRequest, _ ...grpc.CallOption) (*pb.ExpireEntityResponse, error) {
	f.expired = append(f.expired, req.Id)
	return &pb.ExpireEntityResponse{}, nil
}

func TestDetectionPublisherSkipsUnchanged(t *testing.T) {
	fw := &fakeWorld{}
	d := &detectionPublisher{cam: &camera{logger: slog.Default()}, client: fw}
	det := func(id string, x uint32) *pb.Entity {
		return &pb.Entity{Id: id, Detection: &pb.DetectionComponent{ImageBbox: &pb.ImageBoundingBox{X: x, Width: 10, Height: 10}}}
	}
	ctx := context.Background()
	d.publish(ctx, []*pb.Entity{det("a", 1), det("b", 1)})
	d.publish(ctx, []*pb.Entity{det("a", 1), det("b", 2)}) // only b moved
	d.publish(ctx, []*pb.Entity{det("a", 1), det("b", 2)}) // nothing changed
	d.publish(ctx, []*pb.Entity{det("a", 1)})              // b left view

	if len(fw.pushed) != 2 || len(fw.pushed[0]) != 2 || len(fw.pushed[1]) != 1 || fw.pushed[1][0] != "b" {
		t.Fatalf("pushes: %v", fw.pushed)
	}
	if len(fw.expired) != 1 || fw.expired[0] != "b" {
		t.Fatalf("expired: %v", fw.expired)
	}
}

// Each MJPEG part must be complete (next boundary sent) as soon as its frame
// is published, not when the following frame arrives: browsers display a
// part only once the next part's headers are in.
func TestMJPEGFrameCompleteWithoutSuccessor(t *testing.T) {
	const id = "mjpeg.cam"
	mux := http.NewServeMux()
	mux.HandleFunc("GET /cam/{id}", handleMJPEG)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// stopping the store releases the handler, so srv.Close cannot hang
	fs := newFrameStore()
	registerFrameStore(id, fs)
	defer unregisterFrameStore(id, fs)

	resp, err := http.Get(srv.URL + "/cam/" + id)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, params, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	mr := multipart.NewReader(resp.Body, params["boundary"])

	for _, frame := range [][]byte{[]byte("first-frame"), []byte("second-frame")} {
		fs.put(frame)
		got := make(chan []byte, 1)
		go func() {
			part, err := mr.NextPart()
			if err != nil {
				got <- nil
				return
			}
			b, _ := io.ReadAll(part)
			got <- b
		}()
		select {
		case b := <-got:
			if !bytes.Equal(b, frame) {
				t.Fatalf("got part %q, want %q", b, frame)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("part %q not complete until a later frame arrives", frame)
		}
	}
}

// A missing tile also requests its coarse ancestor, which then serves as an
// immediate (blurry) fallback.
func TestTileCoarseFallback(t *testing.T) {
	var mu sync.Mutex
	fetched := map[tileKey]bool{}
	tc := newTileCache(func(k tileKey) *tile {
		mu.Lock()
		fetched[k] = true
		mu.Unlock()
		if k.z == 19 {
			return nil // the sharp tile is unavailable
		}
		return syntheticTile(k)
	})
	k := tileKey{19, 270000, 172000}
	coarse := tileKey{19 - coarseLead, k.x >> coarseLead, k.y >> coarseLead}
	tc.resolve(k)

	deadline := time.Now().Add(5 * time.Second)
	for {
		if tile, shift := tc.resolve(k); tile != nil {
			if shift != coarseLead {
				t.Fatalf("fallback shift %d, want %d", shift, coarseLead)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("no coarse fallback arrived")
		}
		time.Sleep(5 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if !fetched[k] || !fetched[coarse] {
		t.Fatalf("expected both the tile and its ancestor to be fetched: %v", fetched)
	}
}

// On-screen size must follow true perspective: twice as far, half as big,
// at any distance (no clamping).
func TestObjectSizeFollowsDistance(t *testing.T) {
	v := newView(anchorLatitude, anchorLongitude, 12, 0, 0, 60, streamWidth, streamHeight)
	at := func(north float64) placement {
		la, lo := offset(anchorLatitude, anchorLongitude, 0, north)
		pl, ok := v.place(&cachedEntity{id: "x", lat: la, lon: lo, alt: 12, widthM: 4, heightM: 2})
		if !ok {
			t.Fatalf("not placed at %vm", north)
		}
		return pl
	}
	for _, d := range []float64{20, 100, 400} {
		near, far := at(d), at(2*d)
		if r := near.pw / far.pw; math.Abs(r-2) > 0.02 {
			t.Errorf("width ratio at %vm vs %vm = %.3f, want 2", d, 2*d, r)
		}
		if r := near.ph / far.ph; math.Abs(r-2) > 0.02 {
			t.Errorf("height ratio at %vm vs %vm = %.3f, want 2", d, 2*d, r)
		}
	}
}
