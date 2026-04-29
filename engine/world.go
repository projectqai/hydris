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
	_ "net/http/pprof"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/fatih/color"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/builtin/mediaserver"
	"github.com/projectqai/hydris/builtin/plugins"
	"github.com/projectqai/hydris/engine/transform"
	"github.com/projectqai/hydris/pkg/media"
	"github.com/projectqai/hydris/pkg/metrics"
	"github.com/projectqai/hydris/pkg/muxlistener"
	"github.com/projectqai/hydris/pkg/version"
	"github.com/projectqai/hydris/view"
	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/_goconnect"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// componentMeta tracks the lifetime of a single component field within an entity.
type componentMeta struct {
	fresh      time.Time // effective timestamp (fresh ?? from) of the push that wrote this component
	until      time.Time // expiry time; zero means no expiry
	noLifetime bool      // true if the push that wrote this component had no Lifetime at all
}

// entityState colocates an entity with its per-component lifetime metadata.
type entityState struct {
	entity     *pb.Entity
	lifetimes  map[int32]componentMeta // proto field number → meta
	hardExpire bool                    // set by ExpireEntity; GC removes unconditionally
}

func (es *entityState) isInfinite(protoNum int32) bool {
	m, ok := es.lifetimes[protoNum]
	if !ok || m.noLifetime {
		lt := es.entity.GetLifetime()
		return lt == nil || !lt.GetUntil().IsValid()
	}
	return m.until.IsZero()
}

// protoNumToFieldIdx maps proto field numbers to Go struct field indices for Entity.
var protoNumToFieldIdx map[int32]int

// lifetimeProtoNum is the proto field number of Entity.Lifetime.
const lifetimeProtoNum int32 = 4

func init() {
	t := reflect.TypeOf(pb.Entity{})
	protoNumToFieldIdx = make(map[int32]int)
	for i := 0; i < t.NumField(); i++ {
		if tag := t.Field(i).Tag.Get("protobuf"); tag != "" {
			for _, part := range strings.Split(tag, ",") {
				if n, err := strconv.Atoi(part); err == nil {
					protoNumToFieldIdx[int32(n)] = i
					break
				}
			}
		}
	}
}

type WorldServer struct {
	l sync.RWMutex

	bus *Bus

	// head maps entity IDs to their state (entity + per-component lifetimes).
	head map[string]*entityState

	// headView mirrors head's entities for the transform API (map[string]*pb.Entity).
	// Always kept in sync with head.
	headView map[string]*pb.Entity

	// worldFile is the path to persist world state (if set)
	worldFile string

	// persistNotify is signalled when a config change requires a debounced flush
	persistNotify chan struct{}

	// nodeID is the stable unique identifier for this node
	nodeID     string
	nodeEntity *pb.Entity

	// transformers manage derived entities (e.g. sensor coverage from sensor range)
	transformers     []transform.Transformer
	mediaTransformer *transform.MediaTransformer
	chatTransformer  *transform.ChatTransformer
}

