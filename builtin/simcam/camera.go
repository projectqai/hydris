package simcam

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

const (
	defaultFovWide  = 60.0
	defaultFovTele  = 8.0
	defaultRangeMax = 2000.0
	defaultMaxFPS   = 25
	// defaultAltitude is the default camera mounting height in meters.
	defaultAltitude = 10.0
)

const (
	panRateDegPerSec  = 60.0
	tiltRateDegPerSec = 30.0
	moveSpeedMPerSec  = 3.0
	manualTimeout     = controller.ManualLinkTimeout
)

// geoAltitude returns the position's altitude, or def if it has none.
func geoAltitude(g *pb.GeoSpatialComponent, def float64) float64 {
	if g.Altitude == nil {
		return def
	}
	return g.GetAltitude()
}

func focalPointID(camID string) string {
	return camID + "~fp"
}

type cameraConfig struct {
	FovWide           float64
	FovTele           float64
	RangeMax          float64
	MaxFPS            int
	RenderBehindWall  bool
	InstantSlew       bool
	EnableDetections  bool
	EnableDirectDrive bool
	// Altitude is the mounting height in meters, used when the camera's
	// position carries no altitude of its own.
	Altitude float64
}

func parseCameraConfig(entity *pb.Entity) cameraConfig {
	cfg := cameraConfig{
		FovWide:  defaultFovWide,
		FovTele:  defaultFovTele,
		RangeMax: defaultRangeMax,
		MaxFPS:   defaultMaxFPS,
		Altitude: defaultAltitude,
	}
	if entity.Config == nil || entity.Config.Value == nil {
		return cfg
	}
	fields := entity.Config.Value.Fields
	if v, ok := fields["fov_wide"]; ok && v.GetNumberValue() > 0 {
		cfg.FovWide = v.GetNumberValue()
	}
	if v, ok := fields["fov_tele"]; ok && v.GetNumberValue() > 0 {
		cfg.FovTele = v.GetNumberValue()
	}
	if v, ok := fields["range_max"]; ok && v.GetNumberValue() > 0 {
		cfg.RangeMax = v.GetNumberValue()
	}
	if v, ok := fields["altitude"]; ok {
		cfg.Altitude = math.Max(v.GetNumberValue(), 0)
	}
	if v, ok := fields["max_fps"]; ok && v.GetNumberValue() > 0 {
		cfg.MaxFPS = clampInt(int(v.GetNumberValue()), 1, maxFPSLimit)
	}
	if v, ok := fields["render_behind_wall"]; ok {
		cfg.RenderBehindWall = v.GetBoolValue()
	}
	if v, ok := fields["instant_slew"]; ok {
		cfg.InstantSlew = v.GetBoolValue()
	}
	if v, ok := fields["enable_detections"]; ok {
		cfg.EnableDetections = v.GetBoolValue()
	}
	if v, ok := fields["enable_direct_drive"]; ok {
		cfg.EnableDirectDrive = v.GetBoolValue()
	}
	return cfg
}

// -- world caches -------------------------------------------------------------

type cachedEntity struct {
	id              string
	lat, lon, alt   float64
	label           string
	sidc            string
	widthM, heightM float32
	images          []string
}

type worldCache struct {
	mu       sync.Mutex
	entities map[string]cachedEntity
	version  uint64
	snap     []cachedEntity
	snapVer  uint64
}

func (wc *worldCache) update(e cachedEntity) {
	wc.mu.Lock()
	wc.entities[e.id] = e
	wc.version++
	wc.mu.Unlock()
}

// retainWithin drops entities further than radiusM from a point.
func (wc *worldCache) retainWithin(lat, lon, radiusM float64) {
	wc.mu.Lock()
	defer wc.mu.Unlock()
	for id, e := range wc.entities {
		if distanceM(lat, lon, e.lat, e.lon) > radiusM {
			delete(wc.entities, id)
			wc.version++
		}
	}
}

