package federation

import (
	"context"
	"testing"
	"time"

	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestEstimateClockOffset_ReturnsNearZero(t *testing.T) {
	node := startTestNode(t)

	conn, err := goclient.Connect(node.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()

	client := pb.NewWorldServiceClient(conn)
	offset := estimateClockOffset(context.Background(), client)

	if offset < -500*time.Millisecond || offset > 500*time.Millisecond {
		t.Fatalf("expected offset near zero for same-host, got %v", offset)
	}
}

func TestShiftEntityTimestamps_AllFields(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	offset := 5 * time.Second

	e := &pb.Entity{
		Id: "test",
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(now),
			Fresh: timestamppb.New(now),
			Until: timestamppb.New(now.Add(60 * time.Second)),
			Components: map[int32]*pb.Lifetime{
				11: {
					Fresh: timestamppb.New(now),
					Until: timestamppb.New(now.Add(30 * time.Second)),
				},
			},
		},
		Lease: &pb.Lease{
			Controller: "ctrl",
			Expires:    timestamppb.New(now.Add(10 * time.Second)),
		},
		Detection: &pb.DetectionComponent{
			LastMeasured: timestamppb.New(now),
		},
		Mission: &pb.MissionComponent{
			Eta: timestamppb.New(now.Add(3600 * time.Second)),
		},
		Link: &pb.LinkComponent{
			LastSeen: timestamppb.New(now),
		},
		Capture: &pb.CaptureComponent{
			CapturedAt: timestamppb.New(now),
		},
		Configurable: &pb.ConfigurableComponent{
			ScheduledAt: timestamppb.New(now.Add(120 * time.Second)),
		},
	}

	shiftEntityTimestamps(e, offset)

	shifted := now.Add(offset)

	check := func(name string, ts *timestamppb.Timestamp, expected time.Time) {
		t.Helper()
		if ts == nil {
			t.Fatalf("%s: nil timestamp", name)
		}
		if !ts.AsTime().Equal(expected) {
			t.Fatalf("%s: expected %v, got %v", name, expected, ts.AsTime())
		}
	}

	check("Lifetime.From", e.Lifetime.From, shifted)
	check("Lifetime.Fresh", e.Lifetime.Fresh, shifted)
	check("Lifetime.Until", e.Lifetime.Until, now.Add(60*time.Second).Add(offset))
	check("Lifetime.Components[11].Fresh", e.Lifetime.Components[11].Fresh, shifted)
	check("Lifetime.Components[11].Until", e.Lifetime.Components[11].Until, now.Add(30*time.Second).Add(offset))
	check("Lease.Expires", e.Lease.Expires, now.Add(10*time.Second).Add(offset))
	check("Detection.LastMeasured", e.Detection.LastMeasured, shifted)
	check("Mission.Eta", e.Mission.Eta, now.Add(3600*time.Second).Add(offset))
	check("Link.LastSeen", e.Link.LastSeen, shifted)
	check("Capture.CapturedAt", e.Capture.CapturedAt, shifted)
	check("Configurable.ScheduledAt", e.Configurable.ScheduledAt, now.Add(120*time.Second).Add(offset))
}

func TestShiftEntityTimestamps_NilComponents(t *testing.T) {
	e := &pb.Entity{Id: "empty"}
	shiftEntityTimestamps(e, 5*time.Second)

	if e.Lifetime != nil {
		t.Fatal("expected nil Lifetime to remain nil")
	}
}

func TestShiftEntityTimestamps_ZeroOffset(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	e := &pb.Entity{
		Id: "test",
		Lifetime: &pb.Lifetime{
			Fresh: timestamppb.New(now),
		},
	}

	shiftEntityTimestamps(e, 0)

	if !e.Lifetime.Fresh.AsTime().Equal(now) {
		t.Fatalf("zero offset should not change timestamps, got %v", e.Lifetime.Fresh.AsTime())
	}
}

func TestShiftTS_Nil(t *testing.T) {
	if shiftTS(nil, 5*time.Second) != nil {
		t.Fatal("shiftTS(nil) should return nil")
	}
}
