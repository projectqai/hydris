package controller

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
)

// ManualLinkTimeout is how long a driver acts on its last control frame. Senders
// run at 50 Hz, so this tolerates about a dozen lost frames before the vehicle
// fails safe.
const ManualLinkTimeout = 250 * time.Millisecond

const manualWatchRetry = 500 * time.Millisecond

// ManualInput is what a driver knows about its operator: the current command, or
// nothing if the operator let go or the link is lost.
type ManualInput struct {
	mu   sync.Mutex
	axes *pb.ManualControlAxes
	at   time.Time
}

// Axes returns the current command, nil if there is none.
func (m *ManualInput) Axes() *pb.ManualControlAxes {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.axes == nil || time.Since(m.at) > ManualLinkTimeout {
		return nil
	}
	return m.axes
}

func (m *ManualInput) set(axes *pb.ManualControlAxes) {
	m.mu.Lock()
	m.axes, m.at = axes, time.Now()
	m.mu.Unlock()
}

// WatchManualControl receives control frames for a vehicle until ctx ends,
// reconnecting as needed. onFrame, if set, is called for every new frame with the
// axes, or nil for a release. It is not called when the link is lost: drivers
// that need to act on that poll Axes.
//
// Frames are a component of the vehicle, so every other update to the vehicle
// repeats the last one. Only a frame with a new receive time counts.
func WatchManualControl(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, entityID string, onFrame func(*pb.ManualControlAxes)) *ManualInput {
	in := &ManualInput{}
	go func() {
		for ctx.Err() == nil {
			// receive only returns when the watch breaks
			if err := in.receive(ctx, client, entityID, onFrame); ctx.Err() == nil {
				logger.Debug("manual control watch ended", "entity", entityID, "error", err)
			}
			select {
			case <-ctx.Done():
			case <-time.After(manualWatchRetry):
			}
		}
	}()
	return in
}

func (m *ManualInput) receive(ctx context.Context, client pb.WorldServiceClient, entityID string, onFrame func(*pb.ManualControlAxes)) error {
	id := entityID
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &id,
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentTargetManualControl)},
		},
	})
	if err != nil {
		return err
	}
	var last time.Time
	for {
		event, err := stream.Recv()
		if err != nil {
			return err
		}
		tmc := event.GetEntity().GetTargetManualControl()
		if tmc == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		if at := tmc.GetAt().AsTime(); tmc.At != nil && at.Equal(last) {
			continue // the vehicle changed, the frame didn't
		} else if tmc.At != nil {
			last = at
		}
		var axes *pb.ManualControlAxes
		if len(tmc.Input) > 0 {
			axes = tmc.Input[0].GetAxes()
			if axes == nil {
				axes = &pb.ManualControlAxes{}
			}
		}
		m.set(axes)
		if onFrame != nil {
			onFrame(axes)
		}
	}
}
