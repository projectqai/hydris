package transform

import (
	"math"

	pb "github.com/projectqai/proto/go"
)

// PoseTransformer resolves PoseComponent into absolute GeoSpatialComponent
// and OrientationComponent by walking the parent chain. When a parent entity
// changes, all children referencing it are re-resolved.
//
// For CartesianOffset: the ENU offset is applied to the parent's geo position.
// For PolarOffset with range: azimuth/elevation/range are converted to ENU, then applied.
// For PolarOffset without range (bearing-only): no geo is produced, but BearingComponent is set.
type PoseTransformer struct {
	// byParent maps parent entity ID → child entity IDs that reference it
	byParent map[string][]string
	// childParent maps child entity ID → its current parent (reverse index)
	childParent map[string]string
	// managed tracks entity IDs whose Geo/Orientation/Bearing are engine-managed
	managed map[string]struct{}
}

func NewPoseTransformer() *PoseTransformer {
	return &PoseTransformer{
		byParent:    make(map[string][]string),
		childParent: make(map[string]string),
		managed:     make(map[string]struct{}),
	}
}

func (pt *PoseTransformer) Validate(head map[string]*pb.Entity, incoming *pb.Entity) error {
	return nil
}

func (pt *PoseTransformer) Resolve(head map[string]*pb.Entity, changedID string) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]

	// Entity expired — clean up
	if entity == nil {
		if _, ok := pt.managed[changedID]; ok {
			delete(pt.managed, changedID)
			pt.removeChild(changedID)
		}
		// If it was a parent, re-resolve all dependents
		if children, ok := pt.byParent[changedID]; ok {
			delete(pt.byParent, changedID)
			for _, childID := range children {
				delete(pt.childParent, childID)
				if child := head[childID]; child != nil {
					child.Geo = nil
					child.Orientation = nil
					child.Bearing = nil
					delete(pt.managed, childID)
				}
			}
		}
		return nil, nil
	}

	// If entity has PoseComponent, resolve it
	if entity.Pose != nil && entity.Pose.Parent != "" {
		pt.resolvePose(head, changedID, entity)
	}

	// If entity is a parent, re-resolve all dependent children and return
	// them as upserts so bus.Dirty is called and subscribers see the update.
	if children, ok := pt.byParent[changedID]; ok {
		for _, childID := range children {
			if child := head[childID]; child != nil && child.Pose != nil && child.Pose.Parent != "" {
				pt.resolvePose(head, childID, child)
				upsert = append(upsert, child)
			}
		}
	}

	return upsert, remove
}

func (pt *PoseTransformer) resolvePose(head map[string]*pb.Entity, childID string, child *pb.Entity) {
	parentID := child.Pose.Parent

	// Always register in the index so that when the parent arrives later,
	// we re-resolve this child.
	pt.removeChild(childID)
	pt.byParent[parentID] = append(pt.byParent[parentID], childID)
	pt.childParent[childID] = parentID

	parent := head[parentID]
	if parent == nil || parent.Geo == nil {
		return
	}

	parentLat := parent.Geo.Latitude
	parentLon := parent.Geo.Longitude

	// Get parent's absolute orientation quaternion
	var parentQ *pb.Quaternion
	if parent.Orientation != nil {
		parentQ = parent.Orientation.Orientation
	}

	switch offset := child.Pose.Offset.(type) {
	case *pb.PoseComponent_Cartesian:
		pt.resolveCartesian(child, offset.Cartesian, parentLat, parentLon, parent.Geo.Altitude, parentQ)
	case *pb.PoseComponent_Polar:
		pt.resolvePolar(child, offset.Polar, parentLat, parentLon, parent.Geo.Altitude, parentQ)
	default:
		// No offset — child inherits parent position directly
		child.Geo = &pb.GeoSpatialComponent{
			Latitude:  parentLat,
			Longitude: parentLon,
			Altitude:  parent.Geo.Altitude,
		}
		pt.composeOrientation(child, nil, parentQ)
	}

	pt.managed[childID] = struct{}{}
}