func (wc *worldCache) remove(id string) {
	wc.mu.Lock()
	if _, ok := wc.entities[id]; ok {
		delete(wc.entities, id)
		wc.version++
	}
	wc.mu.Unlock()
}

// snapshot returns an immutable slice, rebuilt only after changes.
func (wc *worldCache) snapshot() []cachedEntity {
	wc.mu.Lock()
	defer wc.mu.Unlock()
	if wc.snap == nil || wc.snapVer != wc.version {
		wc.snap = make([]cachedEntity, 0, len(wc.entities))
		for _, e := range wc.entities {
			wc.snap = append(wc.snap, e)
		}
		wc.snapVer = wc.version
	}
	return wc.snap
}

type shapeCache struct {
	mu      sync.Mutex
	shapes  map[string][]prism
	version uint64
	snap    shapeSet
}

func (sc *shapeCache) update(id string, p []prism) {
	sc.mu.Lock()
	sc.shapes[id] = p
	sc.version++
	sc.mu.Unlock()
}

// retainWithin drops shapes with no vertex within radiusM of a point.
func (sc *shapeCache) retainWithin(lat, lon, radiusM float64) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	for id, prisms := range sc.shapes {
		near := false
		for _, p := range prisms {
			for _, g := range p.ring {
				if distanceM(lat, lon, g.lat, g.lon) <= radiusM {
					near = true
					break
				}
			}
		}
		if !near {
			delete(sc.shapes, id)
			sc.version++
		}
	}
}

func (sc *shapeCache) remove(id string) {
	sc.mu.Lock()
	if _, ok := sc.shapes[id]; ok {
		delete(sc.shapes, id)
		sc.version++
	}
	sc.mu.Unlock()
}

func (sc *shapeCache) snapshot() shapeSet {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	if sc.snap.version != sc.version {
		var all []prism
		for _, p := range sc.shapes {
			all = append(all, p...)
		}
		sc.snap = shapeSet{version: sc.version, prisms: all}
	}
	return sc.snap
}

// -- camera lifecycle ---------------------------------------------------------

type camera struct {
	id, fpID string
	cfg      cameraConfig
	logger   *slog.Logger
	state    *camState
	world    *worldCache
	shapes   *shapeCache
	frames   *frameStore
	dirty    chan struct{}

	stats frameStats
	// quality is the ground quality (lengthwise samples), adapted by
	// monitorFrames from measured frame times.
	quality atomic.Int32
}