func NewWorldServer() *WorldServer {
	mediaTransformer := transform.NewMediaTransformer()
	server := &WorldServer{
		bus:              NewBus(),
		head:             make(map[string]*entityState),
		headView:         make(map[string]*pb.Entity),
		mediaTransformer: mediaTransformer,
		chatTransformer:  transform.NewChatTransformer(),
		transformers: []transform.Transformer{
			transform.NewPolarNormalizeTransformer(),
			transform.NewPoseTransformer(),
			transform.NewCameraTransformer(),
			transform.NewAOUTransformer(),
			transform.NewShapeTransformer(),
			transform.NewClassificationTransformer(),
			mediaTransformer,
		},
	}
	server.transformers = append(server.transformers, server.chatTransformer)

	// Start garbage collection ticker
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for range ticker.C {
			server.GC()
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
	for _, es := range s.head {
		e := es.entity
		if e.Device != nil && e.Device.Node != nil && strings.HasPrefix(e.Id, "node.") {
			s.nodeID = strings.TrimPrefix(e.Id, "node.")
			s.nodeEntity = e
			s.fillNodeDeviceInfo(e.Device.Node)
			if s.chatTransformer != nil {
				s.chatTransformer.SetNodeEntityID(s.nodeEntity.Id)
			}
			slog.Info("using existing node identity", "nodeID", s.nodeID, "entityID", e.Id)
			s.checkForUpdate()
			return
		}
	}

	s.nodeID = hardwareNodeID()

	hostname, _ := os.Hostname()
	numCPU := uint32(runtime.NumCPU())

	node := &pb.NodeDevice{
		Hostname: &hostname,
		NumCpu:   &numCPU,
	}
	s.fillNodeDeviceInfo(node)

	s.nodeEntity = &pb.Entity{
		Id:    "node." + s.nodeID,
		Label: &hostname,
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
			State:    pb.DeviceState_DeviceStateActive,
			Node:     node,
		},
		Controller: &pb.Controller{
			Node: &s.nodeID,
		},
	}

	s.setEntity(s.nodeEntity.Id, s.nodeEntity, nil)
	s.bus.Dirty(s.nodeEntity.Id, s.nodeEntity, pb.EntityChange_EntityChangeUpdated)

	slog.Info("created new node identity", "nodeID", s.nodeID, "entityID", s.nodeEntity.Id)

	if s.chatTransformer != nil {
		s.chatTransformer.SetNodeEntityID(s.nodeEntity.Id)
	}

	s.checkForUpdate()
}

// SetNodeID overrides the node identity. Used in tests to simulate distinct
// nodes on the same machine. Must be called after InitNodeIdentity.
func (s *WorldServer) SetNodeID(id string) {
	s.l.Lock()
	defer s.l.Unlock()
	s.nodeID = id
	if s.nodeEntity != nil && s.nodeEntity.Controller != nil {
		s.nodeEntity.Controller.Node = &s.nodeID
	}
}

// fillNodeDeviceInfo overwrites the runtime-derived fields of a NodeDevice
// with current values. Called both for freshly created and persisted nodes
// so that version info is always up to date.
func (s *WorldServer) fillNodeDeviceInfo(n *pb.NodeDevice) {
	n.Os = strPtr(runtime.GOOS)
	n.Arch = strPtr(runtime.GOARCH)
	n.HydrisVersion = strPtr(version.Version)
	n.HydrisUpdateAvailable = nil // clear stale value; checkForUpdate will re-set if needed
	if v := osVersion(); v != "" {
		n.OsVersion = &v
	}
}

// checkForUpdate fetches the plugin registry index in the background and
// sets hydris_update_available on the node entity when a newer version exists.
func (s *WorldServer) checkForUpdate() {
	if version.Version == "dev" {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		idx, err := plugins.FetchIndex(ctx)
		if err != nil {
			slog.Debug("update check: failed to fetch index", "error", err)
			return
		}
		if idx.HydrisVersion == "" {
			return
		}
		if version.IsNewerVersion(idx.HydrisVersion) {
			s.l.Lock()
			if s.nodeEntity != nil && s.nodeEntity.Device != nil && s.nodeEntity.Device.Node != nil {
				s.nodeEntity.Device.Node.HydrisUpdateAvailable = &idx.HydrisVersion
				s.bus.Dirty(s.nodeEntity.Id, s.nodeEntity, pb.EntityChange_EntityChangeUpdated)
			}
			s.l.Unlock()
			slog.Info("hydris update available", "current", version.Version, "latest", idx.HydrisVersion)
		}
	}()
}

func strPtr(s string) *string { return &s }

func isURLSafeID(s string) bool {
	if len(s) == 0 {
		return false
	}
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			continue
		}
		switch r {
		case '-', '_', '.', '~', '@', ':':
			continue
		}
		return false
	}
	return true
}

// SetWorldFile sets the path for world state persistence
func (s *WorldServer) SetWorldFile(path string) {
	s.worldFile = path
}