func (pt *PoseTransformer) resolveCartesian(child *pb.Entity, c *pb.CartesianOffset, parentLat, parentLon float64, parentAlt *float64, parentQ *pb.Quaternion) {
	// Cartesian offsets don't produce bearing — clear any stale value
	// left by a prior resolvePolar call on this entity.
	child.Bearing = nil

	east, north, up := c.EastM, c.NorthM, c.GetUpM()
	hasAlt := c.UpM != nil

	// Rotate offset by parent orientation
	if parentQ != nil {
		east, north, up = rotateByQuaternion(east, north, up, parentQ)
	}

	geo := enuToWGS84(east, north, up, hasAlt, parentLat, parentLon)
	child.Geo = &pb.GeoSpatialComponent{
		Latitude:   geo.Latitude,
		Longitude:  geo.Longitude,
		Covariance: c.Covariance,
	}
	if hasAlt && parentAlt != nil {
		alt := *parentAlt + up
		child.Geo.Altitude = &alt
	} else if parentAlt != nil && hasAlt {
		alt := *parentAlt + up
		child.Geo.Altitude = &alt
	}

	// Compose orientation: parent orientation * child offset orientation
	pt.composeOrientation(child, c.Orientation, parentQ)
}

func (pt *PoseTransformer) resolvePolar(child *pb.Entity, p *pb.PolarOffset, parentLat, parentLon float64, parentAlt *float64, parentQ *pb.Quaternion) {
	azRad := p.Azimuth * math.Pi / 180.0
	elRad := p.GetElevation() * math.Pi / 180.0

	// Compute absolute bearing by composing parent orientation + polar azimuth/elevation
	absAz := p.Azimuth
	absEl := p.GetElevation()
	if parentQ != nil {
		// Extract parent yaw from quaternion and add to azimuth
		parentYaw := quaternionToYaw(parentQ)
		absAz = math.Mod(absAz+parentYaw+360, 360)
	}

	// Always set bearing for polar offsets
	azVal := absAz
	child.Bearing = &pb.BearingComponent{
		Azimuth: &azVal,
	}
	if p.Elevation != nil {
		child.Bearing.Elevation = &absEl
	}

	// Build the child's orientation by composing:
	//   parent orientation → polar azimuth (yaw) → polar elevation (pitch) → explicit offset orientation
	// This ensures OrientationComponent reflects the polar direction,
	// which ShapeTransformer needs to orient coverage wedges.
	polarQ := composeQuaternions(yawToQuaternion(p.Azimuth), pitchToQuaternion(p.GetElevation()))
	combinedParentQ := composeQuaternions(parentQ, polarQ)
	pt.composeOrientation(child, p.Orientation, combinedParentQ)

	// Only produce geo if range is set
	if p.Range == nil {
		child.Geo = nil
		pt.managed[child.Id] = struct{}{}
		return
	}

	rng := *p.Range
	// Convert spherical to ENU
	horizontalDist := rng * math.Cos(elRad)
	east := horizontalDist * math.Sin(azRad)
	north := horizontalDist * math.Cos(azRad)
	up := rng * math.Sin(elRad)

	// Rotate by parent orientation
	if parentQ != nil {
		east, north, up = rotateByQuaternion(east, north, up, parentQ)
	}

	hasAlt := p.Elevation != nil
	geo := enuToWGS84(east, north, up, hasAlt, parentLat, parentLon)
	child.Geo = &pb.GeoSpatialComponent{
		Latitude:  geo.Latitude,
		Longitude: geo.Longitude,
	}
	if hasAlt && parentAlt != nil {
		alt := *parentAlt + up
		child.Geo.Altitude = &alt
	}

	// Propagate polar error fields to geo covariance via Jacobian transform.
	// Build covariance from the normalised error fields (azimuth_error_deg, range_error_m).
	if p.AzimuthErrorDeg != nil || p.RangeErrorM != nil {
		cov := &pb.CovarianceMatrix{}
		if p.AzimuthErrorDeg != nil {
			v := *p.AzimuthErrorDeg * *p.AzimuthErrorDeg
			cov.Mxx = &v
		}
		if p.RangeErrorM != nil {
			v := *p.RangeErrorM * *p.RangeErrorM
			cov.Mzz = &v
		}
		child.Geo.Covariance = polarCovToENU(azRad, rng, cov)
	}
}

// composeOrientation sets the child's absolute OrientationComponent by composing
// the parent quaternion with the offset quaternion (if any).
func (pt *PoseTransformer) composeOrientation(child *pb.Entity, offsetQ *pb.Quaternion, parentQ *pb.Quaternion) {
	var q *pb.Quaternion
	switch {
	case parentQ != nil && offsetQ != nil:
		q = multiplyQuaternions(parentQ, offsetQ)
	case parentQ != nil:
		q = parentQ
	case offsetQ != nil:
		q = offsetQ
	default:
		child.Orientation = nil
		return
	}
	child.Orientation = &pb.OrientationComponent{Orientation: q}
}