func runCamera(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	ensureMounted()

	release, err := claimInstance(ctx, entity.Id)
	if err != nil {
		logger.Info("simcam: camera superseded before start", "camera", entity.Id)
		return nil
	}
	defer release()

	cfg := parseCameraConfig(entity)
	lat, lon, alt := 0.0, 0.0, cfg.Altitude
	if entity.Geo != nil {
		lat, lon = entity.Geo.Latitude, entity.Geo.Longitude
		if entity.Assembly != nil {
			alt = geoAltitude(entity.Geo, cfg.Altitude)
		}
	}
	label := entity.Id
	if entity.Label != nil {
		label = *entity.Label
	}

	initZoom := cfg.RangeMax / 4
	cam := &camera{
		id:     entity.Id,
		fpID:   focalPointID(entity.Id),
		cfg:    cfg,
		logger: logger.With("camera", entity.Id),
		state: &camState{
			zoom: initZoom, targetZoom: initZoom,
			lat: lat, lon: lon, alt: alt,
			label:       label,
			fovWide:     cfg.FovWide,
			fovTele:     cfg.FovTele,
			rangeMax:    cfg.RangeMax,
			instantSlew: cfg.InstantSlew,
		},
		world:  &worldCache{entities: make(map[string]cachedEntity)},
		shapes: &shapeCache{shapes: make(map[string][]prism)},
		frames: newFrameStore(),
		dirty:  make(chan struct{}, 1),
	}
	cam.quality.Store(1)

	registerFrameStore(cam.id, cam.frames)
	defer unregisterFrameStore(cam.id, cam.frames)
	cam.logger.Info("simcam: camera started", "config_version", entity.GetConfig().GetVersion())
	defer func() {
		cam.logger.Info("simcam: camera stopped", "reason", context.Cause(ctx))
	}()

	// The engine aims the focal point from the entity's position, so the
	// configured height must be on the entity too, or the crosshair is off
	// by the mounting height. A camera on a platform takes its position
	// from there instead.
	if g := entity.Geo; g != nil && entity.Assembly == nil && (g.Altitude == nil || g.GetAltitude() != cfg.Altitude) {
		geo := proto.Clone(g).(*pb.GeoSpatialComponent)
		geo.Altitude = proto.Float64(cfg.Altitude)
		if err := controller.Push(ctx, controllerName, &pb.Entity{Id: entity.Id, Geo: geo}); err != nil {
			return fmt.Errorf("push altitude: %w", err)
		}
	}

	if err := cam.pushComponents(ctx, entity); err != nil {
		return fmt.Errorf("push camera components: %w", err)
	}
	defer expireFocalPoint(cam.fpID)

	ready()

	go cam.watch(ctx, "target pose", &pb.EntityFilter{Id: &cam.fpID, Component: []uint32{62}}, cam.onTargetPose)
	go cam.watch(ctx, "camera position", &pb.EntityFilter{Id: &cam.id, Component: []uint32{11}}, cam.onPosition)
	go cam.watch(ctx, "camera orientation", &pb.EntityFilter{Id: &cam.id, Component: []uint32{30}}, cam.onOrientation)
	go cam.watchNear(ctx)
	if cfg.EnableDirectDrive {
		go cam.watchManual(ctx)
	}

	return cam.run(ctx)
}

// watchNear keeps the entity and shape subscriptions centred on the camera:
// once it has moved a quarter of its range (a camera on a vehicle or
// aircraft), they are re-established around the new position and anything
// now out of range is dropped.
func (cam *camera) watchNear(ctx context.Context) {
	radius := cam.cfg.RangeMax
	lat, lon, _ := cam.state.position()
	for {
		wctx, cancel := context.WithCancel(ctx)
		near := nearFilter(lat, lon, radius)
		go cam.watch(wctx, "entities", &pb.EntityFilter{Component: []uint32{11}, Geo: near}, cam.onEntity)
		go cam.watch(wctx, "shapes", &pb.EntityFilter{Component: []uint32{25}, Geo: near}, cam.onShape)

		tick := time.NewTicker(time.Second)
		for {
			select {
			case <-ctx.Done():
				tick.Stop()
				cancel()
				return
			case <-tick.C:
			}
			nlat, nlon, _ := cam.state.position()
			if distanceM(lat, lon, nlat, nlon) > radius/4 {
				lat, lon = nlat, nlon
				break
			}
		}
		tick.Stop()
		cancel()
		cam.world.retainWithin(lat, lon, radius)
		cam.shapes.retainWithin(lat, lon, radius)
		signalDirty(cam.dirty)
	}
}

// distanceM is the flat-earth distance between two nearby points.
func distanceM(lat0, lon0, lat1, lon1 float64) float64 {
	dn := (lat1 - lat0) * metersPerDegLat
	de := (lon1 - lon0) * metersPerDegLat * math.Cos(lat0*deg2rad)
	return math.Hypot(de, dn)
}

func nearFilter(lat, lon, radiusM float64) *pb.GeoFilter {
	return &pb.GeoFilter{Geo: &pb.GeoFilter_Geometry{Geometry: &pb.Geometry{
		Planar: &pb.PlanarGeometry{Plane: &pb.PlanarGeometry_Circle{Circle: &pb.PlanarCircle{
			Center:  &pb.PlanarPoint{Latitude: lat, Longitude: lon},
			RadiusM: radiusM,
		}}},
	}}}
}

