package federation

import (
	"context"
	"time"

	"github.com/projectqai/hydris/pkg/timesync"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	timeSyncSamples = 5

	// offsetResolution is the granularity to which we round the estimated
	// clock offset. 10ms (100Hz) is sufficient since we round the offset
	// itself, not individual timestamps. Rounding ensures that the same
	// logical offset estimated via different federation paths converges to
	// the same value, preventing jitter from causing spurious LWW merges.
	offsetResolution = 10 * time.Millisecond
)

// estimateClockOffset performs an NTP-style clock offset estimation against
// a remote WorldService peer. It takes multiple samples and returns the
// offset and RTT from the sample with the lowest round-trip time (most
// accurate). The offset is rounded to offsetResolution to reduce jitter
// across different federation paths.
//
// offset = remote_clock - local_clock
//
// Returns zero for both values if the remote does not support TimeSync.
func estimateClockOffset(ctx context.Context, client pb.WorldServiceClient) (offset time.Duration, rtt time.Duration) {
	var bestOffset time.Duration
	var bestRTT time.Duration
	var prevT4 time.Time

	for i := 0; i < timeSyncSamples; i++ {
		rpcCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		t1 := time.Now()
		req := &pb.TimeSyncRequest{T1: timestamppb.New(t1)}
		if !prevT4.IsZero() {
			req.T4 = timestamppb.New(prevT4)
		}
		resp, err := client.TimeSync(rpcCtx, req)
		t4 := time.Now()
		prevT4 = t4
		cancel()

		if err != nil {
			if s, ok := status.FromError(err); ok && s.Code() == codes.Unimplemented {
				return 0, 0
			}
			continue
		}

		t2 := resp.T2.AsTime()
		t3 := resp.T3.AsTime()

		sampleOffset, sampleRTT := timesync.NTPSample(t1, t2, t3, t4)

		if i == 0 || sampleRTT < bestRTT {
			bestRTT = sampleRTT
			bestOffset = sampleOffset
		}
	}

	return bestOffset.Round(offsetResolution), bestRTT
}

func shiftTS(ts *timestamppb.Timestamp, d time.Duration) *timestamppb.Timestamp {
	if ts == nil {
		return nil
	}
	return timestamppb.New(ts.AsTime().Add(d))
}

func shiftLifetime(lt *pb.Lifetime, d time.Duration) {
	if lt == nil {
		return
	}
	lt.From = shiftTS(lt.From, d)
	lt.Fresh = shiftTS(lt.Fresh, d)
	lt.Until = shiftTS(lt.Until, d)
}

// shiftEntityTimestamps adjusts every known timestamp field on an Entity by
// the given offset. Used to translate between clock domains when federating
// entities between nodes with unsynchronized clocks.
func shiftEntityTimestamps(e *pb.Entity, d time.Duration) {
	if e == nil || d == 0 {
		return
	}

	shiftLifetime(e.Lifetime, d)

	if e.Lease != nil {
		e.Lease.Expires = shiftTS(e.Lease.Expires, d)
	}
	if e.Detection != nil {
		e.Detection.LastMeasured = shiftTS(e.Detection.LastMeasured, d) //nolint:staticcheck
	}
	if e.Mission != nil {
		e.Mission.Eta = shiftTS(e.Mission.Eta, d)
	}
	if e.Link != nil {
		e.Link.LastSeen = shiftTS(e.Link.LastSeen, d)
	}
	if e.Capture != nil {
		e.Capture.CapturedAt = shiftTS(e.Capture.CapturedAt, d)
	}
	if e.Configurable != nil {
		e.Configurable.ScheduledAt = shiftTS(e.Configurable.ScheduledAt, d)
	}
}
