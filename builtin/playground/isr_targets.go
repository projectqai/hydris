package playground

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"time"

	"github.com/projectqai/hydris/builtin/artifacts"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Ground targets are generated from a global grid: every cell hashes to the
// same vehicles and people, so wherever the drone looks, the same targets
// are at the same places, and moving ones follow paths driven by wall-clock
// time, so they agree across restarts too.
//
// They are ground truth for the camera only: no symbol or classification
// (the map derives a symbol from either), so the map does not draw them.
// simcam renders them from their sprite.

const (
	targetCellM = 200.0
	// targets are published for cells around the point the camera is
	// looking at
	targetRadiusM    = 700.0
	targetSeed       = 0x15a5eed
	targetLifetime   = 10 * time.Second
	targetRefreshAll = 3 * time.Second // stationary targets: lifetime refresh
)

type isrTargetKind int

const (
	isrVehicle isrTargetKind = iota
	isrPerson
)

var carColors = []string{"red", "white", "blue", "green", "black", "silver"}

type cellKey struct{ ix, iy int64 }

// groundTarget moves back and forth along a straight segment from its
// anchor, or stands still when speed is 0.
type groundTarget struct {
	id, label string
	kind      isrTargetKind
	sprite    string
	lat, lon  float64 // anchor
	bearing   float64 // rad, direction of travel from the anchor
	length    float64 // m
	speed     float64 // m/s
	phase     float64 // m along the out-and-back loop at t=0
}

func splitmix(x uint64) uint64 {
	x += 0x9e3779b97f4a7c15
	x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9
	x = (x ^ (x >> 27)) * 0x94d049bb133111eb
	return x ^ (x >> 31)
}

// rng is a tiny deterministic stream seeded from a cell.
type rng uint64

func (r *rng) next() uint64                 { *r = rng(splitmix(uint64(*r))); return uint64(*r) }
func (r *rng) float() float64               { return float64(r.next()>>11) / (1 << 53) }
func (r *rng) between(a, b float64) float64 { return a + (b-a)*r.float() }

// cellOf returns the grid cell containing a position. Cells are
// targetCellM square, with the longitude step following the cell row.
func cellOf(lat, lon float64) cellKey {
	dLat := targetCellM / metresPerDegLat
	iy := int64(math.Floor(lat / dLat))
	return cellKey{iy: iy, ix: int64(math.Floor(lon / cellLonStep(iy)))}
}

func cellLonStep(iy int64) float64 {
	dLat := targetCellM / metresPerDegLat
	return targetCellM / (metresPerDegLat * math.Cos((float64(iy)+0.5)*dLat*math.Pi/180))
}

func cellCentre(k cellKey) (lat, lon float64) {
	dLat := targetCellM / metresPerDegLat
	return (float64(k.iy) + 0.5) * dLat, (float64(k.ix) + 0.5) * cellLonStep(k.iy)
}

// cellsNear returns the cells whose centre lies within radius (plus half a
// cell) of a point.
func cellsNear(lat, lon, radius float64) []cellKey {
	var out []cellKey
	c := cellOf(lat, lon)
	span := int64(math.Ceil(radius/targetCellM)) + 1
	for dy := -span; dy <= span; dy++ {
		for dx := -span; dx <= span; dx++ {
			k := cellKey{ix: c.ix + dx, iy: c.iy + dy}
			cl, co := cellCentre(k)
			if e, n := enuDelta(lat, lon, cl, co); math.Hypot(e, n) <= radius+targetCellM/2 {
				out = append(out, k)
			}
		}
	}
	return out
}