// watch streams entity changes matching filter into fn until ctx ends.
// fn returns true when the change affects the picture.
func (cam *camera) watch(ctx context.Context, what string, filter *pb.EntityFilter, fn func(*pb.EntityChangeEvent) bool) {
	conn, err := builtin.BuiltinClientConn(controllerName)
	if err != nil {
		cam.logger.Warn("simcam: connect", "watch", what, "error", err)
		return
	}
	defer func() { _ = conn.Close() }()
	stream, err := goclient.WatchEntitiesWithRetry(ctx, pb.NewWorldServiceClient(conn), &pb.ListEntitiesRequest{Filter: filter})
	if err != nil {
		cam.logger.Warn("simcam: watch", "watch", what, "error", err)
		return
	}
	for {
		ev, err := stream.Recv()
		if err != nil {
			if ctx.Err() == nil {
				cam.logger.Warn("simcam: watch ended", "watch", what, "error", err)
			}
			return
		}
		if ev.Entity != nil && fn(ev) {
			signalDirty(cam.dirty)
		}
	}
}

func isUpdate(ev *pb.EntityChangeEvent) bool { return ev.T == pb.EntityChange_EntityChangeUpdated }

func isGone(ev *pb.EntityChangeEvent) bool {
	return ev.T == pb.EntityChange_EntityChangeExpired || ev.T == pb.EntityChange_EntityChangeUnobserved
}

func (cam *camera) onTargetPose(ev *pb.EntityChangeEvent) bool {
	if !isUpdate(ev) || ev.Entity.TargetPose == nil {
		return false
	}
	polar, ok := ev.Entity.TargetPose.Offset.(*pb.TargetPoseComponent_Polar)
	if !ok {
		return false
	}
	el := 0.0
	if polar.Polar.Elevation != nil {
		el = clamp(*polar.Polar.Elevation, -89, 89)
	}
	zoom := 0.0
	if polar.Polar.Range != nil {
		zoom = clamp(*polar.Polar.Range, 0, cam.cfg.RangeMax)
	}
	cam.state.setTarget(wrap360(polar.Polar.Azimuth), el, zoom)
	return true
}

func (cam *camera) onPosition(ev *pb.EntityChangeEvent) bool {
	geo := ev.Entity.Geo
	if !isUpdate(ev) || geo == nil {
		return false
	}
	cam.state.setPosition(geo.Latitude, geo.Longitude, geoAltitude(geo, cam.cfg.Altitude))
	return true
}

// onOrientation tracks the yaw of the platform the camera is mounted on.
// The gimbal pan is relative to it, as in the engine's pose transform.
func (cam *camera) onOrientation(ev *pb.EntityChangeEvent) bool {
	o := ev.Entity.GetOrientation().GetOrientation()
	if !isUpdate(ev) || o == nil {
		return false
	}
	cam.state.setYaw(quaternionToYaw(o))
	return true
}

// quaternionToYaw returns the compass bearing (degrees) of an orientation,
// using the same convention as the engine's pose transform.
func quaternionToYaw(q *pb.Quaternion) float64 {
	yaw := math.Atan2(2*(q.W*q.Z+q.X*q.Y), 1-2*(q.Y*q.Y+q.Z*q.Z))
	return wrap360(-yaw / deg2rad)
}

// watchManual feeds control frames into the gimbal. advance stops acting on them
// when they stop arriving.
func (cam *camera) watchManual(ctx context.Context) {
	conn, err := builtin.BuiltinClientConn(controllerName)
	if err != nil {
		cam.logger.Warn("simcam: connect", "watch", "manual control", "error", err)
		return
	}
	defer func() { _ = conn.Close() }()
	controller.WatchManualControl(ctx, cam.logger, pb.NewWorldServiceClient(conn), cam.id, func(axes *pb.ManualControlAxes) {
		cam.state.setManual(axes)
		if axes != nil {
			signalDirty(cam.dirty)
		}
	})
	<-ctx.Done()
}

