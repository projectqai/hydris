package engine

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fatih/color"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/metrics"
	"github.com/projectqai/hydris/policy"
	"github.com/projectqai/hydris/version"
	"github.com/projectqai/hydris/view"
	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/_goconnect"

	"connectrpc.com/connect"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"reflect"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type WorldServer struct {
	l sync.RWMutex

	bus *Bus

	// currently live, ordered by id
	head  map[string]*pb.Entity
	store *Store

	frozen   atomic.Bool
	frozenAt time.Time

	// worldFile is the path to persist world state (if set)
	worldFile string

	// policy is optional OPA policy engine for authorization
	policy *policy.Engine

	// nodeID is the stable unique identifier for this node
	nodeID     string
	nodeEntity *pb.Entity
}

func NewWorldServer() *WorldServer {
	server := &WorldServer{
		bus:   NewBus(),
		head:  make(map[string]*pb.Entity),
		store: NewStore(),
	}

	// Start garbage collection ticker
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for range ticker.C {
			server.gc()
		}
	}()

	return server
}

// hardwareNodeID derives a stable node identifier from hardware characteristics.
// It tries /etc/machine-id first, then falls back to hashing MAC addresses,
// then to a random ID as a last resort.
func hardwareNodeID() string {
	// Try /etc/machine-id (Linux, systemd-based)
	if mid, err := os.ReadFile("/etc/machine-id"); err == nil {
		id := strings.TrimSpace(string(mid))
		if len(id) >= 16 {
			return id[:16]
		}
	}

	// Fallback: hash MAC addresses of network interfaces
	ifaces, err := net.Interfaces()
	if err == nil {
		var macs []string
		for _, iface := range ifaces {
			mac := iface.HardwareAddr.String()
			if mac != "" {
				macs = append(macs, mac)
			}
		}
		slices.Sort(macs)
		if len(macs) > 0 {
			h := sha256.Sum256([]byte(strings.Join(macs, ",")))
			return hex.EncodeToString(h[:16])
		}
	}

	// Last resort: random
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("failed to generate node identity: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// InitNodeIdentity finds or creates a stable node identity.
// It looks for an existing entity with a DeviceComponent containing a NodeDevice.
// If none is found, it derives one from hardware MAC addresses.
func (s *WorldServer) InitNodeIdentity() {
	s.l.Lock()
	defer s.l.Unlock()

	// Look for an existing node device entity
	for _, e := range s.head {
		if e.Device != nil && e.Device.Node != nil && strings.HasPrefix(e.Id, "node.") {
			s.nodeID = strings.TrimPrefix(e.Id, "node.")
			s.nodeEntity = e
			slog.Info("using existing node identity", "nodeID", s.nodeID, "entityID", e.Id)
			return
		}
	}

	s.nodeID = hardwareNodeID()

	hostname, _ := os.Hostname()
	numCPU := uint32(runtime.NumCPU())

	s.nodeEntity = &pb.Entity{
		Id: "node." + s.nodeID,
		Device: &pb.DeviceComponent{
			Node: &pb.NodeDevice{
				Hostname: &hostname,
				Os:       strPtr(runtime.GOOS),
				Arch:     strPtr(runtime.GOARCH),
				NumCpu:   &numCPU,
			},
		},
		Controller: &pb.Controller{
			Node: &s.nodeID,
		},
	}

	s.head[s.nodeEntity.Id] = s.nodeEntity
	s.bus.Dirty(s.nodeEntity.Id, s.nodeEntity, pb.EntityChange_EntityChangeUpdated)

	slog.Info("created new node identity", "nodeID", s.nodeID, "entityID", s.nodeEntity.Id)
}

func strPtr(s string) *string { return &s }

// SetWorldFile sets the path for world state persistence
func (s *WorldServer) SetWorldFile(path string) {
	s.worldFile = path
}

func (s *WorldServer) GetHead(id string) *pb.Entity {
	s.l.RLock()
	defer s.l.RUnlock()
	return s.head[id]
}

func (s *WorldServer) ListEntities(ctx context.Context, req *connect.Request[pb.ListEntitiesRequest]) (*connect.Response[pb.ListEntitiesResponse], error) {
	ability := policy.For(s.policy, req.Peer().Addr)

	s.l.RLock()
	defer s.l.RUnlock()

	el := make([]*pb.Entity, 0, len(s.head))
	for _, v := range s.head {
		if !s.matchesListEntitiesRequest(v, req.Msg) {
			continue
		}
		if !ability.CanRead(ctx, v) {
			continue
		}
		el = append(el, v)
	}
	slices.SortFunc(el, func(a, b *pb.Entity) int { return strings.Compare(a.Id, b.Id) })

	response := &pb.ListEntitiesResponse{
		Entities: el,
	}
	return connect.NewResponse(response), nil
}

func (s *WorldServer) GetEntity(ctx context.Context, req *connect.Request[pb.GetEntityRequest]) (*connect.Response[pb.GetEntityResponse], error) {
	s.l.RLock()
	defer s.l.RUnlock()

	entity, exists := s.head[req.Msg.Id]
	if !exists {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("entity with id %s not found", req.Msg.Id))
	}

	if !policy.For(s.policy, req.Peer().Addr).CanRead(ctx, entity) {
		return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("policy denied read"))
	}

	response := &pb.GetEntityResponse{
		Entity: entity,
	}
	return connect.NewResponse(response), nil
}