// GetSourceURL returns the original source URL for a camera stream before
// the MediaTransformer rewrote it to a proxy URL.
func (s *WorldServer) GetSourceURL(entityID string, streamIndex int) string {
	return s.mediaTransformer.GetSourceURL(entityID, streamIndex)
}

func (s *WorldServer) GetHead(id string) *pb.Entity {
	s.l.RLock()
	defer s.l.RUnlock()
	if es := s.head[id]; es != nil {
		return es.entity
	}
	return nil
}

func (s *WorldServer) ListEntities(ctx context.Context, req *connect.Request[pb.ListEntitiesRequest]) (*connect.Response[pb.ListEntitiesResponse], error) {
	s.l.RLock()
	defer s.l.RUnlock()

	el := make([]*pb.Entity, 0, len(s.head))
	for _, es := range s.head {
		if !s.matchesListEntitiesRequest(es.entity, req.Msg) {
			continue
		}
		el = append(el, es.entity)
	}
	sortEntities(el, req.Msg.Sort)

	response := &pb.ListEntitiesResponse{
		Entities: el,
	}
	return connect.NewResponse(response), nil
}

func (s *WorldServer) GetEntity(ctx context.Context, req *connect.Request[pb.GetEntityRequest]) (*connect.Response[pb.GetEntityResponse], error) {
	s.l.RLock()
	defer s.l.RUnlock()

	es, exists := s.head[req.Msg.Id]
	if !exists {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("entity with id %s not found", req.Msg.Id))
	}

	entity := es.entity

	if len(es.lifetimes) > 0 && entity.Lifetime != nil {
		clm := make(map[int32]*pb.Lifetime, len(es.lifetimes))
		for protoNum, cm := range es.lifetimes {
			if protoNum == lifetimeProtoNum || protoNum < 11 {
				continue // skip Lifetime itself and metadata fields
			}
			clt := &pb.Lifetime{}
			if !cm.fresh.IsZero() {
				clt.Fresh = timestamppb.New(cm.fresh)
			}
			if !cm.until.IsZero() {
				clt.Until = timestamppb.New(cm.until)
			}
			clm[protoNum] = clt
		}
		// Temporarily attach components for serialization; cleared after.
		// Safe because we hold the read lock and connect serializes synchronously.
		entity.Lifetime.Components = clm
		defer func() { entity.Lifetime.Components = nil }()
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

func (s *WorldServer) TimeSync(_ context.Context, req *connect.Request[pb.TimeSyncRequest]) (*connect.Response[pb.TimeSyncResponse], error) {
	now := timestamppb.Now()
	return connect.NewResponse(&pb.TimeSyncResponse{
		T1: req.Msg.T1,
		T2: now,
		T3: now,
	}), nil
}

func (s *WorldServer) Push(ctx context.Context, req *connect.Request[pb.EntityChangeRequest]) (*connect.Response[pb.EntityChangeResponse], error) {
	s.l.Lock()
	defer s.l.Unlock()

	// Validate incoming entities before any merge.
	for _, e := range req.Msg.Changes {
		if !isURLSafeID(e.Id) {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("entity id %q must be url safe", e.Id))
		}
		if e.Routing != nil {
			for _, ch := range e.Routing.Channels {
				if ch.Name != "" && !isURLSafeID(ch.Name) {
					return nil, connect.NewError(connect.CodeInvalidArgument,
						fmt.Errorf("entity %s routing channel name %q must be url safe", e.Id, ch.Name))
				}
			}
		}
		for _, tr := range s.transformers {
			if err := tr.Validate(s.headView, e); err != nil {
				return nil, err
			}
		}
	}

	configChanged := false
	var changedIDs []string

	for _, e := range req.Msg.Changes {

		// Enforce lease: reject if entity is leased by a different controller.
		if e.Lease != nil {
			if es, ok := s.head[e.Id]; ok && es.entity.Lease != nil {
				if es.entity.Lease.Controller != e.Lease.Controller {
					return nil, connect.NewError(connect.CodeFailedPrecondition,
						fmt.Errorf("entity %s is leased by controller %s", e.Id, es.entity.Lease.Controller))
				}
			}
		}

		if es, ok := s.head[e.Id]; ok {
			merged, accepted := s.mergeEntityComponents(e.Id, es, e)
			if !accepted {
				continue
			}
			s.head[e.Id].entity = merged
			s.headView[e.Id] = merged
		} else {
			hadNoLifetime := e.Lifetime == nil
			if hadNoLifetime {
				e.Lifetime = &pb.Lifetime{}
			}
			if !e.Lifetime.From.IsValid() {
				e.Lifetime.From = timestamppb.Now()
			}
			if e.Lifetime.Fresh == nil || !e.Lifetime.Fresh.IsValid() {
				e.Lifetime.Fresh = e.Lifetime.From
			}
			s.initEntity(e, hadNoLifetime)
		}

		// Stamp controller node after merge so we never clobber an
		// existing Controller.Id with a synthetic empty Controller.
		stored := s.head[e.Id].entity
		if s.nodeID != "" {
			if stored.Controller == nil {
				stored.Controller = &pb.Controller{}
			}
			if stored.Controller.Node == nil {
				stored.Controller.Node = &s.nodeID
			}
		}
		changedIDs = append(changedIDs, e.Id)
		if e.Config != nil {
			configChanged = true
		}
	}

	// Process replacements (full entity swap, no merge)
	for _, e := range req.Msg.Replacements {
		if e.Lifetime == nil {
			e.Lifetime = &pb.Lifetime{}
		}
		if !e.Lifetime.From.IsValid() {
			e.Lifetime.From = timestamppb.Now()
		}
		if e.Lifetime.Fresh == nil || !e.Lifetime.Fresh.IsValid() {
			e.Lifetime.Fresh = e.Lifetime.From
		}
		if s.nodeID != "" {
			if e.Controller == nil {
				e.Controller = &pb.Controller{}
			}
			if e.Controller.Node == nil {
				e.Controller.Node = &s.nodeID
			}
		}

		s.initEntity(e)
		changedIDs = append(changedIDs, e.Id)
		if e.Config != nil {
			configChanged = true
		}
	}

	// Run transformers, then notify subscribers.
	// Transformers must run after merge (to see latest state) but before
	// Dirty (so subscribers see transformer-computed fields like Geo from PoseComponent).
	for _, id := range changedIDs {
		upserted, removed := transform.RunTransformers(s.transformers, s.headView, s.bus, id)
		s.syncTransformerResults(upserted, removed)
	}
	for _, id := range changedIDs {
		s.bus.Dirty(id, s.head[id].entity, pb.EntityChange_EntityChangeUpdated)
	}

	if configChanged {
		s.notifyPersist()
	}

	response := &pb.EntityChangeResponse{
		Accepted: true,
	}

	return connect.NewResponse(response), nil
}

