package federation

import (
	"context"
	"time"

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
// offset from the sample with the lowest round-trip time (most accurate).
// The result is rounded to offsetResolution (5ms) to reduce jitter across
// different federation paths.
//
// offset = remote_clock - local_clock
//
// Returns zero if the remote does not support TimeSync (old nodes).
func estimateClockOffset(ctx context.Context, client pb.WorldServiceClient) time.Duration {
	var bestOffset time.Duration
	var bestRTT time.Duration

	for i := 0; i < timeSyncSamples; i++ {
		rpcCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		t1 := time.Now()
		resp, err := client.TimeSync(rpcCtx, &pb.TimeSyncRequest{
			T1: timestamppb.New(t1),
		})
		t4 := time.Now()
		cancel()

		if err != nil {
			if s, ok := status.FromError(err); ok && s.Code() == codes.Unimplemented {
				return 0
			}
			continue
		}

		t2 := resp.T2.AsTime()
		t3 := resp.T3.AsTime()

		rtt := (t4.Sub(t1)) - (t3.Sub(t2))
		offset := (t2.Sub(t1) + t3.Sub(t4)) / 2

		if i == 0 || rtt < bestRTT {
			bestRTT = rtt
			bestOffset = offset
		}
	}

	return bestOffset.Round(offsetResolution)
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
	for _, sub := range lt.Components {
		shiftLifetime(sub, d)
	}
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
		e.Detection.LastMeasured = shiftTS(e.Detection.LastMeasured, d)
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
