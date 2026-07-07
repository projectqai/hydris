package simcam

import (
	"bytes"
	"context"
	"fmt"
	"image/color"
	"image/jpeg"
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
)

const (
	panRateDegPerSec  = 60.0
	tiltRateDegPerSec = 30.0
	moveSpeedMPerSec  = 3.0
)

func focalPointID(camID string) string {
	return camID + "~fp"
}

type cameraConfig struct {
	FovWide           float64
	FovTele           float64
	RangeMax          float64
	RenderBehindWall  bool
	InstantSlew       bool
	EnableDetections  bool
	EnableDirectDrive bool
}

func parseCameraConfig(entity *pb.Entity) cameraConfig {
	cfg := cameraConfig{
		FovWide:  defaultFovWide,
		FovTele:  defaultFovTele,
		RangeMax: defaultRangeMax,
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

// -- cached entity & world cache ----------------------------------------------

type cachedEntity struct {
	lat, lon, alt   float64
	label           string
	sidc            string
	widthM, heightM float32
	images          []string
}

type worldCache struct {
	mu       sync.RWMutex
	entities map[string]*cachedEntity
}

func (wc *worldCache) update(id string, e *cachedEntity) {
	wc.mu.Lock()
	wc.entities[id] = e
	wc.mu.Unlock()
}

func (wc *worldCache) remove(id string) {
	wc.mu.Lock()
	delete(wc.entities, id)
	wc.mu.Unlock()
}

func (wc *worldCache) snapshot() map[string]cachedEntity {
	wc.mu.RLock()
	defer wc.mu.RUnlock()
	out := make(map[string]cachedEntity, len(wc.entities))
	for k, v := range wc.entities {
		out[k] = *v
	}
	return out
}

type wallSegment struct {
	lat0, lon0, lat1, lon1 float64
	heightM                float64
	textureID              string
	textureScaleM          float64
	fillColor              color.RGBA
}

type wallCache struct {
	mu    sync.RWMutex
	walls map[string][]wallSegment
}

func (wc *wallCache) update(id string, segs []wallSegment) {
	wc.mu.Lock()
	wc.walls[id] = segs
	wc.mu.Unlock()
}

func (wc *wallCache) remove(id string) {
	wc.mu.Lock()
	delete(wc.walls, id)
	wc.mu.Unlock()
}

func (wc *wallCache) snapshot() []wallSegment {
	wc.mu.RLock()
	defer wc.mu.RUnlock()
	var out []wallSegment
	for _, segs := range wc.walls {
		out = append(out, segs...)
	}
	return out
}

// -- camera lifecycle ---------------------------------------------------------

func runCamera(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	ensureMounted()

	entityID := entity.Id
	cfg := parseCameraConfig(entity)

	var lat, lon, alt float64
	if entity.Geo != nil {
		lat, lon = entity.Geo.Latitude, entity.Geo.Longitude
		if entity.Geo.Altitude != nil {
			alt = *entity.Geo.Altitude
		}
	}

	label := entityID
	if entity.Label != nil {
		label = *entity.Label
	}

	fpID := focalPointID(entityID)
	initZoom := cfg.RangeMax / 4

	state := &camState{
		pan: 0, tilt: 0, zoom: initZoom,
		targetPan: 0, targetTilt: 0, targetZoom: initZoom,
		lat: lat, lon: lon, alt: alt,
		label:            label,
		fovWide:          cfg.FovWide,
		fovTele:          cfg.FovTele,
		rangeMax:         cfg.RangeMax,
		renderBehindWall: cfg.RenderBehindWall,
		instantSlew:      cfg.InstantSlew,
	}

	dirtyCh := make(chan struct{}, 1)
	dirtyCh <- struct{}{}

	wc := &worldCache{entities: make(map[string]*cachedEntity)}
	walls := &wallCache{walls: make(map[string][]wallSegment)}
	fs := newFrameStore()

	registerFrameStore(entityID, fs)
	defer unregisterFrameStore(entityID)

	if err := pushCameraComponents(ctx, entityID, fpID, cfg, state, entity.Routing); err != nil {
		return fmt.Errorf("push camera components: %w", err)
	}
	defer expireFocalPoint(entityID)

	ready()

	go watchTargetPose(ctx, logger, fpID, state, dirtyCh)
	go watchCameraPosition(ctx, logger, entityID, state, dirtyCh)
	go watchEntities(ctx, logger, entityID, fpID, lat, lon, cfg.RangeMax, wc, dirtyCh)
	go watchShapes(ctx, logger, lat, lon, cfg.RangeMax, walls, dirtyCh)
	if cfg.EnableDirectDrive {
		go watchManualControl(ctx, logger, entityID, state, dirtyCh)
	}

	return renderLoop(ctx, logger, entityID, fpID, cfg.EnableDetections, state, wc, walls, fs)
}

func pushCameraComponents(ctx context.Context, camID, fpID string, cfg cameraConfig, s *camState, routing *pb.Routing) error {
	url := streamURL(camID)
	cam := &pb.Entity{
		Id: camID,
		Classification: &pb.ClassificationComponent{
			Taxonomy: []*pb.ClassificationTaxonomy{{
				Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
					Sensor: &pb.EquipmentTaxonomySensor{Kind: &pb.EquipmentTaxonomySensor_ElectroOptical{ElectroOptical: &pb.EquipmentTaxonomySensorElectroOptical{}}},
				}},
			}},
		},
		Camera: &pb.CameraComponent{
			Streams: []*pb.MediaStream{{
				Label:    "Simulated Stream",
				Url:      url,
				Protocol: pb.MediaStreamProtocol_MediaStreamProtocolMjpeg,
				Role:     pb.MediaStreamRole_MediaStreamRoleMain,
				Width:    proto.Int32(streamWidth),
				Height:   proto.Int32(streamHeight),
			}},
			FocalPoint: proto.String(fpID),
			Fov:        proto.Float64(cfg.FovWide),
			RangeMax:   proto.Float64(cfg.RangeMax),
			FovWide:    proto.Float64(cfg.FovWide),
			FovTele:    proto.Float64(cfg.FovTele),
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("video"),
		},
	}
	if cfg.EnableDirectDrive {
		cam.ManualControl = &pb.ManualControlComponent{}
	}

	pan, tilt, zoom := s.snapshotRaw()
	elev := tilt
	fp := &pb.Entity{
		Id:      fpID,
		Routing: routing,
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Pose: &pb.PoseComponent{
			Parent: camID,
			Offset: &pb.PoseComponent_Polar{
				Polar: &pb.PolarOffset{
					Azimuth:   pan,
					Elevation: &elev,
					Range:     proto.Float64(zoom),
				},
			},
		},
	}

	return controller.Push(ctx, controllerName, cam, fp)
}