// quaternionToYaw extracts the yaw angle (rotation around Z/up axis) from a
// quaternion, returned as degrees clockwise from north [0, 360).
func quaternionToYaw(q *pb.Quaternion) float64 {
	// Yaw from quaternion: atan2(2*(w*z + x*y), 1 - 2*(y*y + z*z))
	// This gives mathematical angle (CCW from east). We need CW from north.
	siny := 2 * (q.W*q.Z + q.X*q.Y)
	cosy := 1 - 2*(q.Y*q.Y+q.Z*q.Z)
	yawRad := math.Atan2(siny, cosy)
	// Convert from math angle (CCW) to bearing (CW from north)
	bearingDeg := -yawRad * 180.0 / math.Pi
	return math.Mod(bearingDeg+360, 360)
}

// yawToQuaternion converts a bearing (degrees clockwise from north) to a
// rotation quaternion around the Z/up axis.
func yawToQuaternion(bearingDeg float64) *pb.Quaternion {
	// Bearing is CW from north → negate for math convention (CCW)
	yaw := -bearingDeg * math.Pi / 180.0
	return &pb.Quaternion{
		X: 0,
		Y: 0,
		Z: math.Sin(yaw / 2),
		W: math.Cos(yaw / 2),
	}
}

// pitchToQuaternion converts an elevation angle (degrees, positive = up) to a
// rotation quaternion around the X/east axis (pitch).
func pitchToQuaternion(elevDeg float64) *pb.Quaternion {
	pitch := elevDeg * math.Pi / 180.0
	return &pb.Quaternion{
		X: math.Sin(pitch / 2),
		Y: 0,
		Z: 0,
		W: math.Cos(pitch / 2),
	}
}

// composeQuaternions returns the composition of two optional quaternions.
// Returns nil if both are nil.
func composeQuaternions(a, b *pb.Quaternion) *pb.Quaternion {
	switch {
	case a != nil && b != nil:
		return multiplyQuaternions(a, b)
	case a != nil:
		return a
	case b != nil:
		return b
	default:
		return nil
	}
}

// polarCovToENU converts a PolarOffset covariance matrix to an ENU position
// covariance via the Jacobian of the polar→ENU transform.
// azRad is the azimuth in radians, rng is the range in meters.
// Input covariance: mxx = azimuth variance (deg²), mzz = range variance (m²).
// Output: 2×2 ENU position covariance (mxx, mxy, myy in m²).
func polarCovToENU(azRad, rng float64, cov *pb.CovarianceMatrix) *pb.CovarianceMatrix {
	azVar := cov.GetMxx() // azimuth variance in deg²
	rVar := cov.GetMzz()  // range variance in m²
	if azVar <= 0 && rVar <= 0 {
		return nil
	}

	// Jacobian of [east, north] w.r.t. [azimuth_rad, range]:
	//   dE/daz_rad = range * cos(az)    dE/dr = sin(az)
	//   dN/daz_rad = -range * sin(az)   dN/dr = cos(az)
	// Since azVar is in deg², convert: σ²_rad = σ²_deg * (π/180)²
	deg2rad2 := (math.Pi / 180.0) * (math.Pi / 180.0)
	azVarRad := azVar * deg2rad2

	sinAz := math.Sin(azRad)
	cosAz := math.Cos(azRad)

	dEdAz := rng * cosAz
	dNdAz := -rng * sinAz
	dEdR := sinAz
	dNdR := cosAz

	// P_enu = J · diag(azVarRad, rVar) · Jᵀ
	mxx := dEdAz*dEdAz*azVarRad + dEdR*dEdR*rVar
	mxy := dEdAz*dNdAz*azVarRad + dEdR*dNdR*rVar
	myy := dNdAz*dNdAz*azVarRad + dNdR*dNdR*rVar

	return &pb.CovarianceMatrix{
		Mxx: &mxx,
		Mxy: &mxy,
		Myy: &myy,
	}
}

// removeChild removes childID from its current parent's children list.
func (pt *PoseTransformer) removeChild(childID string) {
	parentID, ok := pt.childParent[childID]
	if !ok {
		return
	}
	delete(pt.childParent, childID)
	children := pt.byParent[parentID]
	for i, c := range children {
		if c == childID {
			pt.byParent[parentID] = append(children[:i], children[i+1:]...)
			break
		}
	}
	if len(pt.byParent[parentID]) == 0 {
		delete(pt.byParent, parentID)
	}
}