func (s *WorldServer) GetLocalNode(ctx context.Context, req *connect.Request[pb.GetLocalNodeRequest]) (*connect.Response[pb.GetLocalNodeResponse], error) {
	if s.nodeEntity == nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("no local node entity"))
	}
	return connect.NewResponse(&pb.GetLocalNodeResponse{Entity: s.nodeEntity, NodeId: s.nodeID}), nil
}

func (s *WorldServer) Push(ctx context.Context, req *connect.Request[pb.EntityChangeRequest]) (*connect.Response[pb.EntityChangeResponse], error) {
	ability := policy.For(s.policy, req.Peer().Addr)
	for _, e := range req.Msg.Changes {
		if err := ability.AuthorizeWrite(ctx, e); err != nil {
			return nil, err
		}
	}

	s.l.Lock()
	defer s.l.Unlock()
	for _, e := range req.Msg.Changes {

		if e.Lifetime == nil {
			e.Lifetime = &pb.Lifetime{}
		}

		if !e.Lifetime.From.IsValid() {
			e.Lifetime.From = timestamppb.Now()
		}

		// Stamp controller node so downstream consumers know which node produced this entity
		if s.nodeID != "" {
			if e.Controller == nil {
				e.Controller = &pb.Controller{}
			}
			if e.Controller.Node == nil {
				e.Controller.Node = &s.nodeID
			}
		}

		_ = s.store.Push(ctx, Event{Entity: e})
		if !s.frozen.Load() {
			if existing, ok := s.head[e.Id]; ok {
				merged := mergeEntity(existing, e)
				s.head[e.Id] = merged
			} else {
				s.head[e.Id] = e
			}
			s.bus.Dirty(e.Id, s.head[e.Id], pb.EntityChange_EntityChangeUpdated)
		}
	}

	response := &pb.EntityChangeResponse{
		Accepted: true,
	}

	return connect.NewResponse(response), nil
}

func (s *WorldServer) ExpireEntity(ctx context.Context, req *connect.Request[pb.ExpireEntityRequest]) (*connect.Response[pb.ExpireEntityResponse], error) {
	s.l.Lock()
	defer s.l.Unlock()

	entity, exists := s.head[req.Msg.Id]
	if !exists {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("entity with id %s not found", req.Msg.Id))
	}

	if err := policy.For(s.policy, req.Peer().Addr).AuthorizeWrite(ctx, entity); err != nil {
		return nil, err
	}

	if entity.Lifetime == nil {
		entity.Lifetime = &pb.Lifetime{}
	}
	entity.Lifetime.Until = timestamppb.Now()

	s.bus.Dirty(entity.Id, entity, pb.EntityChange_EntityChangeUpdated)

	return connect.NewResponse(&pb.ExpireEntityResponse{}), nil
}

// EngineConfig holds configuration for starting the engine
type EngineConfig struct {
	WorldFile  string
	PolicyFile string
	NoDefaults bool
}