func expireFocalPoint(camID string) {
	fpID := focalPointID(camID)
	grpcConn, err := builtin.BuiltinClientConn("simcam")
	if err != nil {
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: fpID})
}

// -- target pose watching -----------------------------------------------------

func watchTargetPose(ctx context.Context, logger *slog.Logger, fpID string, s *camState, dirtyCh chan struct{}) {
	grpcConn, err := builtin.BuiltinClientConn("simcam")
	if err != nil {
		logger.Warn("simcam: target pose connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &fpID,
			Component: []uint32{62},
		},
	})
	if err != nil {
		logger.Warn("simcam: target pose watch", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			return
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		tp := event.Entity.TargetPose
		if tp == nil {
			continue
		}
		polar, ok := tp.Offset.(*pb.TargetPoseComponent_Polar)
		if !ok {
			continue
		}
		az := wrap360(polar.Polar.Azimuth)
		el := 0.0
		if polar.Polar.Elevation != nil {
			el = clamp(*polar.Polar.Elevation, -89, 89)
		}
		zoom := 0.0
		if polar.Polar.Range != nil {
			_, _, rm := s.optics()
			zoom = clamp(*polar.Polar.Range, 0, rm)
		}
		s.setTarget(az, el, zoom)
		signalDirty(dirtyCh)
	}
}

// -- camera position watching -------------------------------------------------

