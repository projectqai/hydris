package sapient

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/aep/gosapient/pkg/sapient"
	sapientpb "github.com/aep/gosapient/pkg/sapientpb"
	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
)

const defaultDetectionExpiry = 30 * time.Second

// runPeer connects as a TCP client to an Apex middleware and:
// - receives Registration messages, creating subdevice entities for each sensor
// - receives DetectionReports, creating/updating track entities
// - receives StatusReports, updating sensor entities
// - can send Tasks and mode changes to sensors (via TaskExecution watch)
func runPeer(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	addr := getConfigString(entity, "address")
	if addr == "" {
		addr = "localhost:5001"
	}

	ready()

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()
	worldClient := pb.NewWorldServiceClient(grpcConn)

	trackerEntityID := entity.Id

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		logger.Info("connecting to Apex middleware", "address", addr)
		conn, err := sapient.Dial(addr)
		if err != nil {
			logger.Error("failed to connect to Apex", "error", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(5 * time.Second):
				continue
			}
		}

		err = peerLoop(ctx, logger, conn, worldClient, trackerEntityID)
		_ = conn.Close()

		if ctx.Err() != nil {
			return ctx.Err()
		}
		logger.Warn("Apex connection lost, reconnecting", "error", err)
		time.Sleep(2 * time.Second)
	}
}

func peerLoop(ctx context.Context, logger *slog.Logger, conn *sapient.Conn, worldClient pb.WorldServiceClient, trackerEntityID string) error {
	// Per-node state
	registeredNodes := make(map[string]string)   // sapientNodeID -> entityID
	nodeExpiry := make(map[string]time.Duration) // sapientNodeID -> detection expiry
	nodeIsRadar := make(map[string]bool)
	nodeLat := make(map[string]float64)
	nodeLng := make(map[string]float64)
	nodeAlt := make(map[string]float64)
	nodeMode := make(map[string]*reportedMode)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		msg, err := conn.Recv()
		if err != nil {
			if sapient.IsConnectionClosed(err) {
				return fmt.Errorf("disconnected")
			}
			return fmt.Errorf("recv: %w", err)
		}

		sapientNodeID := msg.GetNodeId()

		switch sapient.ContentType(msg) {
		case "registration":
			reg := msg.GetRegistration()
			logger.Info("received registration",
				"node_id", sapientNodeID,
				"name", reg.GetName())

			entity := registrationToEntity(reg, sapientNodeID, trackerEntityID, trackerEntityID)
			registeredNodes[sapientNodeID] = entity.Id
			if exp := registrationExpiry(reg); exp > 0 {
				nodeExpiry[sapientNodeID] = exp
			}
			if len(reg.GetNodeDefinition()) > 0 && reg.NodeDefinition[0].GetNodeType() == sapientpb.Registration_NODE_TYPE_RADAR {
				nodeIsRadar[sapientNodeID] = true
			}

			_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{entity},
			})
			if err != nil {
				logger.Error("failed to push sensor entity", "error", err)
			}

			// Start task watcher for this sensor if it has modes
			if entity.Configurable != nil {
				rm := &reportedMode{}
				if modes := reg.GetModeDefinition(); len(modes) > 0 {
					rm.Set(modes[0].GetModeName())
				}
				nodeMode[sapientNodeID] = rm
				go watchSensorEntity(ctx, logger, conn, sapientNodeID, sapientNodeID, entity.Id, rm)
			}

		case "detection_report":
			det := msg.GetDetectionReport()
			if shouldDropDetection(det) {
				continue
			}
			expiry := defaultDetectionExpiry
			if exp, ok := nodeExpiry[sapientNodeID]; ok {
				expiry = exp
			}
			entity := detectionToEntity(det, sapientNodeID, trackerEntityID, expiry, nodeLat[sapientNodeID], nodeLng[sapientNodeID], nodeAlt[sapientNodeID], nodeIsRadar[sapientNodeID])

			_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{entity},
			})
			if err != nil {
				logger.Error("failed to push detection", "error", err)
			}

		case "status_report":
			sr := msg.GetStatusReport()
			if loc := sr.GetNodeLocation(); loc != nil {
				nodeLat[sapientNodeID] = loc.GetY()
				nodeLng[sapientNodeID] = loc.GetX()
				nodeAlt[sapientNodeID] = loc.GetZ()
			}
			if m := sr.GetMode(); m != "" {
				if rm, ok := nodeMode[sapientNodeID]; ok {
					rm.Set(m)
				}
			}
			entities := statusReportToEntities(sr, sapientNodeID)
			_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: entities,
			})
			if err != nil {
				logger.Error("failed to push status update", "error", err)
			}

		case "alert":
			a := msg.GetAlert()
			logger.Info("received alert",
				"alert_id", a.GetAlertId(),
				"type", a.GetAlertType(),
				"description", a.GetDescription())

		case "task_ack":
			ta := msg.GetTaskAck()
			logger.Info("received task ack",
				"task_id", ta.GetTaskId(),
				"status", ta.GetTaskStatus())

		default:
			logger.Debug("received unhandled message type",
				"type", sapient.ContentType(msg),
				"from", sapientNodeID)
		}
	}
}

// SendTask sends a SAPIENT Task message via the peer connection.
func SendTask(conn *sapient.Conn, nodeID, destinationID string, task *sapientpb.Task) error {
	return conn.SendTask(nodeID, destinationID, task)
}

// SendModeChange sends a mode change task to a SAPIENT node via the peer connection.
func SendModeChange(conn *sapient.Conn, nodeID, destinationID, mode string) error {
	task := sapient.NewTask(sapientpb.Task_CONTROL_START).
		ModeChange(mode).
		Build()
	return conn.SendTask(nodeID, destinationID, task)
}