// StartEngine starts the Hydris engine and returns the server address.
// If worldFile is provided, it loads entities from that file on startup
// and periodically flushes the current state back to the file.
func StartEngine(ctx context.Context, cfg EngineConfig) (string, error) {
	engine := NewWorldServer()

	// Set up world file persistence if specified
	if cfg.WorldFile != "" {
		engine.worldFile = cfg.WorldFile

		// Load existing state from file
		if err := engine.LoadFromFile(cfg.WorldFile); err != nil {
			return "", fmt.Errorf("failed to load world file: %w", err)
		}

		// Start periodic flushing (every 10 seconds)
		engine.StartPeriodicFlush(10 * time.Second)
	}

	// Load builtin defaults if no entities were loaded and defaults are not disabled
	if !cfg.NoDefaults && engine.EntityCount() == 0 {
		if err := engine.LoadFromBytes(builtin.DefaultWorld); err != nil {
			slog.Warn("failed to load default world", "error", err)
		}
	}

	// Initialize stable node identity (after loading world state)
	engine.InitNodeIdentity()

	// Set up OPA policy engine if specified
	if cfg.PolicyFile != "" {
		policyEngine, err := policy.NewEngine(cfg.PolicyFile)
		if err != nil {
			return "", fmt.Errorf("failed to load policy: %w", err)
		}
		engine.policy = policyEngine
	}

	// Initialize Prometheus exporter and OpenTelemetry metrics
	promHandler, err := metrics.InitPrometheus()
	if err != nil {
		return "", fmt.Errorf("failed to initialize prometheus: %w", err)
	}

	if err := metrics.Init(); err != nil {
		return "", fmt.Errorf("failed to initialize metrics: %w", err)
	}

	// Start metrics updater
	StartMetricsUpdater(engine)

	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = "50051"
	}

	// Create HTTP handlers
	mux := http.NewServeMux()

	worldPath, worldHandler := _goconnect.NewWorldServiceHandler(engine)
	mux.Handle(worldPath, worldHandler)

	timelinePath, timelineHandler := _goconnect.NewTimelineServiceHandler(engine)
	mux.Handle(timelinePath, timelineHandler)

	controllerPath, controllerHandler := _goconnect.NewControllerServiceHandler(engine)
	mux.Handle(controllerPath, controllerHandler)

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("OK"))
	})

	// Prometheus metrics endpoint
	mux.Handle("/metrics", promHandler)

	webServer, err := view.NewWebServer()
	if err != nil {
		return "", fmt.Errorf("failed to create web server: %w", err)
	}
	mux.Handle("/", webServer)

	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	httpServer := &http.Server{
		Addr:    ":" + port,
		Handler: h2c.NewHandler(corsHandler.Handler(mux), &http2.Server{}),
	}

	// Create listener first to fail fast if port is in use
	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return "", fmt.Errorf("failed to listen on port %s: %v", port, err)
	}

	localIPs := getAllLocalIPs()
	green := color.New(color.FgGreen)
	cyan := color.New(color.FgCyan)
	bold := color.New(color.Bold)

	fmt.Println()
	_, _ = green.Print("  ➜ ")
	_, _ = bold.Print("Hydris World Server ")
	fmt.Printf("(%s)", version.Version)
	fmt.Println(" running at:")
	_, _ = green.Print("  ➜ ")
	fmt.Print("Local:   ")
	_, _ = cyan.Printf("http://localhost:%s\n", port)

	for _, ip := range localIPs {
		_, _ = green.Print("  ➜ ")
		fmt.Print("Network: ")
		_, _ = cyan.Printf("http://%s:%s\n", ip, port)
	}
	fmt.Println()

	go func() {
		if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Start in-process server for builtin services
	builtinServer := &http.Server{
		Handler: h2c.NewHandler(mux, &http2.Server{}),
	}
	go func() {
		if err := builtinServer.Serve(builtin.GetBuiltinListener()); err != nil && err != http.ErrServerClosed {
			slog.Error("builtin server error", "error", err)
			os.Exit(1)
		}
	}()

	go func() {
		<-ctx.Done()
		_ = httpServer.Shutdown(context.Background())
		_ = builtinServer.Shutdown(context.Background())
	}()

	return "localhost:" + port, nil
}

// mergeEntity overwrites fields in dst with non-nil fields from src.
// Components are replaced entirely, not recursively merged.
func mergeEntity(dst, src *pb.Entity) *pb.Entity {
	merged := proto.Clone(dst).(*pb.Entity)
	srcV := reflect.ValueOf(src).Elem()
	mergedV := reflect.ValueOf(merged).Elem()
	for i := 0; i < srcV.NumField(); i++ {
		sf := srcV.Field(i)
		if sf.Kind() == reflect.Ptr && !sf.IsNil() {
			mf := mergedV.Field(i)
			if mf.CanSet() {
				mf.Set(sf)
			}
		}
	}
	return merged
}
