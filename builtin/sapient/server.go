package sapient

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aep/gosapient/pkg/sapient"
	sapientpb "github.com/aep/gosapient/pkg/sapientpb"
	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// runServer opens a TCP listener and accepts SAPIENT sensor connections.
// For each connection it:
// - receives Registration, sends RegistrationAck, creates a subdevice entity
// - receives DetectionReports, creates/updates track entities
// - receives StatusReports, updates sensor entities
// - can forward Tasks to connected nodes
func runServer(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	addr := getConfigString(entity, "address")
	if addr == "" {
		addr = ":5020"
	}

	ln, err := sapient.Listen(addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}
	defer func() { _ = ln.Close() }()

	logger.Info("SAPIENT server listening", "address", ln.Addr())
	ready()

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()
	worldClient := pb.NewWorldServiceClient(grpcConn)

	myID := sapient.NewUUID()
	trackerEntityID := entity.Id

	var stats serverStats

	// Periodically push metrics
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
					Changes: []*pb.Entity{{
						Id: trackerEntityID,
						Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
							{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("active connections"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: uint64(stats.activeConns.Load())}},
							{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("messages received"), Id: proto.Uint32(2), Val: &pb.Metric_Uint64{Uint64: uint64(stats.messagesReceived.Load())}},
							{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("sensors registered"), Id: proto.Uint32(3), Val: &pb.Metric_Uint64{Uint64: uint64(stats.sensorsRegistered.Load())}},
						}},
					}},
				})
			}
		}
	}()

	var wg sync.WaitGroup
	defer wg.Wait()

	// Close listener when context is cancelled to unblock Accept
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			logger.Error("accept error", "error", err)
			continue
		}

		stats.activeConns.Add(1)
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer stats.activeConns.Add(-1)
			serverHandleConn(ctx, logger, conn, worldClient, myID, trackerEntityID, &stats)
		}()
	}
}

type serverStats struct {
	activeConns       atomic.Int64
	messagesReceived  atomic.Uint64
	sensorsRegistered atomic.Uint64
}

func serverHandleConn(ctx context.Context, logger *slog.Logger, conn *sapient.Conn, worldClient pb.WorldServiceClient, myID, trackerEntityID string, stats *serverStats) {
	defer func() { _ = conn.Close() }()

	var sapientNodeID string
	detExpiry := defaultDetectionExpiry
	var sensorLat, sensorLng, sensorAlt float64
	var isRadar bool
	var isV1 bool
	sMode := &reportedMode{}

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		msg, err := conn.Recv()
		if err != nil {
			if sapient.IsConnectionClosed(err) {
				logger.Debug("client disconnected", "node_id", sapientNodeID, "remote", conn.RemoteAddr())
			} else {
				logger.Error("recv error", "error", err, "remote", conn.RemoteAddr())
			}
			// Expire the sensor entity if we had one registered
			if sapientNodeID != "" {
				entityID := fmt.Sprintf("sapient:%s", sapientNodeID)
				_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
					Changes: []*pb.Entity{{
						Id: entityID,
						Device: &pb.DeviceComponent{
							State: pb.DeviceState_DeviceStateFailed,
						},
					}},
				})
			}
			return
		}

		stats.messagesReceived.Add(1)
		ct := sapient.ContentType(msg)
		from := msg.GetNodeId()

		switch ct {
		case "registration":
			reg := msg.GetRegistration()
			sapientNodeID = from
			isV1 = sapient.IsV1(reg.GetIcdVersion())

			version := "v2"
			if isV1 {
				version = fmt.Sprintf("v1 (icd=%s)", reg.GetIcdVersion())
			}
			logger.Info("sensor registered",
				"node_id", from,
				"name", reg.GetName(),
				"version", version,
				"remote", conn.RemoteAddr())

			// Send RegistrationAck (v1 or v2)
			var ackErr error
			if isV1 {
				ackErr = sapient.AckV1(conn, myID, from, true, "accepted")
			} else {
				ackErr = sapient.Ack(conn, myID, from, true)
			}
			if ackErr != nil {
				logger.Error("failed to send registration ack", "error", ackErr)
				return
			}

			stats.sensorsRegistered.Add(1)
			if exp := registrationExpiry(reg); exp > 0 {
				detExpiry = exp
			}
			if len(reg.GetNodeDefinition()) > 0 && reg.NodeDefinition[0].GetNodeType() == sapientpb.Registration_NODE_TYPE_RADAR {
				isRadar = true
			}

			// Create subdevice entity
			entity := registrationToEntity(reg, sapientNodeID, trackerEntityID, trackerEntityID)
			_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{entity},
			})
			if err != nil {
				logger.Error("failed to push sensor entity", "error", err)
			}

			// Initialize reported mode from first mode definition
			if modes := reg.GetModeDefinition(); len(modes) > 0 {
				sMode.Set(modes[0].GetModeName())
			}

			// Start task watcher for this sensor if it has modes
			if entity.Configurable != nil {
				go watchSensorEntity(ctx, logger, conn, myID, sapientNodeID, entity.Id, sMode)
			}

		case "detection_report":
			det := msg.GetDetectionReport()
			if shouldDropDetection(det) {
				continue
			}
			nodeID := from
			if sapientNodeID != "" {
				nodeID = sapientNodeID
			}
			entity := detectionToEntity(det, nodeID, trackerEntityID, detExpiry, sensorLat, sensorLng, sensorAlt, isRadar)

			_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{entity},
			})
			if err != nil {
				logger.Error("failed to push detection", "error", err)
			}

		case "status_report":
			nodeID := from
			if sapientNodeID != "" {
				nodeID = sapientNodeID
			}
			sr := msg.GetStatusReport()
			if loc := sr.GetNodeLocation(); loc != nil {
				sensorLat = loc.GetY()
				sensorLng = loc.GetX()
				sensorAlt = loc.GetZ()
			}
			if m := sr.GetMode(); m != "" {
				sMode.Set(m)
			}
			entities := statusReportToEntities(sr, nodeID)
			_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: entities,
			})
			if err != nil {
				logger.Error("failed to push status update", "error", err)
			}

		case "alert":
			a := msg.GetAlert()
			logger.Info("received alert from sensor",
				"node_id", from,
				"alert_id", a.GetAlertId(),
				"type", a.GetAlertType())

		case "task_ack":
			ta := msg.GetTaskAck()
			logger.Info("received task ack from sensor",
				"node_id", from,
				"task_id", ta.GetTaskId(),
				"status", ta.GetTaskStatus())

		default:
			logger.Debug("unhandled message type",
				"type", ct,
				"from", from)
		}
	}
}