func (s *WorldServer) ExpireEntity(ctx context.Context, req *connect.Request[pb.ExpireEntityRequest]) (*connect.Response[pb.ExpireEntityResponse], error) {
	s.l.Lock()
	defer s.l.Unlock()

	es, exists := s.head[req.Msg.Id]
	if !exists {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("entity with id %s not found", req.Msg.Id))
	}

	now := timestamppb.Now()

	// Mark for unconditional removal by the GC. Subsequent pushes
	// cannot revive an entity once hard-expired.
	es.hardExpire = true

	// Also set entity-level lifetime for backward compat / visibility.
	if es.entity.Lifetime == nil {
		es.entity.Lifetime = &pb.Lifetime{}
	}
	es.entity.Lifetime.Until = now

	s.bus.Dirty(es.entity.Id, es.entity, pb.EntityChange_EntityChangeUpdated)

	return connect.NewResponse(&pb.ExpireEntityResponse{}), nil
}

func (s *WorldServer) HardReset(ctx context.Context, req *connect.Request[pb.HardResetRequest]) (*connect.Response[pb.HardResetResponse], error) {
	// Only allow from localhost.
	host, _, _ := net.SplitHostPort(req.Peer().Addr)
	ip := net.ParseIP(host)
	if ip != nil && !ip.IsLoopback() {
		return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("hard reset is only callable from localhost"))
	}

	missionID := req.Msg.GetMissionId()

	slog.Warn("hard reset requested", "peer", req.Peer().Addr, "mission_id", missionID)

	s.l.Lock()

	// If a mission is requested, validate it exists and has an artifact before deleting anything.
	var missionEntity *pb.Entity
	if missionID != "" {
		es, ok := s.head[missionID]
		if !ok {
			s.l.Unlock()
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("mission entity %q not found", missionID))
		}
		if es.entity.Artifact == nil {
			s.l.Unlock()
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("mission entity %q has no artifact component", missionID))
		}
		missionEntity = proto.Clone(es.entity).(*pb.Entity)
		missionEntity.Id = "mission"
	}

	// Expire every entity (except the mission) and let transformers see the removal.
	for id, es := range s.head {
		if missionEntity != nil && id == missionID {
			continue
		}
		snapshot := es.entity
		deleteArtifactBlob(snapshot)
		s.deleteEntity(id)
		for _, t := range s.transformers {
			t.Resolve(s.headView, id)
		}
		s.bus.Dirty(id, snapshot, pb.EntityChange_EntityChangeExpired)
	}

	// Remove the original mission entry (under old ID) and re-insert under "mission".
	if missionEntity != nil {
		s.deleteEntity(missionID)
		s.initEntity(missionEntity)
	}

	// Truncate persistence file, then write back the mission entity if present.
	if s.worldFile != "" {
		if missionEntity != nil {
			yamlBytes, err := entitiesToYAML([]*pb.Entity{missionEntity})
			if err != nil {
				slog.Warn("failed to marshal mission entity during hard reset", "error", err)
			} else if err := os.WriteFile(s.worldFile, yamlBytes, 0644); err != nil {
				slog.Warn("failed to write mission entity during hard reset", "error", err)
			}
		} else {
			if err := os.WriteFile(s.worldFile, nil, 0644); err != nil {
				slog.Warn("failed to truncate world file during hard reset", "error", err)
			}
		}
	}

	s.l.Unlock()

	// Disconnect all streaming consumers.
	s.bus.CloseAll()

	// Reset builtin HTTP handlers and restart all builtins so they
	// re-register their entities and routes from scratch.
	builtin.ResetHTTPHandlers()
	builtin.RestartAll()

	// Reload defaults and re-establish node identity.
	if err := s.LoadDefaults(builtin.DefaultWorld()); err != nil {
		slog.Warn("failed to reload defaults after hard reset", "error", err)
	}
	s.InitNodeIdentity()

	slog.Info("hard reset complete")
	return connect.NewResponse(&pb.HardResetResponse{}), nil
}