// cellTargets returns the targets living in a cell: none, one or two, a mix
// of vehicles and people, some parked or standing.
func cellTargets(parent string, k cellKey) []*groundTarget {
	r := rng(splitmix(uint64(k.iy)*0x9e3779b97f4a7c15 ^ uint64(k.ix) ^ targetSeed))
	n := 0
	switch p := r.float(); {
	case p < 0.20:
		n = 2
	case p < 0.55:
		n = 1
	}
	cLat, cLon := cellCentre(k)
	out := make([]*groundTarget, 0, n)
	for i := range n {
		t := &groundTarget{}
		tag := uint16(r.next())
		t.lat, t.lon = enuOffset(cLat, cLon, r.between(-0.45, 0.45)*targetCellM, r.between(-0.45, 0.45)*targetCellM)
		t.bearing = r.between(0, 2*math.Pi)
		moving := r.float() < 0.55
		if r.float() < 0.6 {
			t.kind = isrVehicle
			t.label = fmt.Sprintf("Vehicle %04X", tag)
			t.sprite = parent + ".sprite.car." + carColors[r.next()%uint64(len(carColors))]
			t.length = r.between(80, 220)
			if moving {
				t.speed = r.between(6, 14)
			}
		} else {
			t.kind = isrPerson
			t.label = fmt.Sprintf("Person %04X", tag)
			t.sprite = parent + ".sprite.person"
			t.length = r.between(20, 60)
			if moving {
				t.speed = r.between(1.0, 1.6)
			}
		}
		t.phase = r.between(0, 2*t.length)
		t.id = fmt.Sprintf("%s.target.%d_%d_%d", parent, k.iy, k.ix, i)
		out = append(out, t)
	}
	return out
}

// at returns the position and ENU velocity at unix time t (seconds).
func (t *groundTarget) at(unix float64) (lat, lon, ve, vn float64) {
	if t.speed == 0 {
		return t.lat, t.lon, 0, 0
	}
	s := math.Mod(t.phase+t.speed*unix, 2*t.length)
	along, dir := s, 1.0
	if s > t.length { // driving back
		along, dir = 2*t.length-s, -1
	}
	se, ce := math.Sincos(t.bearing)
	lat, lon = enuOffset(t.lat, t.lon, se*along, ce*along)
	return lat, lon, dir * se * t.speed, dir * ce * t.speed
}

func (t *groundTarget) entity(now time.Time) *pb.Entity {
	lat, lon, ve, vn := t.at(float64(now.UnixNano()) / 1e9)
	w, h := float32(4.5), float32(1.6)
	if t.kind == isrPerson {
		w, h = 0.6, 1.8
	}
	return &pb.Entity{
		Id:         t.id,
		Label:      proto.String(t.label),
		Controller: &pb.Controller{Id: proto.String(controllerName)},
		Geo:        &pb.GeoSpatialComponent{Latitude: lat, Longitude: lon, Altitude: proto.Float64(0)},
		Kinematics: &pb.KinematicsComponent{VelocityEnu: &pb.KinematicsEnu{
			East: proto.Float64(ve), North: proto.Float64(vn), Up: proto.Float64(0),
		}},
		Administrative: &pb.AdministrativeComponent{
			WidthM: proto.Float32(w), HeightM: proto.Float32(h),
			Images: []string{t.sprite},
		},
		Lifetime: &pb.Lifetime{Until: timestamppb.New(now.Add(targetLifetime))},
	}
}

// targetField tracks which grid targets are published.
type targetField struct {
	parent      string
	active      map[cellKey][]*groundTarget
	lastRefresh time.Time
}

func newTargetField(parent string) *targetField {
	return &targetField{parent: parent, active: make(map[cellKey][]*groundTarget)}
}

// update publishes the targets around (lat, lon): new cells are spawned,
// cells left behind expire, moving targets are pushed every call and
// stationary ones refreshed every targetRefreshAll.
func (f *targetField) update(now time.Time, lat, lon float64) (push []*pb.Entity, expire []string) {
	want := make(map[cellKey]bool)
	for _, k := range cellsNear(lat, lon, targetRadiusM) {
		want[k] = true
	}
	for k, ts := range f.active {
		if !want[k] {
			for _, t := range ts {
				expire = append(expire, t.id)
			}
			delete(f.active, k)
		}
	}
	refresh := now.Sub(f.lastRefresh) >= targetRefreshAll
	if refresh {
		f.lastRefresh = now
	}
	for k := range want {
		ts, ok := f.active[k]
		if !ok {
			ts = cellTargets(f.parent, k)
			f.active[k] = ts
		}
		for _, t := range ts {
			if !ok || refresh || t.speed > 0 {
				push = append(push, t.entity(now))
			}
		}
	}
	return push, expire
}

