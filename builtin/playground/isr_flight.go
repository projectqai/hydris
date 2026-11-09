package playground

import (
	"github.com/projectqai/hydris/pkg/attitude"
	"math"

	pb "github.com/projectqai/proto/go"
)

const (
	gravity = 9.81

	// fixed-wing handling
	maxBankRad     = 30 * math.Pi / 180
	maxBankRateRad = 15 * math.Pi / 180 // roll rate limit
	bankTimeConst  = 0.6                // s, how quickly bank follows the command
	headingGain    = 1.2                // turn rate commanded per radian of course error
	orbitGain      = 2.0                // how sharply the vector field converges onto the circle
	maxClimbRate   = 3.0                // m/s
	maxSpeedRate   = 5.0                // m/s², airspeed change under manual control
	angleOfAttack  = 2 * math.Pi / 180
)

// fixedWing is a coordinated-turn aircraft model: it can only change course
// by banking, bank changes at a limited rate, and turn rate follows from
// bank and airspeed. Guidance towards a loiter circle comes from a vector
// field (Beard & McLain), which flies a natural swinging arc into the orbit
// from any position and heading.
type fixedWing struct {
	lat, lon, alt float64
	speed         float64 // m/s, true airspeed (no wind, so also ground speed)
	heading       float64 // rad, compass bearing (0 north, clockwise)
	bank          float64 // rad, positive = right wing down
	bankRate      float64 // rad/s
	turnRate      float64 // rad/s, positive = clockwise
	climb         float64 // m/s
	climbAccel    float64 // m/s²
	pitch         float64 // rad, positive = nose up
}

// newOrbiting places the aircraft on the loiter circle, established in the
// clockwise orbit.
func newOrbiting(lat, lon, radius, alt, speed float64) *fixedWing {
	nLat, nLon := enuOffset(lat, lon, 0, radius) // north of centre
	turn := speed / radius
	bank := math.Atan(speed * turn / gravity)
	return &fixedWing{
		lat: nLat, lon: nLon, alt: alt, speed: speed,
		heading: math.Pi / 2, // east: clockwise tangent at the north point
		bank:    bank, turnRate: turn, pitch: angleOfAttack,
	}
}

// step advances the aircraft by dt seconds towards a clockwise orbit of the
// given radius around (cLat, cLon) at altitude alt.
func (fw *fixedWing) step(dt, cLat, cLon, radius, alt float64) {
	e, n := enuDelta(cLat, cLon, fw.lat, fw.lon)
	d := math.Hypot(e, n)
	phi := math.Atan2(e, n) // bearing from the centre to the aircraft

	// Desired course: tangent to the circle, bent inwards when outside and
	// outwards when inside; far away it points straight at the centre.
	course := phi + math.Pi/2 + math.Atan(orbitGain*(d-radius)/radius)
	courseErr := wrapPi(course - fw.heading)

	maxTurn := gravity * math.Tan(maxBankRad) / fw.speed
	turnCmd := clampF(headingGain*courseErr, -maxTurn, maxTurn)
	bankCmd := math.Atan(fw.speed * turnCmd / gravity)
	fw.fly(dt, bankCmd, clampF((alt-fw.alt)*0.2, -maxClimbRate, maxClimbRate))
}

// stepManual advances the aircraft under direct control: roll and pitch are
// stick positions commanding bank and climb rate, throttle changes airspeed.
// Centred sticks fly straight and level. The aircraft still flies like one:
// it is limited in roll rate and bank, and it cannot leave its flight envelope.
func (fw *fixedWing) stepManual(dt, roll, pitch, throttle float64, cfg isrConfigLimits) {
	fw.speed = clampF(fw.speed+clampF(throttle, -1, 1)*maxSpeedRate*dt, cfg.minSpeed, cfg.maxSpeed)
	climb := clampF(pitch, -1, 1) * maxClimbRate
	if (fw.alt <= cfg.minAlt && climb < 0) || (fw.alt >= cfg.maxAlt && climb > 0) {
		climb = 0
	}
	fw.fly(dt, clampF(roll, -1, 1)*maxBankRad, climb)
}