func watchCameraPosition(ctx context.Context, logger *slog.Logger, camID string, s *camState, dirtyCh chan struct{}) {
	grpcConn, err := builtin.BuiltinClientConn("simcam")
	if err != nil {
		logger.Warn("simcam: camera position watch connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &camID,
			Component: []uint32{11},
		},
	})
	if err != nil {
		logger.Warn("simcam: camera position watch", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			return
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		geo := event.Entity.Geo
		if geo == nil {
			continue
		}
		alt := 0.0
		if geo.Altitude != nil {
			alt = *geo.Altitude
		}
		s.setPosition(geo.Latitude, geo.Longitude, alt)
		signalDirty(dirtyCh)
	}
}

// -- manual control watching --------------------------------------------------

func watchManualControl(ctx context.Context, logger *slog.Logger, camID string, s *camState, dirtyCh chan struct{}) {
	grpcConn, err := builtin.BuiltinClientConn("simcam")
	if err != nil {
		logger.Warn("simcam: manual control connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &camID,
			Component: []uint32{65},
		},
	})
	if err != nil {
		logger.Warn("simcam: manual control watch", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Warn("simcam: manual control recv", "error", err)
			return
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		tmc := event.Entity.TargetManualControl
		if tmc == nil || len(tmc.Input) == 0 {
			s.mu.Lock()
			s.manualPan = 0
			s.manualTilt = 0
			s.manualZoom = 0
			s.manualRight = 0
			s.lastManual = time.Time{}
			s.mu.Unlock()
			continue
		}
		axes := tmc.Input[0].Axes
		if axes == nil {
			s.mu.Lock()
			s.manualPan = 0
			s.manualTilt = 0
			s.manualZoom = 0
			s.manualRight = 0
			s.lastManual = time.Time{}
			s.mu.Unlock()
			continue
		}
		s.mu.Lock()
		s.manualPan = axes.GetPan()
		s.manualTilt = axes.GetTilt()
		s.manualZoom = axes.GetForward()
		s.manualRight = axes.GetRight()
		s.lastManual = time.Now()
		s.mu.Unlock()
		signalDirty(dirtyCh)
	}
}

// -- entity watching ----------------------------------------------------------

func watchEntities(ctx context.Context, logger *slog.Logger, camID, fpID string, lat, lon, rangeMax float64, wc *worldCache, dirtyCh chan struct{}) {
	grpcConn, err := builtin.BuiltinClientConn("simcam")
	if err != nil {
		logger.Warn("simcam: entity watch connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{11}, // GeoSpatialComponent
			Geo: &pb.GeoFilter{
				Geo: &pb.GeoFilter_Geometry{
					Geometry: &pb.Geometry{
						Planar: &pb.PlanarGeometry{
							Plane: &pb.PlanarGeometry_Circle{
								Circle: &pb.PlanarCircle{
									Center: &pb.PlanarPoint{
										Latitude:  lat,
										Longitude: lon,
									},
									RadiusM: rangeMax,
								},
							},
						},
					},
				},
			},
		},
	})
	if err != nil {
		logger.Warn("simcam: entity watch", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			return
		}
		ent := event.Entity
		if ent == nil {
			continue
		}
		id := ent.Id
		if id == camID || id == fpID {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			if ent.Geo == nil || ent.Symbol == nil {
				continue
			}
			ce := &cachedEntity{
				lat:  ent.Geo.Latitude,
				lon:  ent.Geo.Longitude,
				sidc: ent.Symbol.MilStd2525C,
			}
			if ent.Geo.Altitude != nil {
				ce.alt = *ent.Geo.Altitude
			}
			if ent.Label != nil {
				ce.label = *ent.Label
			}
			if adm := ent.Administrative; adm != nil {
				if adm.WidthM != nil {
					ce.widthM = *adm.WidthM
				}
				if adm.HeightM != nil {
					ce.heightM = *adm.HeightM
				}
				ce.images = adm.Images
			}
			wc.update(id, ce)
		case pb.EntityChange_EntityChangeExpired, pb.EntityChange_EntityChangeUnobserved:
			wc.remove(id)
		default:
			continue
		}
		signalDirty(dirtyCh)
	}
}

// -- shape watching -----------------------------------------------------------

