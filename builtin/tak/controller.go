package view

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync/atomic"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/cot"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/structpb"
)

var (
	verbose     bool
	clientCount atomic.Int32
)

func handleClient(conn net.Conn, serverURL string, logger *slog.Logger, trackerID string) {
	clientID := clientCount.Add(1)
	logger.Info("Client connected", "clientID", clientID, "remoteAddr", conn.RemoteAddr())

	defer func() { _ = conn.Close() }()
	defer func() {
		clientCount.Add(-1)
		logger.Info("Client disconnected", "clientID", clientID)
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	grpcConn, err := grpc.NewClient(serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		logger.Error("gRPC connection failed", "clientID", clientID, "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	// Start goroutine to read incoming data from TAK client
	go func() {
		defer cancel() // Signal main goroutine to exit when reader fails
		reader := bufio.NewReader(conn)
		buffer := make([]byte, 8192)
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			n, err := reader.Read(buffer)
			if err != nil {
				logger.Error("Read error (client disconnected)", "clientID", clientID, "error", err)
				return
			}
			if n > 0 {
				logger.Info("Received bytes from TAK client", "clientID", clientID, "bytes", n)
				if verbose {
					logger.Debug("RAW STRING", "clientID", clientID, "data", string(buffer[:n]))
				}

				data := string(buffer[:n])

				// Respond to pings (type="t-x-c-t")
				if strings.Contains(data, `type="t-x-c-t"`) {
					logger.Debug("Detected ping, sending pong response", "clientID", clientID)
					// Echo the ping back as a pong
					if _, err := conn.Write(buffer[:n]); err != nil {
						logger.Error("Pong write error", "clientID", clientID, "error", err)
						return
					}
				}

				// Parse and push position reports (type="a-f-G-U-C" and similar)
				if strings.Contains(data, `type="a-`) && !strings.Contains(data, `type="t-`) {
					logger.Debug("Detected position report, parsing and pushing to Hydris", "clientID", clientID)
					entity, err := cot.CoTToEntity(buffer[:n], "tak", trackerID)
					if err != nil {
						logger.Error("Error parsing CoT", "clientID", clientID, "error", err)
					} else {
						entity.Id = fmt.Sprintf("tak.%s", entity.Id)
						logger.Debug("Parsed entity", "clientID", clientID, "id", entity.Id,
							"callsign", *entity.Label, "lat", entity.Geo.Latitude, "lon", entity.Geo.Longitude)

						// Push entity to Hydris
						_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{entity}})
						if err != nil {
							logger.Error("Error pushing to Hydris", "clientID", clientID, "error", err)
						} else {
							logger.Info("Successfully pushed entity to Hydris", "clientID", clientID, "entityID", entity.Id)
						}
					}
				}
			}
		}
	}()
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{})
	if err != nil {
		logger.Error("WatchEntities failed", "clientID", clientID, "error", err)
		return
	}

	writer := bufio.NewWriter(conn)
	sentCount := 0

	for {
		event, err := stream.Recv()
		if err != nil {
			logger.Error("Stream error", "clientID", clientID, "error", err)
			return
		}

		if event.Entity == nil {
			continue
		}

		var cotXML []byte
		var cotErr error
		if event.T == pb.EntityChange_EntityChangeExpired {
			cotXML, cotErr = cot.EntityDeleteCoT(event.Entity)
		} else {
			cotXML, cotErr = cot.EntityToCoT(event.Entity)
		}
		if cotErr != nil {
			logger.Error("Error converting entity", "clientID", clientID, "entityID", event.Entity.Id, "error", cotErr)
			continue
		}

		if cotXML == nil {
			continue
		}

		if verbose {
			logger.Debug("CoT XML", "clientID", clientID, "entityID", event.Entity.Id, "xml", string(cotXML))
		}

		logger.Info("Sending bytes to TAK client", "clientID", clientID, "bytes", len(cotXML))
		if _, err := writer.Write(cotXML); err != nil {
			logger.Error("Write error", "clientID", clientID, "error", err)
			return
		}

		if err := writer.Flush(); err != nil {
			logger.Error("Flush error", "clientID", clientID, "error", err)
			return
		}

		sentCount++
		if !verbose {
			logger.Info("Sent entity", "clientID", clientID, "entityID", event.Entity.Id, "total", sentCount)
		}
	}
}

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	controllerName := "tak"

	serverSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"listen": map[string]any{"type": "string", "description": "TCP listen address (e.g. :8088)"},
		},
	})
	multicastSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"address":     map[string]any{"type": "string", "description": "Multicast address (e.g. 239.2.3.1:6969)"},
			"max_rate_hz": map[string]any{"type": "number"},
		},
	})

	if err := controller.PublishDevice(ctx, controllerName+".service", controllerName, []*pb.Configurable{
		{Key: "cot.server.v0", Schema: serverSchema},
		{Key: "cot.multicast.v0", Schema: multicastSchema},
	}, nil, nil); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	return controller.Run1to1(ctx, controllerName, func(ctx context.Context, config *pb.Entity, _ *pb.Entity) error {
		return runInstance(ctx, logger, serverURL, config)
	})
}