// fly applies a bank command and climb rate for dt seconds.
func (fw *fixedWing) fly(dt, bankCmd, climb float64) {
	fw.bankRate = clampF((bankCmd-fw.bank)/bankTimeConst, -maxBankRateRad, maxBankRateRad)
	fw.bank += fw.bankRate * dt
	fw.turnRate = gravity * math.Tan(fw.bank) / fw.speed
	fw.heading = math.Mod(fw.heading+fw.turnRate*dt+2*math.Pi, 2*math.Pi)

	fw.climbAccel = (climb - fw.climb) / dt
	fw.climb = climb
	fw.alt += fw.climb * dt
	fw.pitch = math.Atan2(fw.climb, fw.speed) + angleOfAttack

	ve, vn := fw.velocity()
	fw.lat, fw.lon = enuOffset(fw.lat, fw.lon, ve*dt, vn*dt)
}

// orbitAhead is the centre of a clockwise orbit the aircraft is already flying
// on: one radius off the right wing. Leaving manual control there means it
// carries straight on into a loiter instead of turning back.
func (fw *fixedWing) orbitAhead(radius float64) (lat, lon float64) {
	s, c := math.Sincos(fw.heading)
	return enuOffset(fw.lat, fw.lon, c*radius, -s*radius)
}

func (fw *fixedWing) velocity() (east, north float64) {
	s, c := math.Sincos(fw.heading)
	return fw.speed * s, fw.speed * c
}

// acceleration is the centripetal acceleration of the turn plus climb
// changes, in ENU.
func (fw *fixedWing) acceleration() (east, north, up float64) {
	s, c := math.Sincos(fw.heading)
	return fw.speed * fw.turnRate * c, -fw.speed * fw.turnRate * s, fw.climbAccel
}

// headingDeg is the compass heading in degrees.
func (fw *fixedWing) headingDeg() float64 { return fw.heading * 180 / math.Pi }

// -- attitude -----------------------------------------------------------------
//
// The engine's convention: identity faces north with x east (right wing),
// y north (forward), z up; yaw is about z with yaw = -bearing, pitch about
// x, roll about y. Attitude = yaw ⊗ pitch ⊗ roll.

type quat struct{ x, y, z, w float64 }

func (a quat) mul(b quat) quat {
	return quat{
		x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
		y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
		z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
		w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
	}
}

func (a quat) conj() quat { return quat{-a.x, -a.y, -a.z, a.w} }

func (a quat) proto() *pb.Quaternion { return &pb.Quaternion{X: a.x, Y: a.y, Z: a.z, W: a.w} }

func yawQuat(bearing float64) quat {
	s, c := math.Sincos(-bearing / 2)
	return quat{z: s, w: c}
}

func pitchQuat(p float64) quat {
	s, c := math.Sincos(p / 2)
	return quat{x: s, w: c}
}

func rollQuat(r float64) quat {
	s, c := math.Sincos(r / 2)
	return quat{y: s, w: c}
}

func (fw *fixedWing) attitude() quat {
	q := attitude.FromHeadingPitchRoll(fw.heading, fw.pitch, fw.bank)
	return quat{q.X, q.Y, q.Z, q.W}
}

// gimbalStabilisation is the camera mount offset that cancels the
// aircraft's pitch and roll, so the camera only inherits its heading, as a
// stabilised gimbal would.
func (fw *fixedWing) gimbalStabilisation() quat {
	return pitchQuat(fw.pitch).mul(rollQuat(fw.bank)).conj()
}

// -- local geometry -----------------------------------------------------------

const metresPerDegLat = 111320.0

// enuDelta returns the offset of (lat, lon) from (lat0, lon0) in metres.
func enuDelta(lat0, lon0, lat, lon float64) (east, north float64) {
	return (lon - lon0) * metresPerDegLat * math.Cos(lat0*math.Pi/180), (lat - lat0) * metresPerDegLat
}

// enuOffset moves (lat, lon) by east/north metres.
func enuOffset(lat, lon, east, north float64) (float64, float64) {
	return lat + north/metresPerDegLat, lon + east/(metresPerDegLat*math.Cos(lat*math.Pi/180))
}

func wrapPi(a float64) float64 {
	a = math.Mod(a+math.Pi, 2*math.Pi)
	if a < 0 {
		a += 2 * math.Pi
	}
	return a - math.Pi
}

func clampF(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
