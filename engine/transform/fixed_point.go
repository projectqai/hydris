package transform

import (
	"github.com/projectqai/hydris/engine/meta"
	pb "github.com/projectqai/proto/go"
)

// FixedPointTransformer fills the standard fields from their fixed-point
// forms (latitude_e7, azimuth_cdeg, battery_charge_percent, confidence_percent,
// ...). A standard field that is already set is left as it is.
//
// Must run before PolarNormalizeTransformer so the centidegree errors are
// already expanded when the covariance is derived from them.
type FixedPointTransformer struct{}

func NewFixedPointTransformer() *FixedPointTransformer {
	return &FixedPointTransformer{}
}

func (t *FixedPointTransformer) Name() string { return "fixed_point" }

func (t *FixedPointTransformer) Validate(_ map[string]*pb.Entity, _ *pb.Entity) error {
	return nil
}

func (t *FixedPointTransformer) Reindex(_ map[string]*pb.Entity, _ string) {}

func (t *FixedPointTransformer) Resolve(head map[string]*pb.Entity, changedID string, _ map[int32]meta.Component) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]
	if entity == nil {
		return nil, nil
	}
	fixedGeo(entity.Geo)
	fixedPolar(entity.GetPose().GetPolar())
	fixedPower(entity.Power)
	for _, tax := range entity.GetClassification().GetTaxonomy() {
		fixedConfidence(tax.Confidence)
	}
	return nil, nil
}

func fixedGeo(g *pb.GeoSpatialComponent) {
	if g == nil {
		return
	}
	// latitude and longitude have no presence, so 0 counts as unset; each is
	// filled independently so a partially populated fix still comes through.
	if g.LatitudeE7 != nil && g.Latitude == 0 {
		g.Latitude = float64(*g.LatitudeE7) / 1e7
	}
	if g.LongitudeE7 != nil && g.Longitude == 0 {
		g.Longitude = float64(*g.LongitudeE7) / 1e7
	}
	if g.AltitudeCm != nil && g.Altitude == nil {
		v := float64(*g.AltitudeCm) / 100
		g.Altitude = &v
	}
}

func fixedPolar(p *pb.PolarOffset) {
	if p == nil {
		return
	}
	// azimuth has no presence, so 0 counts as unset.
	if p.AzimuthCdeg != nil && p.Azimuth == 0 {
		p.Azimuth = float64(*p.AzimuthCdeg) / 100
	}
	if p.AzimuthErrorCdeg != nil && p.AzimuthErrorDeg == nil {
		v := float64(*p.AzimuthErrorCdeg) / 100
		p.AzimuthErrorDeg = &v
	}
}

func fixedPower(p *pb.PowerComponent) {
	if p == nil || p.BatteryChargePercent == nil || p.BatteryChargeRemaining != nil {
		return
	}
	v := float32(*p.BatteryChargePercent) / 100
	p.BatteryChargeRemaining = &v
}

func fixedConfidence(c *pb.ClassificationConfidence) {
	// confidence has no presence, so 0 counts as unset.
	if c == nil || c.ConfidencePercent == nil || c.Confidence != 0 {
		return
	}
	c.Confidence = float32(*c.ConfidencePercent) / 100
}
