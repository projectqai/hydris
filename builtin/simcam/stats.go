package simcam

import (
	"context"
	"sync"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	statsInterval   = 2 * time.Second
	qualityCooldown = 10 * time.Second

	// Quality drops when a frame takes more than qualityDownAt of the frame
	// interval, and rises when the sharper ground is predicted to stay under
	// qualityUpAt. The gap between them prevents flapping.
	qualityDownAt = 0.75
	qualityUpAt   = 0.4
	// sharpGroundCost is how much longer rendering takes with each extra
	// ground sample (measured: 1.8 ms → 3.8 ms per frame).
	sharpGroundCost = 2.2
)

// Metric ids on the camera entity.
const (
	metricRenderTime uint32 = iota + 1
	metricEncodeTime
	metricFrameRate
	metricQuality
)

// frameStats accumulates frame timings between monitor ticks.
type frameStats struct {
	mu     sync.Mutex
	frames int
	render time.Duration
	encode time.Duration
}

func (s *frameStats) record(render, encode time.Duration) {
	s.mu.Lock()
	s.frames++
	s.render += render
	s.encode += encode
	s.mu.Unlock()
}

// take returns the averages since the last call and resets.
func (s *frameStats) take() (frames int, avgRender, avgEncode time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	frames = s.frames
	if frames > 0 {
		avgRender = s.render / time.Duration(frames)
		avgEncode = s.encode / time.Duration(frames)
	}
	s.frames, s.render, s.encode = 0, 0, 0
	return frames, avgRender, avgEncode
}

// nextQuality decides the ground quality (lengthwise samples) from the
// measured frame cost at quality q.
func nextQuality(q int, avgRender, avgEncode, frameInterval time.Duration) int {
	budget := float64(frameInterval)
	render, encode := float64(avgRender), float64(avgEncode)
	switch {
	case q > 1 && render+encode > qualityDownAt*budget:
		return q - 1
	case q < maxGroundSamples && render*sharpGroundCost+encode < qualityUpAt*budget:
		return q + 1
	}
	return q
}

// monitorFrames runs beside the render loop. Every statsInterval it adapts
// the ground quality to what this machine sustains and publishes frame
// timing metrics on the camera entity.
func (cam *camera) monitorFrames(ctx context.Context, client pb.WorldServiceClient, frameInterval time.Duration) {
	tick := time.NewTicker(statsInterval)
	defer tick.Stop()
	var lastChange time.Time
	active := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		now := time.Now()
		frames, render, encode := cam.stats.take()
		if frames == 0 {
			if active { // went idle: report it once
				cam.pushFrameMetrics(ctx, client, now, 0, 0, 0)
				active = false
			}
			continue
		}
		active = true

		q := int(cam.quality.Load())
		if now.Sub(lastChange) >= qualityCooldown {
			if nq := nextQuality(q, render, encode, frameInterval); nq != q {
				cam.quality.Store(int32(nq))
				lastChange = now
				cam.logger.Info("simcam: render quality changed",
					"quality", nq, "render", render, "encode", encode, "frame_interval", frameInterval)
			}
		}
		fps := float64(frames) / statsInterval.Seconds()
		cam.pushFrameMetrics(ctx, client, now, render, encode, fps)
	}
}

func (cam *camera) pushFrameMetrics(ctx context.Context, client pb.WorldServiceClient, now time.Time, render, encode time.Duration, fps float64) {
	at := timestamppb.New(now)
	ms := func(d time.Duration) *pb.Metric_Double {
		return &pb.Metric_Double{Double: float64(d.Microseconds()) / 1000}
	}
	_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{{
		Id: cam.id,
		Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
			{
				Id: proto.Uint32(metricRenderTime), Label: proto.String("Frame render time"),
				Kind: pb.MetricKind_MetricKindDuration.Enum(), Unit: pb.MetricUnit_MetricUnitMillisecond,
				MeasuredAt: at, Val: ms(render),
			},
			{
				Id: proto.Uint32(metricEncodeTime), Label: proto.String("Frame encode time"),
				Kind: pb.MetricKind_MetricKindDuration.Enum(), Unit: pb.MetricUnit_MetricUnitMillisecond,
				MeasuredAt: at, Val: ms(encode),
			},
			{
				Id: proto.Uint32(metricFrameRate), Label: proto.String("Frame rate"),
				Kind: pb.MetricKind_MetricKindFrequency.Enum(), Unit: pb.MetricUnit_MetricUnitHertz,
				MeasuredAt: at, Val: &pb.Metric_Double{Double: fps},
			},
			{
				Id: proto.Uint32(metricQuality), Label: proto.String("Render quality"),
				Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount,
				MeasuredAt: at, Val: &pb.Metric_Uint64{Uint64: uint64(cam.quality.Load())},
			},
		}},
	}}})
	if err != nil && ctx.Err() == nil {
		cam.logger.Warn("simcam: push frame metrics", "error", err)
	}
}