func watchShapes(ctx context.Context, logger *slog.Logger, lat, lon, rangeMax float64, wc *wallCache, dirtyCh chan struct{}) {
	grpcConn, err := builtin.BuiltinClientConn("simcam")
	if err != nil {
		logger.Warn("simcam: shape watch connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{25}, // GeoShapeComponent
			Geo: &pb.GeoFilter{
				Geo: &pb.GeoFilter_Geometry{
					Geometry: &pb.Geometry{
						Planar: &pb.PlanarGeometry{
							Plane: &pb.PlanarGeometry_Circle{
								Circle: &pb.PlanarCircle{
									Center: &pb.PlanarPoint{
										Latitude:  lat,
										Longitude: lon,
									},
									RadiusM: rangeMax,
								},
							},
						},
					},
				},
			},
		},
	})
	if err != nil {
		logger.Warn("simcam: shape watch", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			return
		}
		ent := event.Entity
		if ent == nil {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			shape := ent.Shape
			if shape == nil || shape.Geometry == nil || shape.Geometry.Planar == nil {
				continue
			}
			ext := shape.Extrusion
			if ext == nil || ext.HeightM == nil || *ext.HeightM <= 0 {
				continue
			}
			heightM := *ext.HeightM
			var texID string
			var texScale float64
			fillColor := color.RGBA{160, 160, 160, 255}
			if ext.Fill != nil {
				if ext.Fill.Texture != nil {
					texID = *ext.Fill.Texture
				}
				if ext.Fill.TextureScaleM != nil {
					texScale = *ext.Fill.TextureScaleM
				}
				if ext.Fill.Color != nil {
					fillColor = parseHexColor(*ext.Fill.Color)
				}
			}
			segs := extractWallSegments(shape.Geometry.Planar, heightM, texID, texScale, fillColor)
			if len(segs) > 0 {
				wc.update(ent.Id, segs)
			}
		case pb.EntityChange_EntityChangeExpired, pb.EntityChange_EntityChangeUnobserved:
			wc.remove(ent.Id)
		default:
			continue
		}
		signalDirty(dirtyCh)
	}
}

func extractWallSegments(pg *pb.PlanarGeometry, heightM float64, texID string, texScale float64, fillColor color.RGBA) []wallSegment {
	var out []wallSegment
	switch p := pg.Plane.(type) {
	case *pb.PlanarGeometry_Polygon:
		out = append(out, ringToWallSegments(p.Polygon.Outer, heightM, texID, texScale, fillColor)...)
	case *pb.PlanarGeometry_Line:
		out = append(out, ringToWallSegments(p.Line, heightM, texID, texScale, fillColor)...)
	case *pb.PlanarGeometry_Collection:
		for _, child := range p.Collection.Geometries {
			out = append(out, extractWallSegments(child, heightM, texID, texScale, fillColor)...)
		}
	}
	return out
}

func ringToWallSegments(ring *pb.PlanarRing, heightM float64, texID string, texScale float64, fillColor color.RGBA) []wallSegment {
	if ring == nil || len(ring.Points) < 2 {
		return nil
	}
	pts := ring.Points
	out := make([]wallSegment, 0, len(pts)-1)
	for i := 0; i < len(pts)-1; i++ {
		out = append(out, wallSegment{
			lat0: pts[i].Latitude, lon0: pts[i].Longitude,
			lat1: pts[i+1].Latitude, lon1: pts[i+1].Longitude,
			heightM:       heightM,
			textureID:     texID,
			textureScaleM: texScale,
			fillColor:     fillColor,
		})
	}
	return out
}

// -- event-driven render loop -------------------------------------------------

