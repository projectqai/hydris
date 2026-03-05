package view

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	"github.com/projectqai/hydris/pkg/cot"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

var (
	verbose     bool
	clientCount atomic.Int32
)

// handleConn runs bidirectional CoT streaming on a TCP connection.
// It reads inbound CoT from the remote side (parsing and pushing to Hydris)
// and writes outbound entity changes as CoT XML.
func handleConn(ctx context.Context, conn net.Conn, serverURL string, logger *slog.Logger, trackerID string) {
	clientID := clientCount.Add(1)
	logger.Info("Connection active", "clientID", clientID, "remoteAddr", conn.RemoteAddr())

	defer func() {
		clientCount.Add(-1)
		logger.Info("Connection closed", "clientID", clientID)
	}()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	grpcConn, err := grpc.NewClient(serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		logger.Error("gRPC connection failed", "clientID", clientID, "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	// Read incoming CoT from remote side
	go func() {
		defer cancel()
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
				logger.Error("Read error", "clientID", clientID, "error", err)
				return
			}
			if n > 0 {
				logger.Info("Received bytes", "clientID", clientID, "bytes", n)
				if verbose {
					logger.Debug("RAW STRING", "clientID", clientID, "data", string(buffer[:n]))
				}

				data := string(buffer[:n])

				if strings.Contains(data, `type="t-x-c-t"`) {
					logger.Debug("Detected ping, sending pong", "clientID", clientID)
					if _, err := conn.Write(buffer[:n]); err != nil {
						logger.Error("Pong write error", "clientID", clientID, "error", err)
						return
					}
				}

				if strings.Contains(data, `type="a-`) && !strings.Contains(data, `type="t-`) {
					entity, err := cot.CoTToEntity(buffer[:n], "tak", trackerID)
					if err != nil {
						logger.Error("Error parsing CoT", "clientID", clientID, "error", err)
					} else {
						entity.Id = fmt.Sprintf("tak.%s", entity.Id)
						logger.Debug("Parsed entity", "clientID", clientID, "id", entity.Id,
							"callsign", *entity.Label, "lat", entity.Geo.Latitude, "lon", entity.Geo.Longitude)

						if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{entity}}); err != nil {
							logger.Error("Error pushing to Hydris", "clientID", clientID, "error", err)
						} else {
							logger.Info("Pushed entity", "clientID", clientID, "entityID", entity.Id)
						}
					}
				}
			}
		}
	}()

	// Write outbound entity changes as CoT XML
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

		if _, err := writer.Write(cotXML); err != nil {
			logger.Error("Write error", "clientID", clientID, "error", err)
			return
		}

		if err := writer.Flush(); err != nil {
			logger.Error("Flush error", "clientID", clientID, "error", err)
			return
		}

		sentCount++
		logger.Info("Sent entity", "clientID", clientID, "entityID", event.Entity.Id, "total", sentCount)
	}
}

