package engine

import (
	"cmp"
	"math"
	"slices"
	"strings"

	pb "github.com/projectqai/proto/go"
)

var defaultWatchSort = []*pb.SortOption{{Field: pb.SortField_SortFieldLifetimeFrom}}

func sortEntities(el []*pb.Entity, opts []*pb.SortOption) {
	if len(opts) == 0 {
		slices.SortFunc(el, func(a, b *pb.Entity) int { return strings.Compare(a.Id, b.Id) })
		return
	}
	if len(opts) > 2 {
		opts = opts[:2]
	}
	slices.SortStableFunc(el, func(a, b *pb.Entity) int {
		for _, opt := range opts {
			c := compareSortField(a, b, opt)
			if c != 0 {
				if opt.Descending {
					return -c
				}
				return c
			}
		}
		return strings.Compare(a.Id, b.Id)
	})
}

func compareSortField(a, b *pb.Entity, opt *pb.SortOption) int {
	switch opt.Field {
	case pb.SortField_SortFieldLabel:
		return strings.Compare(derefStr(a.Label), derefStr(b.Label))
	case pb.SortField_SortFieldPriority:
		return cmp.Compare(int32(a.GetPriority()), int32(b.GetPriority()))

	// lifetime
	case pb.SortField_SortFieldLifetimeFrom:
		return cmpTimestamp(a.GetLifetime().GetFrom(), b.GetLifetime().GetFrom())
	case pb.SortField_SortFieldLifetimeUntil:
		return cmpTimestamp(a.GetLifetime().GetUntil(), b.GetLifetime().GetUntil())
	case pb.SortField_SortFieldLifetimeFresh:
		return cmpTimestamp(a.GetLifetime().GetFresh(), b.GetLifetime().GetFresh())

	// geo
	case pb.SortField_SortFieldGeoLatitude:
		av, ao := geoLat(a)
		bv, bo := geoLat(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldGeoLongitude:
		av, ao := geoLon(a)
		bv, bo := geoLon(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldGeoAltitude:
		av, ao := geoAlt(a)
		bv, bo := geoAlt(b)
		return cmpOpt(av, ao, bv, bo)

	// classification
	case pb.SortField_SortFieldClassificationIdentity:
		return cmp.Compare(int32(a.GetClassification().GetIdentity()), int32(b.GetClassification().GetIdentity()))
	case pb.SortField_SortFieldClassificationDimension:
		return cmp.Compare(int32(a.GetClassification().GetDimension()), int32(b.GetClassification().GetDimension()))

	// bearing
	case pb.SortField_SortFieldBearingAzimuth:
		av, ao := bearingAz(a)
		bv, bo := bearingAz(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldBearingElevation:
		av, ao := bearingEl(a)
		bv, bo := bearingEl(b)
		return cmpOpt(av, ao, bv, bo)

	// administrative
	case pb.SortField_SortFieldAdministrativeLength:
		av, ao := adminLength(a)
		bv, bo := adminLength(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldAdministrativeWidth:
		av, ao := adminWidth(a)
		bv, bo := adminWidth(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldAdministrativeHeight:
		av, ao := adminHeight(a)
		bv, bo := adminHeight(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldAdministrativeTonnage:
		av, ao := adminTonnage(a)
		bv, bo := adminTonnage(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldAdministrativeEnginePower:
		av, ao := adminEnginePower(a)
		bv, bo := adminEnginePower(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldAdministrativeYearBuilt:
		av, ao := adminYearBuilt(a)
		bv, bo := adminYearBuilt(b)
		return cmpOpt(av, ao, bv, bo)

	// link
	case pb.SortField_SortFieldLinkRssi:
		av, ao := linkRssi(a)
		bv, bo := linkRssi(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldLinkSnr:
		av, ao := linkSnr(a)
		bv, bo := linkSnr(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldLinkLastLatency:
		av, ao := linkLastLatency(a)
		bv, bo := linkLastLatency(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldLinkAvgLatency:
		av, ao := linkAvgLatency(a)
		bv, bo := linkAvgLatency(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldLinkQuality:
		av, ao := linkQuality(a)
		bv, bo := linkQuality(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldLinkLastSeen:
		return cmpTimestamp(a.GetLink().GetLastSeen(), b.GetLink().GetLastSeen())
	case pb.SortField_SortFieldLinkPacketRate:
		av, ao := linkPacketRate(a)
		bv, bo := linkPacketRate(b)
		return cmpOpt(av, ao, bv, bo)

	// power
	case pb.SortField_SortFieldPowerBatteryCharge:
		av, ao := powerBatteryCharge(a)
		bv, bo := powerBatteryCharge(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldPowerVoltage:
		av, ao := powerVoltage(a)
		bv, bo := powerVoltage(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldPowerRemainingSeconds:
		av, ao := powerRemainingSeconds(a)
		bv, bo := powerRemainingSeconds(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldPowerCurrent:
		av, ao := powerCurrent(a)
		bv, bo := powerCurrent(b)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldPowerCapacityUsed:
		av, ao := powerCapacityUsed(a)
		bv, bo := powerCapacityUsed(b)
		return cmpOpt(av, ao, bv, bo)

	// device
	case pb.SortField_SortFieldDeviceState:
		return cmp.Compare(int32(a.GetDevice().GetState()), int32(b.GetDevice().GetState()))

	// metric
	case pb.SortField_SortFieldMetricValue:
		av, ao := metricValue(a, opt)
		bv, bo := metricValue(b, opt)
		return cmpOpt(av, ao, bv, bo)
	case pb.SortField_SortFieldMetricMeasuredAt:
		ma, mb := findMetric(a, opt), findMetric(b, opt)
		return cmpTimestamp(ma.GetMeasuredAt(), mb.GetMeasuredAt())
	case pb.SortField_SortFieldMetricAlertLevel:
		ma, mb := findMetric(a, opt), findMetric(b, opt)
		return cmp.Compare(int32(ma.GetAlerting()), int32(mb.GetAlerting()))

	default:
		return 0
	}
}

// --- field extractors ---

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func geoLat(e *pb.Entity) (float64, bool) {
	if e.Geo == nil {
		return 0, false
	}
	return e.Geo.Latitude, true
}

func geoLon(e *pb.Entity) (float64, bool) {
	if e.Geo == nil {
		return 0, false
	}
	return e.Geo.Longitude, true
}

func geoAlt(e *pb.Entity) (float64, bool) {
	if e.Geo == nil || e.Geo.Altitude == nil {
		return 0, false
	}
	return *e.Geo.Altitude, true
}

func bearingAz(e *pb.Entity) (float64, bool) {
	if e.Bearing == nil || e.Bearing.Azimuth == nil {
		return 0, false
	}
	return *e.Bearing.Azimuth, true
}

func bearingEl(e *pb.Entity) (float64, bool) {
	if e.Bearing == nil || e.Bearing.Elevation == nil {
		return 0, false
	}
	return *e.Bearing.Elevation, true
}

func adminLength(e *pb.Entity) (float32, bool) {
	if e.Administrative == nil || e.Administrative.LengthM == nil {
		return 0, false
	}
	return *e.Administrative.LengthM, true
}

func adminWidth(e *pb.Entity) (float32, bool) {
	if e.Administrative == nil || e.Administrative.WidthM == nil {
		return 0, false
	}
	return *e.Administrative.WidthM, true
}

func adminHeight(e *pb.Entity) (float32, bool) {
	if e.Administrative == nil || e.Administrative.HeightM == nil {
		return 0, false
	}
	return *e.Administrative.HeightM, true
}

func adminTonnage(e *pb.Entity) (float32, bool) {
	if e.Administrative == nil || e.Administrative.TonnageGt == nil {
		return 0, false
	}
	return *e.Administrative.TonnageGt, true
}

func adminEnginePower(e *pb.Entity) (float32, bool) {
	if e.Administrative == nil || e.Administrative.EnginePowerKw == nil {
		return 0, false
	}
	return *e.Administrative.EnginePowerKw, true
}

func adminYearBuilt(e *pb.Entity) (uint32, bool) {
	if e.Administrative == nil || e.Administrative.YearBuilt == nil {
		return 0, false
	}
	return *e.Administrative.YearBuilt, true
}

func linkRssi(e *pb.Entity) (int32, bool) {
	if e.Link == nil || e.Link.RssiDbm == nil {
		return 0, false
	}
	return *e.Link.RssiDbm, true
}

func linkSnr(e *pb.Entity) (int32, bool) {
	if e.Link == nil || e.Link.SnrDb == nil {
		return 0, false
	}
	return *e.Link.SnrDb, true
}

func linkLastLatency(e *pb.Entity) (uint32, bool) {
	if e.Link == nil || e.Link.LastLatencyMs == nil {
		return 0, false
	}
	return *e.Link.LastLatencyMs, true
}

func linkAvgLatency(e *pb.Entity) (uint32, bool) {
	if e.Link == nil || e.Link.AvgLatencyMs == nil {
		return 0, false
	}
	return *e.Link.AvgLatencyMs, true
}

func linkQuality(e *pb.Entity) (uint32, bool) {
	if e.Link == nil || e.Link.LinkQualityPercent == nil {
		return 0, false
	}
	return *e.Link.LinkQualityPercent, true
}

func linkPacketRate(e *pb.Entity) (uint32, bool) {
	if e.Link == nil || e.Link.PacketRateHz == nil {
		return 0, false
	}
	return *e.Link.PacketRateHz, true
}

func powerBatteryCharge(e *pb.Entity) (float32, bool) {
	if e.Power == nil || e.Power.BatteryChargeRemaining == nil {
		return 0, false
	}
	return *e.Power.BatteryChargeRemaining, true
}

func powerVoltage(e *pb.Entity) (float32, bool) {
	if e.Power == nil || e.Power.Voltage == nil {
		return 0, false
	}
	return *e.Power.Voltage, true
}

func powerRemainingSeconds(e *pb.Entity) (uint32, bool) {
	if e.Power == nil || e.Power.RemainingSeconds == nil {
		return 0, false
	}
	return *e.Power.RemainingSeconds, true
}

func powerCurrent(e *pb.Entity) (float32, bool) {
	if e.Power == nil || e.Power.CurrentA == nil {
		return 0, false
	}
	return *e.Power.CurrentA, true
}

func powerCapacityUsed(e *pb.Entity) (float32, bool) {
	if e.Power == nil || e.Power.CapacityUsedMah == nil {
		return 0, false
	}
	return *e.Power.CapacityUsedMah, true
}

// --- metric helpers ---

func findMetric(e *pb.Entity, opt *pb.SortOption) *pb.Metric {
	if e.Metric == nil {
		return nil
	}
	for _, m := range e.Metric.Metrics {
		if matchesMetricSelector(m, opt) {
			return m
		}
	}
	return nil
}

func matchesMetricSelector(m *pb.Metric, opt *pb.SortOption) bool {
	switch sel := opt.MetricSelector.(type) {
	case *pb.SortOption_MetricId:
		return m.GetId() == sel.MetricId
	case *pb.SortOption_MetricKind:
		return m.GetKind() == sel.MetricKind
	default:
		return true
	}
}

func metricNumericValue(m *pb.Metric) float64 {
	if m == nil {
		return math.NaN()
	}
	switch v := m.Val.(type) {
	case *pb.Metric_Double:
		return v.Double
	case *pb.Metric_Float:
		return float64(v.Float)
	case *pb.Metric_Sint64:
		return float64(v.Sint64)
	case *pb.Metric_Uint64:
		return float64(v.Uint64)
	default:
		return math.NaN()
	}
}

func metricValue(e *pb.Entity, opt *pb.SortOption) (float64, bool) {
	m := findMetric(e, opt)
	if m == nil {
		return 0, false
	}
	v := metricNumericValue(m)
	if math.IsNaN(v) {
		return 0, false
	}
	return v, true
}

// --- generic comparators ---

func cmpOpt[T cmp.Ordered](a T, aOk bool, b T, bOk bool) int {
	if !aOk && !bOk {
		return 0
	}
	if !aOk {
		return 1
	}
	if !bOk {
		return -1
	}
	return cmp.Compare(a, b)
}

func cmpTimestamp(a, b interface{ GetSeconds() int64 }) int {
	var as, bs int64
	if a != nil {
		as = a.GetSeconds()
	}
	if b != nil {
		bs = b.GetSeconds()
	}
	return cmp.Compare(as, bs)
}