func (cam *camera) onEntity(ev *pb.EntityChangeEvent) bool {
	ent := ev.Entity
	if ent.Id == cam.id || ent.Id == cam.fpID {
		return false
	}
	switch {
	case isGone(ev):
		cam.world.remove(ent.Id)
	case isUpdate(ev):
		if ent.Geo == nil || (ent.Symbol == nil && len(ent.GetAdministrative().GetImages()) == 0) {
			cam.world.remove(ent.Id)
			return true
		}
		ce := cachedEntity{
			id:    ent.Id,
			lat:   ent.Geo.Latitude,
			lon:   ent.Geo.Longitude,
			alt:   ent.Geo.GetAltitude(),
			label: ent.GetLabel(),
			sidc:  ent.GetSymbol().GetMilStd2525C(),
		}
		if adm := ent.Administrative; adm != nil {
			ce.widthM = adm.GetWidthM()
			ce.heightM = adm.GetHeightM()
			ce.images = adm.Images
		}
		cam.world.update(ce)
	default:
		return false
	}
	return true
}

func (cam *camera) onShape(ev *pb.EntityChangeEvent) bool {
	ent := ev.Entity
	switch {
	case isGone(ev):
		cam.shapes.remove(ent.Id)
	case isUpdate(ev):
		shape := ent.Shape
		ext := shape.GetExtrusion()
		if shape.GetGeometry().GetPlanar() == nil || ext.GetHeightM() <= 0 {
			cam.shapes.remove(ent.Id)
			return true
		}
		fill := fillStyle{color: rgb(160, 160, 160)}
		if f := ext.Fill; f != nil {
			fill.texID = f.GetTexture()
			fill.texScale = f.GetTextureScaleM()
			if f.Color != nil {
				fill.color = parseHexColor(*f.Color)
			}
		}
		cam.shapes.update(ent.Id, prismsFromGeometry(shape.Geometry.Planar, ext.GetHeightM(), fill))
	default:
		return false
	}
	return true
}

func parseHexColor(s string) uint32 {
	if len(s) > 0 && s[0] == '#' {
		s = s[1:]
	}
	if len(s) != 6 {
		return rgb(160, 160, 160)
	}
	hex := func(c byte) uint8 {
		switch {
		case c >= '0' && c <= '9':
			return c - '0'
		case c >= 'a' && c <= 'f':
			return c - 'a' + 10
		case c >= 'A' && c <= 'F':
			return c - 'A' + 10
		}
		return 0
	}
	b := func(i int) uint8 { return hex(s[i])<<4 | hex(s[i+1]) }
	return rgb(b(0), b(2), b(4))
}

// -- publishing ---------------------------------------------------------------

func (cam *camera) cameraComponent(fov float64) *pb.CameraComponent {
	return &pb.CameraComponent{
		Streams: []*pb.MediaStream{{
			Label:    "Simulated Stream",
			Url:      streamURL(cam.id),
			Protocol: pb.MediaStreamProtocol_MediaStreamProtocolMjpeg,
			Role:     pb.MediaStreamRole_MediaStreamRoleMain,
			Width:    proto.Int32(streamWidth),
			Height:   proto.Int32(streamHeight),
		}},
		FocalPoint: proto.String(cam.fpID),
		Fov:        proto.Float64(fov),
		RangeMax:   proto.Float64(cam.cfg.RangeMax),
		FovWide:    proto.Float64(cam.cfg.FovWide),
		FovTele:    proto.Float64(cam.cfg.FovTele),
	}
}

func (cam *camera) focalPoint(pan, tilt, zoom float64) *pb.PoseComponent {
	return &pb.PoseComponent{
		Parent: cam.id,
		Offset: &pb.PoseComponent_Polar{Polar: &pb.PolarOffset{
			Azimuth:   pan,
			Elevation: proto.Float64(tilt),
			Range:     proto.Float64(zoom),
		}},
	}
}

