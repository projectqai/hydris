package transform

import (
	"math"

	pb "github.com/projectqai/proto/go"
)

// PolarNormalizeTransformer ensures that PolarOffset entities have both the
// convenience error fields (azimuth_error_deg, elevation_error_deg, range_error_m)
// and the CovarianceMatrix populated. If only one form is set, it fills in the other.
// This must run before PoseTransformer so that downstream consumers see both forms.
type PolarNormalizeTransformer struct{}

func NewPolarNormalizeTransformer() *PolarNormalizeTransformer {
	return &PolarNormalizeTransformer{}
}

func (t *PolarNormalizeTransformer) Validate(_ map[string]*pb.Entity, _ *pb.Entity) error {
	return nil
}

func (t *PolarNormalizeTransformer) Resolve(head map[string]*pb.Entity, changedID string) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]
	if entity == nil || entity.Pose == nil {
		return nil, nil
	}

	polar, ok := entity.Pose.Offset.(*pb.PoseComponent_Polar)
	if !ok || polar.Polar == nil {
		return nil, nil
	}

	p := polar.Polar
	hasErrors := p.AzimuthErrorDeg != nil || p.ElevationErrorDeg != nil || p.RangeErrorM != nil
	hasCov := p.Covariance != nil

	if hasErrors && !hasCov {
		// Fill covariance from error fields
		cov := &pb.CovarianceMatrix{}
		if p.AzimuthErrorDeg != nil {
			v := *p.AzimuthErrorDeg * *p.AzimuthErrorDeg
			cov.Mxx = &v
		}
		if p.ElevationErrorDeg != nil {
			v := *p.ElevationErrorDeg * *p.ElevationErrorDeg
			cov.Myy = &v
		}
		if p.RangeErrorM != nil {
			v := *p.RangeErrorM * *p.RangeErrorM
			cov.Mzz = &v
		}
		p.Covariance = cov
	} else if hasCov && !hasErrors {
		// Fill error fields from covariance
		if p.Covariance.GetMxx() > 0 {
			v := math.Sqrt(p.Covariance.GetMxx())
			p.AzimuthErrorDeg = &v
		}
		if p.Covariance.GetMyy() > 0 {
			v := math.Sqrt(p.Covariance.GetMyy())
			p.ElevationErrorDeg = &v
		}
		if p.Covariance.GetMzz() > 0 {
			v := math.Sqrt(p.Covariance.GetMzz())
			p.RangeErrorM = &v
		}
	}

	return nil, nil
}