func renderLoop(ctx context.Context, logger *slog.Logger, camID, fpID string, enableDetections bool, s *camState, wc *worldCache, walls *wallCache, fs *frameStore) error {
	grpcConn, err := builtin.BuiltinClientConn("simcam")
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	url := streamURL(camID)

	ticker := time.NewTicker(time.Second / 30)
	defer ticker.Stop()

	lastRender := time.Now()
	lastPublish := time.Now()
	publishInterval := time.Second / 5
	var lastPan, lastTilt, lastZoom float64
	var lastCamLat, lastCamLon float64

	activeDetections := make(map[string]bool)
	defer func() {
		if !enableDetections {
			return
		}
		expCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		for id := range activeDetections {
			_, _ = client.ExpireEntity(expCtx, &pb.ExpireEntityRequest{Id: id})
		}
	}()

	jpegOpts := &jpeg.Options{Quality: 70}
	var buf bytes.Buffer

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}

		now := time.Now()
		dt := now.Sub(lastRender).Seconds()
		if dt > 0.1 {
			dt = 0.1
		}
		s.advance(dt)
		lastRender = now

		camLat, camLon, camAlt := s.position()
		rc := renderContext{
			poseSnapshot:     s.snapshot(),
			camLat:           camLat,
			camLon:           camLon,
			camAlt:           camAlt,
			entities:         wc.snapshot(),
			walls:            walls.snapshot(),
			tiles:            globalTiles,
			renderBehindWall: s.renderBehindWall,
		}

		img, _ := renderFrame(rc, streamWidth, streamHeight)

		buf.Reset()
		if err := jpeg.Encode(&buf, img, jpegOpts); err != nil {
			continue
		}
		fs.put(append([]byte(nil), buf.Bytes()...))

		if enableDetections {
			changes := computeDetections(camID, rc)
			seen := make(map[string]bool, len(changes))
			for _, e := range changes {
				seen[e.Id] = true
			}
			if len(changes) > 0 {
				if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: changes}); err != nil {
					if ctx.Err() != nil {
						return nil
					}
					logger.Warn("simcam detections: push", "error", err)
				}
			}
			for id := range activeDetections {
				if !seen[id] {
					_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id})
					delete(activeDetections, id)
				}
			}
			for id := range seen {
				activeDetections[id] = true
			}
		}

		if now.Sub(lastPublish) >= publishInterval {
			pan, tilt, zoom := s.snapshotRaw()
			fovW, fovT, rm := s.optics()
			if significantlyDifferent(pan, lastPan, 0.1) ||
				significantlyDifferent(tilt, lastTilt, 0.1) ||
				significantlyDifferent(zoom, lastZoom, 0.05) {
				pushPose(ctx, client, fpID, camID, url, pan, tilt, zoom, fovW, fovT, rm)
				lastPan, lastTilt, lastZoom = pan, tilt, zoom
			}
			if significantlyDifferent(camLat, lastCamLat, 0.000001) ||
				significantlyDifferent(camLon, lastCamLon, 0.000001) {
				_, _ = client.Push(ctx, &pb.EntityChangeRequest{
					Changes: []*pb.Entity{{
						Id: camID,
						Geo: &pb.GeoSpatialComponent{
							Latitude:  camLat,
							Longitude: camLon,
							Altitude:  proto.Float64(camAlt),
						},
					}},
				})
				lastCamLat = camLat
				lastCamLon = camLon
			}
			lastPublish = now
		}
	}
}

func pushPose(ctx context.Context, client pb.WorldServiceClient, fpID, camID string, streamURL string, pan, tilt, zoom, fovWide, fovTele, rangeMax float64) {
	elev := tilt
	_, _ = client.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{
				Id: fpID,
				Pose: &pb.PoseComponent{
					Parent: camID,
					Offset: &pb.PoseComponent_Polar{
						Polar: &pb.PolarOffset{
							Azimuth:   pan,
							Elevation: &elev,
							Range:     proto.Float64(zoom),
						},
					},
				},
			},
			{
				Id: camID,
				Camera: &pb.CameraComponent{
					Streams: []*pb.MediaStream{{
						Label:    "Simulated Stream",
						Url:      streamURL,
						Protocol: pb.MediaStreamProtocol_MediaStreamProtocolMjpeg,
						Role:     pb.MediaStreamRole_MediaStreamRoleMain,
						Width:    proto.Int32(streamWidth),
						Height:   proto.Int32(streamHeight),
					}},
					FocalPoint: proto.String(fpID),
					Fov:        proto.Float64(effectiveFovDeg(zoom, fovWide, fovTele, rangeMax)),
					RangeMax:   proto.Float64(rangeMax),
					FovWide:    proto.Float64(fovWide),
					FovTele:    proto.Float64(fovTele),
				},
			},
		},
	})
}

