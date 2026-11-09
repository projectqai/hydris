// Package attitude converts between heading/pitch/roll and the
// OrientationComponent quaternion.
//
// The quaternion rotates the local ENU frame (x east, y north, z up), as the
// docs specify. At identity a body faces north (forward = +y) with its right
// side to the east (+x). A heading is a compass bearing, clockwise from
// north, which is a negative rotation about up: heading 030 is
// z = sin(-15°), not sin(15°). Attitude composes as yaw ⊗ pitch ⊗ roll, with
// pitch positive nose up (about +x) and roll positive right wing down (about
// +y), so aviation and MAVLink angles map across directly.
package attitude

import (
	"math"

	pb "github.com/projectqai/proto/go"
)

// FromHeadingPitchRoll returns the orientation for a heading (compass
// bearing), pitch and roll, all in radians.
func FromHeadingPitchRoll(heading, pitch, roll float64) *pb.Quaternion {
	sy, cy := math.Sincos(-heading / 2)
	sp, cp := math.Sincos(pitch / 2)
	sr, cr := math.Sincos(roll / 2)
	// (0,0,sy,cy) ⊗ (sp,0,0,cp) ⊗ (0,sr,0,cr)
	return &pb.Quaternion{
		X: cy*sp*cr - sy*cp*sr,
		Y: cy*cp*sr + sy*sp*cr,
		Z: sy*cp*cr + cy*sp*sr,
		W: cy*cp*cr - sy*sp*sr,
	}
}

// FromHeading returns a level orientation facing a compass bearing (radians).
func FromHeading(heading float64) *pb.Quaternion {
	return FromHeadingPitchRoll(heading, 0, 0)
}

// Heading returns the compass bearing (radians, [0, 2π)) the body's forward
// axis points to. It stays exact under pitch and roll.
func Heading(q *pb.Quaternion) float64 {
	// forward axis (0,1,0) rotated by q, projected onto east/north
	east := 2 * (q.X*q.Y - q.W*q.Z)
	north := 1 - 2*(q.X*q.X+q.Z*q.Z)
	h := math.Atan2(east, north)
	if h < 0 {
		h += 2 * math.Pi
	}
	return h
}