func (cam *camera) pushComponents(ctx context.Context, entity *pb.Entity) error {
	routing := entity.Routing
	ent := &pb.Entity{
		Id:     cam.id,
		Camera: cam.cameraComponent(cam.cfg.FovWide),
		Device: activeDevice(entity.Device),
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("video"),
		},
	}
	// A camera mounted on a platform (assembly part) is classified by its
	// owner, if at all; classifying it here would draw a separate marker
	// next to the platform in the map's exploded assembly view.
	if entity.Assembly == nil {
		ent.Classification = &pb.ClassificationComponent{
			Taxonomy: []*pb.ClassificationTaxonomy{{
				Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
					Sensor: &pb.EquipmentTaxonomySensor{Kind: &pb.EquipmentTaxonomySensor_ElectroOptical{ElectroOptical: &pb.EquipmentTaxonomySensorElectroOptical{}}},
				}},
			}},
		}
	}
	if cam.cfg.EnableDirectDrive {
		ent.ManualControl = &pb.ManualControlComponent{}
	}
	pan, tilt, zoom := cam.state.pose()
	fp := &pb.Entity{
		Id:         cam.fpID,
		Routing:    routing,
		Controller: &pb.Controller{Id: proto.String(controllerName)},
		Pose:       cam.focalPoint(pan, tilt, zoom),
	}
	return controller.Push(ctx, controllerName, ent, fp)
}

// activeDevice returns a copy of the camera's device component, keeping its
// parent and class, reporting the active state. Components are replaced
// whole on push, so those fields must be carried over.
func activeDevice(cur *pb.DeviceComponent) *pb.DeviceComponent {
	d := &pb.DeviceComponent{}
	if cur != nil {
		d = proto.Clone(cur).(*pb.DeviceComponent)
	}
	d.State = pb.DeviceState_DeviceStateActive
	d.Error = nil
	return d
}

func expireFocalPoint(fpID string) {
	conn, err := builtin.BuiltinClientConn(controllerName)
	if err != nil {
		return
	}
	defer func() { _ = conn.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = pb.NewWorldServiceClient(conn).ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: fpID})
}

// -- camState -----------------------------------------------------------------

type camState struct {
	mu                                sync.Mutex
	pan, tilt, zoom                   float64
	targetPan, targetTilt, targetZoom float64
	lat, lon, alt                     float64
	yaw                               float64 // platform heading; pan is relative to it
	label                             string
	fovWide, fovTele, rangeMax        float64
	instantSlew                       bool
	manualPan, manualTilt, manualZoom float32
	manualRight                       float32
	lastManual                        time.Time
	// driven is set when direct drive moved the camera, which then has to
	// publish its own position. Otherwise the position comes from the
	// world (e.g. a pose on a moving platform) and must not be echoed back.
	driven bool
}

func (s *camState) setPosition(lat, lon, alt float64) {
	s.mu.Lock()
	s.lat, s.lon, s.alt = lat, lon, alt
	s.mu.Unlock()
}

// takeDriven reports and clears whether direct drive moved the camera.
func (s *camState) takeDriven() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.driven
	s.driven = false
	return d
}

func (s *camState) setYaw(yaw float64) {
	s.mu.Lock()
	s.yaw = yaw
	s.mu.Unlock()
}

func (s *camState) position() (lat, lon, alt float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lat, s.lon, s.alt
}

func (s *camState) setTarget(pan, tilt, zoom float64) {
	s.mu.Lock()
	s.targetPan, s.targetTilt, s.targetZoom = pan, tilt, zoom
	s.mu.Unlock()
}

func (s *camState) setManual(axes *pb.ManualControlAxes) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if axes == nil {
		s.manualPan, s.manualTilt, s.manualZoom, s.manualRight = 0, 0, 0, 0
		s.lastManual = time.Time{}
		return
	}
	s.manualPan = axes.GetPan()
	s.manualTilt = axes.GetTilt()
	s.manualZoom = axes.GetForward() + axes.GetZoom()
	s.manualRight = axes.GetRight()
	s.lastManual = time.Now()
}