var globalServerURL string

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	globalServerURL = serverURL
	controllerName := "tak"

	tcpServerSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"listen": map[string]any{
				"type":           "string",
				"title":          "Listen Address",
				"description":    "TCP address to accept incoming TAK connections",
				"default":        ":8088",
				"ui:placeholder": "e.g. :8088 or 0.0.0.0:8088",
			},
		},
	})

	tcpClientSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"ui:groups": []any{
			map[string]any{"key": "connection", "title": "Connection"},
			map[string]any{"key": "tls", "title": "TLS", "collapsed": true},
		},
		"properties": map[string]any{
			"address": map[string]any{
				"type":           "string",
				"title":          "Address",
				"description":    "Remote TAK server address",
				"ui:placeholder": "e.g. tak-server:8088",
				"ui:group":       "connection",
				"ui:order":       0,
			},
			"tls": map[string]any{
				"type":        "boolean",
				"title":       "Enable TLS",
				"description": "Connect using TLS encryption",
				"default":     false,
				"ui:group":    "tls",
				"ui:order":    0,
			},
			"tls_skip_verify": map[string]any{
				"type":        "boolean",
				"title":       "Skip Certificate Verification",
				"description": "Accept any server certificate (insecure)",
				"default":     false,
				"ui:group":    "tls",
				"ui:order":    1,
			},
			"tls_cert": map[string]any{
				"type":           "string",
				"title":          "Client Certificate",
				"description":    "Path to client certificate PEM file",
				"ui:placeholder": "e.g. ./certs/client.pem",
				"ui:group":       "tls",
				"ui:order":       2,
			},
			"tls_key": map[string]any{
				"type":           "string",
				"title":          "Client Key",
				"description":    "Path to client key PEM file",
				"ui:placeholder": "e.g. ./certs/client-key.pem",
				"ui:group":       "tls",
				"ui:order":       3,
			},
			"tls_ca": map[string]any{
				"type":           "string",
				"title":          "CA Certificate",
				"description":    "Path to CA certificate PEM file",
				"ui:placeholder": "e.g. ./certs/ca.pem",
				"ui:group":       "tls",
				"ui:order":       4,
			},
		},
		"required": []any{"address"},
	})

	udpSendSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"address": map[string]any{
				"type":           "string",
				"title":          "Destination Address",
				"description":    "UDP destination address",
				"ui:placeholder": "e.g. 192.168.1.100:4242",
				"ui:order":       0,
			},
			"max_rate_hz": map[string]any{
				"type":        "number",
				"title":       "Max Rate",
				"description": "Maximum entity broadcast rate (0 = unlimited)",
				"default":     0,
				"minimum":     0,
				"ui:unit":     "Hz",
				"ui:order":    1,
			},
		},
		"required": []any{"address"},
	})

	udpReceiveSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"listen": map[string]any{
				"type":           "string",
				"title":          "Listen Address",
				"description":    "UDP address to receive CoT data",
				"ui:placeholder": "e.g. :4242 or 0.0.0.0:4242",
			},
		},
		"required": []any{"listen"},
	})

	multicastSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"address": map[string]any{
				"type":           "string",
				"title":          "Multicast Address",
				"description":    "UDP multicast group address",
				"default":        "239.2.3.1:6969",
				"ui:placeholder": "e.g. 239.2.3.1:6969",
				"ui:order":       0,
			},
			"max_rate_hz": map[string]any{
				"type":        "number",
				"title":       "Max Rate",
				"description": "Maximum entity broadcast rate (0 = unlimited)",
				"default":     0,
				"minimum":     0,
				"ui:unit":     "Hz",
				"ui:order":    1,
			},
		},
	})

	serviceID := controllerName + ".service"

	if err := controller.Push(ctx, &pb.Entity{
		Id:    serviceID,
		Label: proto.String("TAK"),
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
		},
		Configurable: &pb.ConfigurableComponent{
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{Class: "tcp_server", Label: "TCP Server"},
				{Class: "tcp_client", Label: "TCP Client"},
				{Class: "udp_send", Label: "UDP Send"},
				{Class: "udp_receive", Label: "UDP Receive"},
				{Class: "multicast", Label: "Multicast"},
			},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("radio"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "tcp_server", Label: "TCP Server", Schema: tcpServerSchema},
		{Class: "tcp_client", Label: "TCP Client", Schema: tcpClientSchema},
		{Class: "udp_send", Label: "UDP Send", Schema: udpSendSchema},
		{Class: "udp_receive", Label: "UDP Receive", Schema: udpReceiveSchema},
		{Class: "multicast", Label: "Multicast", Schema: multicastSchema},
	}

	return controller.WatchChildren(ctx, serviceID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			ready()
			switch entity.Device.GetClass() {
			case "tcp_server":
				return runTcpServer(ctx, logger, globalServerURL, entity)
			case "tcp_client":
				return runTcpClient(ctx, logger, globalServerURL, entity)
			case "udp_send":
				return runUdpSend(ctx, logger, globalServerURL, entity)
			case "udp_receive":
				return runUdpReceive(ctx, logger, globalServerURL, entity)
			case "multicast":
				return runMulticast(ctx, logger, globalServerURL, entity)
			}
			return fmt.Errorf("unknown device class: %s", entity.Device.GetClass())
		})
	})
}

func configString(entity *pb.Entity, key, fallback string) string {
	if entity.Config != nil && entity.Config.Value != nil && entity.Config.Value.Fields != nil {
		if v, ok := entity.Config.Value.Fields[key]; ok && v.GetStringValue() != "" {
			return v.GetStringValue()
		}
	}
	return fallback
}

func configFloat32(entity *pb.Entity, key string, fallback float32) float32 {
	if entity.Config != nil && entity.Config.Value != nil && entity.Config.Value.Fields != nil {
		if v, ok := entity.Config.Value.Fields[key]; ok {
			return float32(v.GetNumberValue())
		}
	}
	return fallback
}