func (f *targetField) ids() []string {
	var out []string
	for _, ts := range f.active {
		for _, t := range ts {
			out = append(out, t.id)
		}
	}
	return out
}

// -- sprites ------------------------------------------------------------------

func isrSprites() map[string]image.Image {
	out := map[string]image.Image{"person": personSprite()}
	for name, c := range map[string]color.RGBA{
		"red":    {180, 40, 36, 255},
		"white":  {226, 228, 230, 255},
		"blue":   {40, 70, 150, 255},
		"green":  {60, 100, 60, 255},
		"black":  {30, 32, 36, 255},
		"silver": {160, 165, 170, 255},
	} {
		out["car."+name] = carSprite(c)
	}
	return out
}

func spriteRect(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA) {
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			img.SetRGBA(x, y, c)
		}
	}
}

func spriteCircle(img *image.RGBA, cx, cy, r float64, c color.RGBA) {
	for y := int(cy - r); y <= int(cy+r); y++ {
		for x := int(cx - r); x <= int(cx+r); x++ {
			if dx, dy := float64(x)+0.5-cx, float64(y)+0.5-cy; dx*dx+dy*dy <= r*r {
				img.SetRGBA(x, y, c)
			}
		}
	}
}

func darker(c color.RGBA, k float64) color.RGBA {
	return color.RGBA{uint8(float64(c.R) * k), uint8(float64(c.G) * k), uint8(float64(c.B) * k), 255}
}

// carSprite is a 90x32 px side view (4.5 m x 1.6 m).
func carSprite(body color.RGBA) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 90, 32))
	glass := color.RGBA{50, 60, 70, 255}
	spriteRect(img, 22, 4, 66, 16, darker(body, 0.85)) // cabin
	spriteRect(img, 26, 6, 43, 15, glass)              // windows
	spriteRect(img, 46, 6, 62, 15, glass)
	spriteRect(img, 3, 14, 87, 26, body)
	spriteRect(img, 3, 22, 87, 26, darker(body, 0.7))
	spriteRect(img, 84, 16, 87, 19, color.RGBA{250, 230, 160, 255}) // headlight
	spriteCircle(img, 20, 26, 5.5, color.RGBA{20, 20, 20, 255})     // wheels
	spriteCircle(img, 70, 26, 5.5, color.RGBA{20, 20, 20, 255})
	return img
}

// personSprite is a 20x60 px figure (0.6 m x 1.8 m).
func personSprite() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 20, 60))
	jacket := color.RGBA{70, 80, 60, 255}
	trousers := color.RGBA{40, 40, 50, 255}
	spriteCircle(img, 10, 6, 5, color.RGBA{220, 180, 150, 255})
	spriteRect(img, 4, 12, 16, 34, jacket)
	spriteRect(img, 1, 13, 4, 30, jacket) // arms
	spriteRect(img, 16, 13, 19, 30, jacket)
	spriteRect(img, 5, 34, 9, 58, trousers) // legs
	spriteRect(img, 11, 34, 15, 58, trousers)
	return img
}

// uploadISRSprites stores the sprites as artifacts and returns their ids.
func uploadISRSprites(ctx context.Context, client pb.WorldServiceClient, parent string) ([]string, error) {
	store := artifacts.Server
	if store == nil {
		return nil, fmt.Errorf("artifact store unavailable")
	}
	var entities []*pb.Entity
	var ids []string
	for name, img := range isrSprites() {
		id := parent + ".sprite." + name
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			return nil, err
		}
		if err := store.Local().Put(ctx, id, bytes.NewReader(buf.Bytes())); err != nil {
			return nil, fmt.Errorf("put %s: %w", id, err)
		}
		ids = append(ids, id)
		entities = append(entities, &pb.Entity{
			Id:       id,
			Label:    proto.String(name),
			Routing:  &pb.Routing{Channels: []*pb.Channel{{}}},
			Artifact: &pb.ArtifactComponent{Id: id, ContentType: "image/png"},
		})
	}
	_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: entities})
	return ids, err
}
