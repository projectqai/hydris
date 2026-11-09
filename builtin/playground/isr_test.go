package playground

import (
	"math"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
)

// A tasked transit must fly like a fixed wing: bank and roll rate stay
// within limits the whole way, and it settles into the new orbit.
func TestFixedWingTransitToOrbit(t *testing.T) {
	const dt, radius, alt, speed = 0.05, 600.0, 250.0, 25.0
	fw := newOrbiting(isrHomeLat, isrHomeLon, radius, alt, speed)
	// a destination 4 km to the south-west, behind the current heading
	dLat, dLon := enuOffset(isrHomeLat, isrHomeLon, -2800, -2800)

	maxBank, maxRollRate := 0.0, 0.0
	prevBank := fw.bank
	for i := 0; i < int(600/dt); i++ {
		fw.step(dt, dLat, dLon, radius, alt)
		maxBank = math.Max(maxBank, math.Abs(fw.bank))
		maxRollRate = math.Max(maxRollRate, math.Abs(fw.bank-prevBank)/dt)
		prevBank = fw.bank
	}
	if maxBank > maxBankRad+1e-9 {
		t.Errorf("bank %.1f° exceeds limit", maxBank*180/math.Pi)
	}
	if maxRollRate > maxBankRateRad+1e-6 {
		t.Errorf("roll rate %.1f°/s exceeds limit", maxRollRate*180/math.Pi)
	}
	e, n := enuDelta(dLat, dLon, fw.lat, fw.lon)
	if d := math.Hypot(e, n); math.Abs(d-radius) > 0.05*radius {
		t.Errorf("not established in orbit: %.0f m from centre, want %.0f", d, radius)
	}
}

func TestFixedWingHoldsOrbit(t *testing.T) {
	const dt, radius = 0.05, 600.0
	fw := newOrbiting(isrHomeLat, isrHomeLon, radius, 250, 25)
	for i := 0; i < int(300/dt); i++ {
		fw.step(dt, isrHomeLat, isrHomeLon, radius, 250)
		e, n := enuDelta(isrHomeLat, isrHomeLon, fw.lat, fw.lon)
		if d := math.Hypot(e, n); math.Abs(d-radius) > 10 {
			t.Fatalf("t=%.0fs: drifted to %.1f m from centre", float64(i)*dt, d)
		}
	}
}

// The stabilised mount must leave the camera with only the drone's heading.
func TestGimbalStabilisation(t *testing.T) {
	fw := &fixedWing{heading: 1.1, pitch: 0.08, bank: -0.45}
	cam := fw.attitude().mul(fw.gimbalStabilisation())
	want := yawQuat(fw.heading)
	if math.Abs(math.Abs(cam.x*want.x+cam.y*want.y+cam.z*want.z+cam.w*want.w)-1) > 1e-9 {
		t.Fatalf("camera attitude %+v is not pure yaw %+v", cam, want)
	}
}

func TestGridTargetsDeterministic(t *testing.T) {
	k := cellOf(isrHomeLat, isrHomeLon)
	a, b := cellTargets("p", k), cellTargets("p", k)
	if len(a) != len(b) {
		t.Fatal("cell target count differs between calls")
	}
	unix := float64(time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC).Unix())
	for i := range a {
		la, lo, _, _ := a[i].at(unix)
		lb, lb2, _, _ := b[i].at(unix)
		if a[i].id != b[i].id || a[i].label != b[i].label || la != lb || lo != lb2 {
			t.Fatalf("target %d differs: %+v vs %+v", i, a[i], b[i])
		}
	}

	// across many cells: about 0.75 targets per cell, each inside its cell
	total, cells := 0, cellsNear(isrHomeLat, isrHomeLon, 3000)
	for _, c := range cells {
		cLat, cLon := cellCentre(c)
		for _, tg := range cellTargets("p", c) {
			total++
			if e, n := enuDelta(cLat, cLon, tg.lat, tg.lon); math.Abs(e) > targetCellM/2 || math.Abs(n) > targetCellM/2 {
				t.Errorf("target %s anchored outside its cell", tg.id)
			}
		}
	}
	if perCell := float64(total) / float64(len(cells)); perCell < 0.6 || perCell > 0.9 {
		t.Errorf("unexpected density: %.2f targets per cell", perCell)
	}
}

func TestTargetFieldSpawnsAndExpires(t *testing.T) {
	f := newTargetField("p")
	now := time.Now()
	push, expire := f.update(now, isrHomeLat, isrHomeLon)
	if len(push) == 0 || len(expire) != 0 {
		t.Fatalf("first update: %d pushed, %d expired", len(push), len(expire))
	}
	// moving 5 km away drops everything previously published
	farLat, farLon := enuOffset(isrHomeLat, isrHomeLon, 5000, 0)
	_, expire = f.update(now.Add(time.Second), farLat, farLon)
	if len(expire) != len(push) {
		t.Fatalf("expired %d of %d targets", len(expire), len(push))
	}
}