func configBool(entity *pb.Entity, key string) bool {
	if entity.Config != nil && entity.Config.Value != nil && entity.Config.Value.Fields != nil {
		if v, ok := entity.Config.Value.Fields[key]; ok {
			return v.GetBoolValue()
		}
	}
	return false
}

// --- TCP Server ---

func runTcpServer(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	listenAddr := configString(entity, "listen", ":8088")

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		logger.Info("Starting TAK TCP server", "entityID", entity.Id, "listenAddr", listenAddr)

		listener, err := net.Listen("tcp", listenAddr)
		if err != nil {
			logger.Error("Failed to start server, retrying in 5s", "entityID", entity.Id, "error", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(5 * time.Second):
				continue
			}
		}

		logger.Info("TAK TCP server listening", "entityID", entity.Id, "listenAddr", listenAddr)

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
				logger.Error("Accept error, restarting in 5s", "entityID", entity.Id, "error", err)
				acceptErr = true
				break
			}
			go handleConn(ctx, conn, serverURL, logger, entity.Id)
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

// --- TCP Client ---

func buildTLSConfig(entity *pb.Entity) (*tls.Config, error) {
	tlsConf := &tls.Config{}

	if configBool(entity, "tls_skip_verify") {
		tlsConf.InsecureSkipVerify = true
	}

	certPath := configString(entity, "tls_cert", "")
	keyPath := configString(entity, "tls_key", "")
	if certPath != "" && keyPath != "" {
		if err := builtin.ValidatePath(certPath); err != nil {
			return nil, fmt.Errorf("tls_cert: %w", err)
		}
		if err := builtin.ValidatePath(keyPath); err != nil {
			return nil, fmt.Errorf("tls_key: %w", err)
		}
		cert, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return nil, fmt.Errorf("load client certificate: %w", err)
		}
		tlsConf.Certificates = []tls.Certificate{cert}
	}

	caPath := configString(entity, "tls_ca", "")
	if caPath != "" {
		if err := builtin.ValidatePath(caPath); err != nil {
			return nil, fmt.Errorf("tls_ca: %w", err)
		}
		caCert, err := os.ReadFile(caPath)
		if err != nil {
			return nil, fmt.Errorf("read CA certificate: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caCert) {
			return nil, fmt.Errorf("failed to parse CA certificate from %s", caPath)
		}
		tlsConf.RootCAs = pool
	}

	return tlsConf, nil
}

func runTcpClient(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	address := configString(entity, "address", "")
	if address == "" {
		return fmt.Errorf("address is required")
	}
	useTLS := configBool(entity, "tls")

	var tlsConf *tls.Config
	if useTLS {
		var err error
		tlsConf, err = buildTLSConfig(entity)
		if err != nil {
			return err
		}
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		logger.Info("Connecting to TAK server", "entityID", entity.Id, "address", address, "tls", useTLS)

		var conn net.Conn
		var err error
		if useTLS {
			conn, err = tls.Dial("tcp", address, tlsConf)
		} else {
			conn, err = net.Dial("tcp", address)
		}
		if err != nil {
			logger.Error("Connection failed, retrying in 5s", "entityID", entity.Id, "error", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(5 * time.Second):
				continue
			}
		}

		logger.Info("Connected to TAK server", "entityID", entity.Id, "address", address)

		// handleConn blocks until the connection drops
		done := make(chan struct{})
		go func() {
			select {
			case <-ctx.Done():
				_ = conn.Close()
			case <-done:
			}
		}()

		handleConn(ctx, conn, serverURL, logger, entity.Id)
		_ = conn.Close()
		close(done)

		if ctx.Err() != nil {
			return ctx.Err()
		}

		logger.Info("Disconnected, reconnecting in 5s", "entityID", entity.Id)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
			continue
		}
	}
}

// --- UDP Send ---