// advance steps the gimbal by dt seconds. changed reports whether the pose
// or position moved; moving whether it still needs stepping.
func (s *camState) advance(dt float64) (changed, moving bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	manual := !s.lastManual.IsZero()
	if manual && time.Since(s.lastManual) > manualTimeout {
		s.manualPan, s.manualTilt, s.manualZoom, s.manualRight = 0, 0, 0, 0
		s.lastManual = time.Time{}
		manual = false
	}
	prevPan, prevTilt, prevZoom, prevLat, prevLon := s.pan, s.tilt, s.zoom, s.lat, s.lon
	if manual {
		s.targetPan = wrap360(s.targetPan + float64(s.manualPan)*panRateDegPerSec*0.15*dt)
		s.targetTilt = clamp(s.targetTilt+float64(s.manualTilt)*tiltRateDegPerSec*0.15*dt, -89, 89)
		s.targetZoom = clamp(s.targetZoom+float64(s.manualZoom)*s.rangeMax*0.6*dt, 0, s.rangeMax)
		if s.manualRight != 0 {
			sp, cp := math.Sincos((s.pan + s.yaw) * deg2rad)
			d := float64(s.manualRight) * moveSpeedMPerSec * dt
			s.driven = true
			s.lat += -sp * d / metersPerDegLat
			if cosLat := math.Cos(s.lat * deg2rad); cosLat > 0 {
				s.lon += cp * d / (metersPerDegLat * cosLat)
			}
		}
	}
	if s.instantSlew {
		s.pan, s.tilt, s.zoom = wrap360(s.targetPan), s.targetTilt, s.targetZoom
	} else {
		s.pan = stepAngle(s.pan, s.targetPan, panRateDegPerSec*dt)
		s.tilt = stepLinear(s.tilt, s.targetTilt, tiltRateDegPerSec*dt)
		s.zoom = stepLinear(s.zoom, s.targetZoom, s.rangeMax*4*dt)
	}
	changed = s.pan != prevPan || s.tilt != prevTilt || s.zoom != prevZoom || s.lat != prevLat || s.lon != prevLon
	moving = manual || s.pan != wrap360(s.targetPan) || s.tilt != s.targetTilt || s.zoom != s.targetZoom
	return changed, moving
}

func (s *camState) pose() (pan, tilt, zoom float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pan, s.tilt, s.zoom
}

func (s *camState) snapshot() poseSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return poseSnapshot{
		Pan:      s.pan,
		Yaw:      s.yaw,
		Tilt:     s.tilt,
		Zoom:     s.zoom,
		FovDeg:   effectiveFovDeg(s.zoom, s.fovWide, s.fovTele, s.rangeMax),
		RangeMax: s.rangeMax,
		Label:    s.label,
	}
}

func effectiveFovDeg(zoom, fovWide, fovTele, rangeMax float64) float64 {
	if rangeMax <= 0 {
		return fovWide
	}
	return fovWide + clamp(zoom/rangeMax, 0, 1)*(fovTele-fovWide)
}

// -- gimbal math --------------------------------------------------------------

func stepAngle(cur, target, maxStep float64) float64 {
	diff := wrapSigned(target - cur)
	if math.Abs(diff) <= maxStep {
		return wrap360(target)
	}
	return wrap360(cur + math.Copysign(maxStep, diff))
}

func stepLinear(cur, target, maxStep float64) float64 {
	diff := target - cur
	if math.Abs(diff) <= maxStep {
		return target
	}
	return cur + math.Copysign(maxStep, diff)
}

func wrap360(d float64) float64 {
	r := math.Mod(d, 360)
	if r < 0 {
		r += 360
	}
	return r
}

func wrapSigned(d float64) float64 {
	d = math.Mod(d, 360)
	if d > 180 {
		d -= 360
	} else if d < -180 {
		d += 360
	}
	return d
}

func clamp(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

func signalDirty(ch chan struct{}) {
	select {
	case ch <- struct{}{}:
	default:
	}
}
