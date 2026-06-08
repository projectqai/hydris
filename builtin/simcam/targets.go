package simcam

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func targetID(i int) string {
	return fmt.Sprintf("simcam.target.%d", i+1)
}

func runTargets(ctx context.Context, logger *slog.Logger, count int) {
	grpcConn, err := builtin.BuiltinClientConn("simcam")
	if err != nil {
		logger.Error("simcam targets: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	var entities []*pb.Entity
	for i := range count {
		lat, lon := targetPosition(i, count)
		entities = append(entities, &pb.Entity{
			Id:    targetID(i),
			Label: proto.String(fmt.Sprintf("Simulated Target %d", i+1)),
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Parent:   proto.String(serviceEntityID),
				Category: proto.String("Missions"),
				State:    pb.DeviceState_DeviceStateActive,
			},
			Symbol: &pb.SymbolComponent{
				MilStd2525C: "SHGPE-----",
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String("crosshair"),
			},
			Geo: &pb.GeoSpatialComponent{
				Latitude:  lat,
				Longitude: lon,
				Altitude:  proto.Float64(0),
			},
			Track: &pb.TrackComponent{
				Tracker: proto.String(controllerName),
			},
		})
	}

	if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: entities}); err != nil {
		logger.Error("simcam targets: failed to push", "error", err)
		return
	}

	<-ctx.Done()

	expCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for i := range count {
		_, _ = client.ExpireEntity(expCtx, &pb.ExpireEntityRequest{Id: targetID(i)})
	}
}

func targetPosition(idx, total int) (float64, float64) {
	const radiusDeg = 0.004
	angle := 2 * math.Pi * float64(idx) / float64(total)
	return anchorLatitude + radiusDeg*math.Cos(angle), anchorLongitude + radiusDeg*math.Sin(angle)
}