// -- camState -----------------------------------------------------------------

type camState struct {
	mu                                sync.Mutex
	pan, tilt, zoom                   float64
	targetPan, targetTilt, targetZoom float64
	lat, lon, alt                     float64
	label                             string
	fovWide, fovTele, rangeMax        float64
	renderBehindWall                  bool
	instantSlew                       bool
	frame                             atomic.Uint64
	manualPan, manualTilt, manualZoom float32
	manualRight                       float32
	lastManual                        time.Time
}

func (s *camState) optics() (fovWide, fovTele, rangeMax float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fovWide, s.fovTele, s.rangeMax
}

func (s *camState) setPosition(lat, lon, alt float64) {
	s.mu.Lock()
	s.lat = lat
	s.lon = lon
	s.alt = alt
	s.mu.Unlock()
}

func (s *camState) position() (float64, float64, float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lat, s.lon, s.alt
}

func (s *camState) setTarget(pan, tilt, zoom float64) {
	s.mu.Lock()
	s.targetPan = pan
	s.targetTilt = tilt
	s.targetZoom = zoom
	s.mu.Unlock()
}

func (s *camState) advance(dt float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.lastManual.IsZero() {
		if time.Since(s.lastManual) > time.Second/15 {
			s.manualPan = 0
			s.manualTilt = 0
			s.manualZoom = 0
			s.manualRight = 0
			s.lastManual = time.Time{}
		} else {
			s.targetPan = wrap360(s.targetPan + float64(s.manualPan)*panRateDegPerSec*0.15*dt)
			s.targetTilt = clamp(s.targetTilt+float64(s.manualTilt)*tiltRateDegPerSec*0.15*dt, -89, 89)
			s.targetZoom = clamp(s.targetZoom+float64(s.manualZoom)*s.rangeMax*0.6*dt, 0, s.rangeMax)
			if s.manualRight != 0 {
				panRad := s.pan * math.Pi / 180
				cosLat := math.Cos(s.lat * math.Pi / 180)
				dEast := math.Cos(panRad) * float64(s.manualRight) * moveSpeedMPerSec * dt
				dNorth := -math.Sin(panRad) * float64(s.manualRight) * moveSpeedMPerSec * dt
				s.lat += dNorth / 111320
				if cosLat > 0 {
					s.lon += dEast / (111320 * cosLat)
				}
			}
		}
	}
	if s.instantSlew {
		s.pan = wrap360(s.targetPan)
		s.tilt = s.targetTilt
		s.zoom = s.targetZoom
	} else {
		s.pan = stepAngle(s.pan, s.targetPan, panRateDegPerSec*dt)
		s.tilt = stepLinear(s.tilt, s.targetTilt, tiltRateDegPerSec*dt)
		s.zoom = stepLinear(s.zoom, s.targetZoom, s.rangeMax*4*dt)
	}
	s.frame.Add(1)
}

func (s *camState) snapshotRaw() (pan, tilt, zoom float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pan, s.tilt, s.zoom
}

func (s *camState) snapshot() poseSnapshot {
	s.mu.Lock()
	pan, tilt, zoom := s.pan, s.tilt, s.zoom
	label := s.label
	fovWide, fovTele, rangeMax := s.fovWide, s.fovTele, s.rangeMax
	s.mu.Unlock()
	return poseSnapshot{
		Pan:      pan,
		Tilt:     tilt,
		Zoom:     zoom,
		FovDeg:   effectiveFovDeg(zoom, fovWide, fovTele, rangeMax),
		RangeMax: rangeMax,
		Label:    label,
		Frame:    s.frame.Load(),
	}
}

func effectiveFovDeg(zoom, fovWide, fovTele, rangeMax float64) float64 {
	if rangeMax <= 0 {
		return fovWide
	}
	t := zoom / rangeMax
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	return fovWide + t*(fovTele-fovWide)
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
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func significantlyDifferent(a, b, eps float64) bool {
	return math.Abs(a-b) >= eps
}

func signalDirty(ch chan struct{}) {
	select {
	case ch <- struct{}{}:
	default:
	}
}