func runInstance(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	config := entity.Config
	if config == nil {
		return fmt.Errorf("entity %s has no config", entity.Id)
	}

	switch config.Key {
	case "cot.server.v0":
		return runServer(ctx, logger, serverURL, entity)
	case "cot.multicast.v0":
		return runMulticast(ctx, logger, serverURL, entity)
	default:
		return fmt.Errorf("unknown config key: %s", config.Key)
	}
}

func runServer(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	config := entity.Config
	listenAddr := ":8088"

	if config.Value != nil && config.Value.Fields != nil {
		if addr, ok := config.Value.Fields["listen"]; ok {
			listenAddr = addr.GetStringValue()
		}
	}

	for {
		select {
		case <-ctx.Done():
			logger.Info("TAK server shutting down", "entityID", entity.Id)
			return ctx.Err()
		default:
		}

		logger.Info("Starting TAK server", "entityID", entity.Id, "listenAddr", listenAddr)

		listener, err := net.Listen("tcp", listenAddr)
		if err != nil {
			logger.Error("Failed to start server, retrying in 5s", "entityID", entity.Id, "listenAddr", listenAddr, "error", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(5 * time.Second):
				continue
			}
		}

		logger.Info("TAK server listening", "entityID", entity.Id, "listenAddr", listenAddr)

		// Spawn watcher to close listener when context is cancelled
		done := make(chan struct{})
		go func() {
			select {
			case <-ctx.Done():
				_ = listener.Close()
			case <-done:
			}
		}()

		acceptErr := false
		for {
			conn, err := listener.Accept()
			if err != nil {
				if ctx.Err() != nil {
					close(done)
					_ = listener.Close()
					return ctx.Err()
				}
				logger.Error("Accept error, restarting server in 5s", "entityID", entity.Id, "error", err)
				acceptErr = true
				break
			}
			go handleClient(conn, serverURL, logger, entity.Id)
		}

		close(done)
		_ = listener.Close()

		if !acceptErr {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
			continue
		}
	}
}

func runMulticast(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	config := entity.Config
	multicastAddr := "239.2.3.1:6969"
	var maxRateHz float32

	if config.Value != nil && config.Value.Fields != nil {
		if addr, ok := config.Value.Fields["address"]; ok {
			multicastAddr = addr.GetStringValue()
		}
		if rateLimit, ok := config.Value.Fields["max_rate_hz"]; ok {
			maxRateHz = float32(rateLimit.GetNumberValue())
		}
	}

	for {
		select {
		case <-ctx.Done():
			logger.Info("UDP multicast shutting down", "entityID", entity.Id)
			return ctx.Err()
		default:
		}

		logger.Info("Starting UDP multicast", "entityID", entity.Id, "multicastAddr", multicastAddr, "maxRateHz", maxRateHz)

		err := runMulticastBroadcaster(ctx, logger, serverURL, multicastAddr, maxRateHz)
		if ctx.Err() != nil {
			return ctx.Err()
		}

		logger.Error("Multicast error, retrying in 5s", "entityID", entity.Id, "error", err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
			continue
		}
	}
}

func runMulticastBroadcaster(ctx context.Context, logger *slog.Logger, serverURL string, multicastAddress string, maxRateHz float32) error {
	multicastAddr, err := net.ResolveUDPAddr("udp", multicastAddress)
	if err != nil {
		return err
	}

	localAddr, err := net.ResolveUDPAddr("udp", "0.0.0.0:0")
	if err != nil {
		return err
	}

	udpConn, err := net.DialUDP("udp", localAddr, multicastAddr)
	if err != nil {
		return err
	}
	defer func() { _ = udpConn.Close() }()

	logger.Info("UDP multicast connection", "local", udpConn.LocalAddr(), "multicast", multicastAddress)

	grpcConn, err := grpc.NewClient(serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	// Build request with optional rate limiter
	req := &pb.ListEntitiesRequest{}
	if maxRateHz > 0 {
		req.Behaviour = &pb.WatchBehavior{
			MaxRateHz: &maxRateHz,
		}
		logger.Info("Rate limiting enabled", "maxRateHz", maxRateHz)
	}

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, req)
	if err != nil {
		return err
	}

	sentCount := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil {
			continue
		}

		var cotXML []byte
		var cotErr error
		if event.T == pb.EntityChange_EntityChangeExpired {
			cotXML, cotErr = cot.EntityDeleteCoT(event.Entity)
		} else {
			cotXML, cotErr = cot.EntityToCoT(event.Entity)
		}
		if cotErr != nil {
			logger.Error("Error converting entity", "entityID", event.Entity.Id, "error", cotErr)
			continue
		}

		if cotXML == nil {
			continue
		}

		if verbose {
			logger.Debug("CoT XML", "entityID", event.Entity.Id, "xml", string(cotXML))
		}

		if _, err := udpConn.Write(cotXML); err != nil {
			logger.Error("UDP write error", "error", err)
			continue
		}

		sentCount++
	}
}

func init() {
	builtin.Register("tak", Run)
}