func runUdpSend(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	address := configString(entity, "address", "")
	if address == "" {
		return fmt.Errorf("address is required")
	}
	maxRateHz := configFloat32(entity, "max_rate_hz", 0)

	destAddr, err := net.ResolveUDPAddr("udp", address)
	if err != nil {
		return fmt.Errorf("resolve address: %w", err)
	}

	udpConn, err := net.DialUDP("udp", nil, destAddr)
	if err != nil {
		return fmt.Errorf("dial UDP: %w", err)
	}
	defer func() { _ = udpConn.Close() }()

	logger.Info("UDP send started", "entityID", entity.Id, "destination", address)

	grpcConn, err := grpc.NewClient(serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	req := &pb.ListEntitiesRequest{}
	if maxRateHz > 0 {
		req.Behaviour = &pb.WatchBehavior{MaxRateHz: &maxRateHz}
		logger.Info("Rate limiting enabled", "maxRateHz", maxRateHz)
	}

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, req)
	if err != nil {
		return err
	}

	var entitiesSent uint64
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

		cotXML, cotErr := entityToCoTBytes(event)
		if cotErr != nil {
			logger.Error("Error converting entity", "entityID", event.Entity.Id, "error", cotErr)
			continue
		}
		if cotXML == nil {
			continue
		}

		if _, err := udpConn.Write(cotXML); err != nil {
			logger.Error("UDP write error", "error", err)
			continue
		}

		entitiesSent++
		_, _ = client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: entity.Id,
				Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
					{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("entities sent"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: entitiesSent}},
				}},
			}},
		})
	}
}

// --- UDP Receive ---

func runUdpReceive(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	listenAddr := configString(entity, "listen", "")
	if listenAddr == "" {
		return fmt.Errorf("listen address is required")
	}

	addr, err := net.ResolveUDPAddr("udp", listenAddr)
	if err != nil {
		return fmt.Errorf("resolve listen address: %w", err)
	}

	udpConn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return fmt.Errorf("listen UDP: %w", err)
	}
	defer func() { _ = udpConn.Close() }()

	go func() {
		<-ctx.Done()
		_ = udpConn.Close()
	}()

	logger.Info("UDP receive started", "entityID", entity.Id, "listenAddr", listenAddr)

	grpcConn, err := grpc.NewClient(serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	buffer := make([]byte, 65535)
	var entitiesReceived uint64
	for {
		n, _, err := udpConn.ReadFromUDP(buffer)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			logger.Error("UDP read error", "error", err)
			continue
		}

		if n == 0 {
			continue
		}

		if verbose {
			logger.Debug("Received UDP datagram", "bytes", n, "data", string(buffer[:n]))
		}

		ent, err := cot.CoTToEntity(buffer[:n], "tak", entity.Id)
		if err != nil {
			logger.Error("Error parsing CoT", "error", err)
			continue
		}

		ent.Id = fmt.Sprintf("tak.%s", ent.Id)

		if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{ent}}); err != nil {
			logger.Error("Error pushing entity", "entityID", ent.Id, "error", err)
		} else {
			entitiesReceived++
			logger.Info("Pushed entity", "entityID", ent.Id)
			_, _ = client.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{{
					Id: entity.Id,
					Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
						{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("entities received"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: entitiesReceived}},
					}},
				}},
			})
		}
	}
}

// --- Multicast ---

func runMulticast(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	multicastAddr := configString(entity, "address", "239.2.3.1:6969")
	maxRateHz := configFloat32(entity, "max_rate_hz", 0)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		logger.Info("Starting UDP multicast", "entityID", entity.Id, "multicastAddr", multicastAddr, "maxRateHz", maxRateHz)

		err := runMulticastBroadcaster(ctx, logger, serverURL, entity.Id, multicastAddr, maxRateHz)
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

func runMulticastBroadcaster(ctx context.Context, logger *slog.Logger, serverURL string, entityID string, multicastAddress string, maxRateHz float32) error {
	mcastAddr, err := net.ResolveUDPAddr("udp", multicastAddress)
	if err != nil {
		return err
	}

	localAddr, err := net.ResolveUDPAddr("udp", "0.0.0.0:0")
	if err != nil {
		return err
	}

	udpConn, err := net.DialUDP("udp", localAddr, mcastAddr)
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

	req := &pb.ListEntitiesRequest{}
	if maxRateHz > 0 {
		req.Behaviour = &pb.WatchBehavior{MaxRateHz: &maxRateHz}
		logger.Info("Rate limiting enabled", "maxRateHz", maxRateHz)
	}

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, req)
	if err != nil {
		return err
	}

	var entitiesSent uint64
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

		cotXML, cotErr := entityToCoTBytes(event)
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

		entitiesSent++
		_, _ = client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: entityID,
				Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
					{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("entities sent"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: entitiesSent}},
				}},
			}},
		})
	}
}

// --- Helpers ---

func entityToCoTBytes(event *pb.EntityChangeEvent) ([]byte, error) {
	if event.T == pb.EntityChange_EntityChangeExpired {
		return cot.EntityDeleteCoT(event.Entity)
	}
	return cot.EntityToCoT(event.Entity)
}

func init() {
	builtin.Register("tak", Run)
}