// Centred sticks fly straight and level; full stick turns within the limits.
func TestManualFlight(t *testing.T) {
	const dt = 0.05
	fw := newOrbiting(isrHomeLat, isrHomeLon, 600, 250, 25)
	for i := 0; i < int(20/dt); i++ {
		fw.stepManual(dt, 0, 0, 0, isrLimits)
	}
	if math.Abs(fw.bank) > 1e-3 || math.Abs(fw.turnRate) > 1e-3 {
		t.Errorf("centred sticks should level out: bank %.2f°", fw.bank*180/math.Pi)
	}
	heading, alt := fw.heading, fw.alt
	for i := 0; i < int(10/dt); i++ {
		fw.stepManual(dt, 0, 0, 0, isrLimits)
	}
	if math.Abs(wrapPi(fw.heading-heading)) > 1e-3 || math.Abs(fw.alt-alt) > 1e-6 {
		t.Error("centred sticks should hold course and altitude")
	}

	maxRollRate, prev := 0.0, fw.bank
	before := fw.heading
	for i := 0; i < int(5/dt); i++ {
		fw.stepManual(dt, 1, 0, 0, isrLimits)
		maxRollRate = math.Max(maxRollRate, math.Abs(fw.bank-prev)/dt)
		prev = fw.bank
	}
	if fw.bank <= 0 || fw.bank > maxBankRad+1e-9 {
		t.Errorf("bank %.1f°", fw.bank*180/math.Pi)
	}
	if maxRollRate > maxBankRateRad+1e-6 {
		t.Errorf("roll rate %.1f°/s exceeds the limit", maxRollRate*180/math.Pi)
	}
	if wrapPi(fw.heading-before) <= 0 {
		t.Error("right stick should turn right")
	}

	alt = fw.alt
	for i := 0; i < int(10/dt); i++ {
		fw.stepManual(dt, 0, 1, 0, isrLimits)
	}
	if got := fw.alt - alt; math.Abs(got-10*maxClimbRate) > 1 {
		t.Errorf("climbed %.1f m in 10 s", got)
	}
}

func TestManualFlightStaysInTheEnvelope(t *testing.T) {
	const dt = 0.05
	fw := newOrbiting(isrHomeLat, isrHomeLon, 600, 40, 25)
	for i := 0; i < int(60/dt); i++ {
		fw.stepManual(dt, 0, -1, -1, isrLimits)
	}
	if fw.alt < isrLimits.minAlt-1 {
		t.Errorf("flew into the ground: %.1f m", fw.alt)
	}
	if fw.speed != isrLimits.minSpeed {
		t.Errorf("speed %.1f m/s", fw.speed)
	}
	for i := 0; i < int(60/dt); i++ {
		fw.stepManual(dt, 0, 0, 1, isrLimits)
	}
	if fw.speed != isrLimits.maxSpeed {
		t.Errorf("speed %.1f m/s", fw.speed)
	}
}

// Leaving manual flight must not make the aircraft turn back: it carries on into
// a loiter from where it is.
func TestLeavingManualFlightFlowsIntoOrbit(t *testing.T) {
	const dt, radius = 0.05, 600.0
	fw := newOrbiting(isrHomeLat, isrHomeLon, radius, 250, 25)
	for i := 0; i < int(20/dt); i++ {
		fw.stepManual(dt, 0, 0, 0, isrLimits)
	}
	cLat, cLon := fw.orbitAhead(radius)
	e, n := enuDelta(cLat, cLon, fw.lat, fw.lon)
	if d := math.Hypot(e, n); math.Abs(d-radius) > 1 {
		t.Fatalf("the orbit should pass through the aircraft: %.1f m from centre", d)
	}
	maxTurn := 0.0
	before := fw.heading
	for i := 0; i < int(5/dt); i++ {
		fw.step(dt, cLat, cLon, radius, fw.alt)
		maxTurn = math.Max(maxTurn, math.Abs(wrapPi(fw.heading-before)))
	}
	if maxTurn > 0.6 {
		t.Errorf("turned %.0f° in the first 5 s, it should ease into the orbit", maxTurn*180/math.Pi)
	}
}

func TestManualGimbal(t *testing.T) {
	fw := newOrbiting(isrHomeLat, isrHomeLon, 600, 250, 25)
	var p manualPilot
	p.takeOver(fw, isrHomeLat, isrHomeLon)
	pan, tilt, zoom := float32(1), float32(-1), float32(1)
	rng := p.rangeM
	for i := 0; i < 400; i++ {
		p.moveGimbal(&pb.ManualControlAxes{Pan: &pan, Tilt: &tilt, Zoom: &zoom}, 0.05)
	}
	if p.elevationDeg != -89 {
		t.Errorf("elevation %.1f", p.elevationDeg)
	}
	if p.rangeM >= rng || p.rangeM != manualMinZoomRangeM {
		t.Errorf("range %.1f", p.rangeM)
	}
	aim, lat, lon := p.aim("cam", fw)
	if aim.Id != "cam~fp" {
		t.Errorf("aim id %s", aim.Id)
	}
	e, n := enuDelta(fw.lat, fw.lon, lat, lon)
	if math.Hypot(e, n) > 10 {
		t.Errorf("looking nearly straight down should see under the aircraft: %.1f m", math.Hypot(e, n))
	}
}

// A task takes over from the stick until the operator lets go.
func TestTaskOverridesManualUntilReleased(t *testing.T) {
	var p manualPilot
	stick := &pb.ManualControlAxes{}
	if p.command(stick) == nil {
		t.Fatal("the stick should have authority")
	}
	p.overridden = true
	if p.command(stick) != nil {
		t.Error("frames still arriving must not undo a task")
	}
	if p.command(nil) != nil || p.overridden {
		t.Error("letting go should end the override")
	}
	if p.command(stick) == nil {
		t.Error("the stick should have authority again")
	}
}