// NewAPIMux creates an http.ServeMux with the gRPC-Connect APIs,
// WHEP/media endpoints, healthz, and metrics registered.
// It does NOT serve the frontend — callers can add a "/" handler for that.
// Used by both StartEngine and the Wails desktop app.
func NewAPIMux(engine *WorldServer, promHandler http.Handler, bridges *media.BridgeManager, logHandler ...http.Handler) *http.ServeMux {
	mux := http.NewServeMux()

	worldPath, worldHandler := _goconnect.NewWorldServiceHandler(engine)
	mux.Handle(worldPath, worldHandler)

	if artifacts.Server != nil {
		artPath, artHandler := _goconnect.NewArtifactServiceHandler(artifacts.Server)
		mux.Handle(artPath, artHandler)
	}

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("OK"))
	})

	if promHandler != nil {
		mux.Handle("/metrics", promHandler)
	}

	// pprof — guarded to localhost only.
	pprofMux := http.DefaultServeMux
	mux.Handle("/debug/pprof/", localhostOnly(pprofMux))

	// Plugin dev loading — localhost only.
	mux.Handle("POST /plugin/dev", localhostOnly(http.HandlerFunc(handlePluginDev)))

	whepHandler := media.NewHandler(engine, bridges)
	mux.Handle("POST /media/whep/{entityId...}", mediaAccessControl(whepHandler))

	imageHandler := media.NewImageProxyHandler(engine)
	mux.Handle("GET /media/image/{entityId...}", mediaAccessControl(imageHandler))

	// Mount builtin-registered HTTP handlers (e.g., webcam streams).
	mux.Handle("/media/webcam/", builtin.HTTPHandler())

	if len(logHandler) > 0 && logHandler[0] != nil {
		mux.Handle("/logs", logHandler[0])
	}

	return mux
}

