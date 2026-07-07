package engine

import (
	"strconv"
	"strings"
	"time"

	"github.com/projectqai/hydris/pkg/metrics"
	pb "github.com/projectqai/proto/go"
	"github.com/prometheus/client_golang/prometheus"
)

func (s *WorldServer) EntityCount() int {
	s.l.RLock()
	defer s.l.RUnlock()
	return len(s.head)
}

func StartMetricsUpdater(server *WorldServer) {
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for range ticker.C {
			count := server.EntityCount()
			metrics.SetEntityCount(count)
		}
	}()
}

var (
	entityMetricLabels = []string{"entity", "metric_id", "kind", "unit"}

	entityMetricDesc = prometheus.NewDesc(
		"hydris_entity_metric",
		"Value of a Metric component held in head, evaluated at scrape time",
		entityMetricLabels, nil,
	)

	entityMetricAlertDesc = prometheus.NewDesc(
		"hydris_entity_metric_alert_level",
		"Alert level of a Metric component held in head (0=none 1=warning 2=alarm 3=critical)",
		entityMetricLabels, nil,
	)
)

// EntityMetricsCollector exposes every Metric component currently held in
// head as prometheus gauges.
type EntityMetricsCollector struct {
	server *WorldServer
}

func NewEntityMetricsCollector(server *WorldServer) *EntityMetricsCollector {
	return &EntityMetricsCollector{server: server}
}

func (c *EntityMetricsCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- entityMetricDesc
	ch <- entityMetricAlertDesc
}

func (c *EntityMetricsCollector) Collect(ch chan<- prometheus.Metric) {
	c.server.l.RLock()
	defer c.server.l.RUnlock()

	// duplicate label sets would fail the whole scrape, so skip them
	seen := make(map[string]struct{})

	for id, es := range c.server.head {
		e := es.entity
		if e.Metric == nil {
			continue
		}
		for _, m := range e.Metric.Metrics {
			// only metrics with a stable id are exported, to keep cardinality low
			if m.Id == nil {
				continue
			}

			var value float64
			switch v := m.Val.(type) {
			case *pb.Metric_Double:
				value = v.Double
			case *pb.Metric_Float:
				value = float64(v.Float)
			case *pb.Metric_Sint64:
				value = float64(v.Sint64)
			case *pb.Metric_Uint64:
				value = float64(v.Uint64)
			default:
				continue
			}

			key := id + "\x00" + strconv.FormatUint(uint64(*m.Id), 10)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}

			labels := []string{
				id,
				strconv.FormatUint(uint64(*m.Id), 10),
				strings.TrimPrefix(m.GetKind().String(), "MetricKind"),
				strings.TrimPrefix(m.GetUnit().String(), "MetricUnit"),
			}

			ch <- prometheus.MustNewConstMetric(entityMetricDesc, prometheus.GaugeValue, value, labels...)
			if m.Alerting != nil {
				ch <- prometheus.MustNewConstMetric(entityMetricAlertDesc, prometheus.GaugeValue, float64(*m.Alerting), labels...)
			}
		}
	}
}
