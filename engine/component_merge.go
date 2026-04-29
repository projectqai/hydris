package engine

import (
	"slices"

	pb "github.com/projectqai/proto/go"
)

// applyComponentMergers handles sub-component merging for components that
// contain repeated fields keyed by ID. Called after mf.Set(sf) so that
// merged already holds the incoming value; existing is the pre-merge entity.
func applyComponentMergers(protoNum int32, merged, existing *pb.Entity) {
	switch protoNum {
	case 36:
		mergeRepeatedMetrics(merged, existing)
	}
}

func mergeRepeatedMetrics(merged, existing *pb.Entity) {
	if existing.Metric == nil {
		return
	}
	byID := make(map[uint32]struct{}, len(merged.Metric.Metrics))
	for _, m := range merged.Metric.Metrics {
		if m.Id != nil {
			byID[*m.Id] = struct{}{}
		}
	}
	kept := make([]*pb.Metric, len(merged.Metric.Metrics), len(merged.Metric.Metrics)+len(existing.Metric.Metrics))
	copy(kept, merged.Metric.Metrics)
	for _, m := range existing.Metric.Metrics {
		if m.Id == nil {
			continue
		}
		if _, ok := byID[*m.Id]; ok {
			continue
		}
		kept = append(kept, m)
	}
	slices.SortFunc(kept, func(a, b *pb.Metric) int {
		return int(a.GetId()) - int(b.GetId())
	})
	merged.Metric = &pb.MetricComponent{Metrics: kept}
}