// mediaAccessControl wraps an HTTP handler to enforce the mediaserver's
// share_remote policy. When remote sharing is disabled, only requests from
// localhost (127.0.0.1, ::1) are allowed; all others get 403 Forbidden.
func mediaAccessControl(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !mediaserver.IsRemoteSharingEnabled() {
			host, _, _ := net.SplitHostPort(r.RemoteAddr)
			ip := net.ParseIP(host)
			if ip != nil && !ip.IsLoopback() {
				http.Error(w, "remote media access is disabled", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// localhostOnly rejects requests not originating from loopback.
func localhostOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// EngineConfig holds configuration for starting the engine
type EngineConfig struct {
	WorldFile  string
	PolicyFile string
	NoDefaults bool
	LogHandler http.Handler
}

// StartEngine starts the Hydris engine and returns the server address.
// If worldFile is provided, it loads entities from that file on startup
// and periodically flushes the current state back to the file.
func StartEngine(ctx context.Context, cfg EngineConfig) (string, error) {
	engine := NewWorldServer()

	// Default to a platform-appropriate config directory when no world file is specified.
	worldFile := cfg.WorldFile
	if worldFile == "" {
		if configDir, err := os.UserConfigDir(); err == nil {
			dir := configDir + "/hydris"
			if err := os.MkdirAll(dir, 0755); err == nil {
				worldFile = dir + "/world.yaml"
			}
		}
	}

	// Set up world file persistence
	if worldFile != "" {
		engine.worldFile = worldFile

		// Load existing state from file
		if err := engine.LoadFromFile(worldFile); err != nil {
			return "", fmt.Errorf("failed to load world file: %w", err)
		}

		// Start periodic flushing (every 10 seconds)
		engine.StartPeriodicFlush(10 * time.Second)
	}

	// Load builtin defaults with a very old lifetime.from so they never
	// overwrite entities that were persisted with a real timestamp.
	if !cfg.NoDefaults {
		if err := engine.LoadDefaults(builtin.DefaultWorld()); err != nil {
			slog.Warn("failed to load default world", "error", err)
		}
	}

	// Initialize stable node identity (after loading world state)
	engine.InitNodeIdentity()

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

	// Shared bridge manager for WHEP + RTSP.
	bridges := media.NewBridgeManager()

	// Set up WebRTC UDP mux so all ICE traffic goes through a single UDP port.
	// This means only one port (the engine port) needs to be open in the firewall.
	udpListener, err := net.ListenPacket("udp", ":"+port)
	if err != nil {
		return "", fmt.Errorf("failed to listen UDP on port %s: %v", port, err)
	}
	bridges.SetupWebRTCMux(udpListener)

	// Set up artifact storage.
	artDir := filepath.Join(filepath.Dir(worldFile), "artifacts")
	artLocal, err := artifacts.NewLocalStore(artDir)
	if err != nil {
		return "", fmt.Errorf("failed to create artifact store: %w", err)
	}
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return "", fmt.Errorf("failed to create builtin client: %w", err)
	}
	worldClient := pb.NewWorldServiceClient(grpcConn)
	artifacts.Server = artifacts.NewArtifactServer(artLocal, worldClient)

	// Create HTTP handler: API endpoints + frontend on "/"
	mux := NewAPIMux(engine, promHandler, bridges, cfg.LogHandler)

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

	// Protocol-multiplex: RTSP and HTTP share the same port.
	muxLn := muxlistener.New(listener)

	// Start RTSP relay server on the RTSP sub-listener.
	rtspServer := media.NewRTSPServer(engine, bridges, mediaserver.IsRemoteSharingEnabled)
	if err := rtspServer.Start(muxLn.RTSP()); err != nil {
		return "", fmt.Errorf("failed to start RTSP server: %v", err)
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

	// Serve HTTP on the HTTP sub-listener.
	go func() {
		if err := httpServer.Serve(muxLn.HTTP()); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Run the mux listener's accept loop.
	go func() {
		if err := muxLn.Serve(); err != nil {
			slog.Debug("mux listener closed", "error", err)
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
		rtspServer.Close()
		_ = muxLn.Close()
		_ = httpServer.Shutdown(context.Background())
		_ = builtinServer.Shutdown(context.Background())
	}()

	return "localhost:" + port, nil
}

// setEntity stores an entity in head and updates the headView.
func (s *WorldServer) setEntity(id string, e *pb.Entity, lifetimes map[int32]componentMeta) {
	s.head[id] = &entityState{entity: e, lifetimes: lifetimes}
	s.headView[id] = e
}

// deleteEntity removes an entity from head and headView.
func (s *WorldServer) deleteEntity(id string) {
	delete(s.head, id)
	delete(s.headView, id)
}

// syncTransformerResults adds/removes transformer-generated entities in
// s.head so they stay in sync with s.headView.
func (s *WorldServer) syncTransformerResults(upserted, removed []string) {
	for _, uid := range upserted {
		if es, exists := s.head[uid]; exists {
			es.entity = s.headView[uid]
		} else {
			s.head[uid] = &entityState{entity: s.headView[uid]}
		}
	}
	for _, rid := range removed {
		delete(s.head, rid)
	}
}

// lifetimeTime returns the effective timestamp for a Lifetime, preferring
// Fresh over From. Returns the zero time if neither is set.
func lifetimeTime(l *pb.Lifetime) time.Time {
	if l == nil {
		return time.Time{}
	}
	if l.Fresh != nil && l.Fresh.IsValid() {
		return l.Fresh.AsTime()
	}
	if l.From != nil && l.From.IsValid() {
		return l.From.AsTime()
	}
	return time.Time{}
}

// lifetimeUntil extracts the until time from a Lifetime. Zero means no expiry.
func lifetimeUntil(l *pb.Lifetime) time.Time {
	if l != nil && l.Until != nil && l.Until.IsValid() {
		return l.Until.AsTime()
	}
	return time.Time{}
}

// initEntity stores an entity in head with per-component lifetime metadata
// derived from the entity's Lifetime field. If noLifetime is true, the
// original push had no Lifetime set — components are marked accordingly so
// they inherit the entity's lifetime from other components during merge.
func (s *WorldServer) initEntity(e *pb.Entity, noLifetime ...bool) {
	fresh := lifetimeTime(e.Lifetime)
	until := lifetimeUntil(e.Lifetime)
	nl := len(noLifetime) > 0 && noLifetime[0]

	v := reflect.ValueOf(e).Elem()
	meta := make(map[int32]componentMeta)
	for protoNum, fieldIdx := range protoNumToFieldIdx {
		if protoNum == lifetimeProtoNum {
			continue
		}
		f := v.Field(fieldIdx)
		if f.Kind() == reflect.Pointer && !f.IsNil() {
			meta[protoNum] = componentMeta{fresh: fresh, until: until, noLifetime: nl}
		}
	}
	if len(meta) == 0 {
		meta = nil
	}
	s.setEntity(e.Id, e, meta)
}

// componentAccepted checks whether an incoming component should replace an existing one.
// Rules: fresher wins; on equal freshness, shorter until wins.
func componentAccepted(incomingFresh, incomingUntil time.Time, existing componentMeta) bool {
	if existing.fresh.IsZero() || incomingFresh.IsZero() {
		return true // missing timestamps → accept
	}
	if incomingFresh.After(existing.fresh) {
		return true
	}
	if incomingFresh.Before(existing.fresh) {
		return false
	}
	// Identical timestamps with explicit expiry — nothing changed, reject.
	// Both-permanent (zero until) is excluded: permanent entities may carry
	// content updates at the same freshness.
	if !incomingUntil.IsZero() && incomingFresh.Equal(existing.fresh) && incomingUntil.Equal(existing.until) {
		return false
	}
	// Equal freshness — tiebreak: shorter until wins.
	// Zero until means no expiry (infinite), which is the longest possible.
	if incomingUntil.IsZero() && existing.until.IsZero() {
		return true // both permanent, accept
	}
	if incomingUntil.IsZero() {
		return false // incoming is permanent (longer), existing has until (shorter) → keep existing
	}
	if existing.until.IsZero() {
		return true // incoming has until (shorter), existing is permanent → accept
	}
	return !incomingUntil.After(existing.until)
}

// mergeEntityComponents performs per-component LWW merge.
// Each non-nil pointer field in incoming is independently compared against
// the existing component's lifetime. Returns the merged entity and whether
// at least one component was accepted.
func (s *WorldServer) mergeEntityComponents(entityID string, existing *entityState, incoming *pb.Entity) (*pb.Entity, bool) {
	merged := proto.Clone(existing.entity).(*pb.Entity)

	inFresh := lifetimeTime(incoming.Lifetime)
	if inFresh.IsZero() {
		inFresh = time.Now()
	}
	inUntil := lifetimeUntil(incoming.Lifetime)

	srcV := reflect.ValueOf(incoming).Elem()
	mergedV := reflect.ValueOf(merged).Elem()

	anyAccepted := false

	for protoNum, fieldIdx := range protoNumToFieldIdx {
		if protoNum == lifetimeProtoNum {
			continue
		}
		sf := srcV.Field(fieldIdx)
		if sf.Kind() != reflect.Pointer || sf.IsNil() {
			continue
		}
		mf := mergedV.Field(fieldIdx)
		if !mf.CanSet() {
			continue
		}

		if em, has := existing.lifetimes[protoNum]; has && !componentAccepted(inFresh, inUntil, em) {
			continue
		}

		mf.Set(sf)
		applyComponentMergers(protoNum, merged, existing.entity)
		if existing.lifetimes == nil {
			existing.lifetimes = make(map[int32]componentMeta)
		}
		existing.lifetimes[protoNum] = componentMeta{fresh: inFresh, until: inUntil, noLifetime: incoming.Lifetime == nil}
		anyAccepted = true
	}

	// Update entity-level Lifetime to reflect the largest span across all components.
	// If no tracked (has-lifetime) components exist, preserve the existing Lifetime.
	if anyAccepted {
		var earliestFresh, latestFresh, latestUntil time.Time
		permanent := false
		tracked := 0
		for _, cm := range existing.lifetimes {
			if cm.noLifetime {
				continue
			}
			tracked++
			if earliestFresh.IsZero() || cm.fresh.Before(earliestFresh) {
				earliestFresh = cm.fresh
			}
			if cm.fresh.After(latestFresh) {
				latestFresh = cm.fresh
			}
			if cm.until.IsZero() {
				permanent = true
			} else if cm.until.After(latestUntil) {
				latestUntil = cm.until
			}
		}
		if tracked > 0 {
			merged.Lifetime = &pb.Lifetime{
				From:  timestamppb.New(earliestFresh),
				Fresh: timestamppb.New(latestFresh),
			}
			if !permanent && !latestUntil.IsZero() {
				merged.Lifetime.Until = timestamppb.New(latestUntil)
			}
		}
	}

	return merged, anyAccepted
}
