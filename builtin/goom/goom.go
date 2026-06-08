package goom

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sync"
	"time"

	"github.com/aep/goom"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	controllerName  = "goom"
	serviceEntityID = controllerName + ".service"
	playerEntityID  = controllerName + ".player"

	anchorLatitude  = 51.9555
	anchorLongitude = 4.1694

	simcamServiceID = "simcam.service"
)

var cosLat = math.Cos(anchorLatitude * math.Pi / 180)

func gameAngleToAzimuth(angle float64) float64 {
	az := math.Atan2(math.Cos(angle)*cosLat, -math.Sin(angle)) * 180 / math.Pi
	if az < 0 {
		az += 360
	}
	return az
}

func azimuthToGameAngle(azDeg float64) float64 {
	r := azDeg * math.Pi / 180
	return math.Atan2(-math.Cos(r), math.Sin(r)/cosLat)
}

func init() {
	builtin.Register(controllerName, Run)
}

func instantSlewConfig() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"instant_slew": true,
	})
	return s
}

func goomSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"enabled": map[string]any{
				"type":        "boolean",
				"title":       "Enabled",
				"description": "Start the Goom easter egg",
			},
		},
	})
	return s
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	if err := controller.Push(ctx, controllerName, &pb.Entity{
		Id:      serviceEntityID,
		Label:   proto.String("Goom"),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Mission"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Configurable: &pb.ConfigurableComponent{
			Schema: goomSchema(),
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("skull"),
		},
	}); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	return controller.Run(ctx, controllerName, serviceEntityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
		if !isEnabled(entity) {
			ready()
			<-ctx.Done()
			return nil
		}
		ready()
		return runGame(ctx, logger)
	})
}

func isEnabled(entity *pb.Entity) bool {
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return false
	}
	v, ok := entity.Config.Value.Fields["enabled"]
	return ok && v.GetBoolValue()
}

func runGame(ctx context.Context, logger *slog.Logger) error {
	game, err := goom.New(320, 200)
	if err != nil {
		return fmt.Errorf("init goom: %w", err)
	}

	s := &state{game: game, activeEnemyIDs: make(map[string]bool), activePickupIDs: make(map[string]bool)}

	if err := pushEntities(ctx, s); err != nil {
		return fmt.Errorf("push entities: %w", err)
	}
	if err := pushSprites(ctx); err != nil {
		return fmt.Errorf("push sprites: %w", err)
	}
	if err := pushTaskables(ctx); err != nil {
		return fmt.Errorf("push taskables: %w", err)
	}
	if err := pushEnemyTracks(ctx, s); err != nil {
		logger.Warn("push enemy tracks", "error", err)
	}
	if err := pushWallGeometry(ctx, s); err != nil {
		logger.Warn("push wall geometry", "error", err)
	}

	grpcConn, err := builtin.BuiltinClientConn("goom")
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	go watchTargetPose(ctx, logger, client, s)
	go watchTaskExecutions(ctx, logger, client, s)
	go watchManualControl(ctx, logger, client, s)

	ticker := time.NewTicker(time.Second / 30)
	defer ticker.Stop()

	var tick uint32
	for {
		select {
		case <-ctx.Done():
			expireAll(ctx, s)
			return ctx.Err()
		case <-ticker.C:
			tick++
			s.mu.Lock()
			if !s.lastControl.IsZero() && time.Since(s.lastControl) > time.Second/30 {
				s.axisForward = 0
				s.axisRight = 0
				s.axisPan = 0
				s.axisTilt = 0
				s.lastControl = time.Time{}
			}
			if s.axisForward != 0 {
				s.game.MoveForward(float64(s.axisForward) * moveStep)
			}
			if s.axisRight != 0 {
				s.game.StrafeRight(float64(s.axisRight) * moveStep)
			}
			if s.axisPan != 0 {
				s.game.Pan(float64(s.axisPan) * 0.02)
			}
			if s.axisTilt != 0 {
				delta := float64(s.axisTilt) * 2
				s.game.Tilt(delta)
				s.viewTiltDeg += delta * 45 / 100
				if s.viewTiltDeg > 45 {
					s.viewTiltDeg = 45
				} else if s.viewTiltDeg < -45 {
					s.viewTiltDeg = -45
				}
			}
			s.game.Tick()
			s.mu.Unlock()
			slow := tick%6 == 0
			publishAll(ctx, client, s, slow)
		}
	}
}

type state struct {
	mu              sync.Mutex
	game            *goom.Game
	activeEnemyIDs  map[string]bool
	activePickupIDs map[string]bool
	axisForward     float32
	axisRight       float32
	axisPan         float32
	axisTilt        float32
	lastControl     time.Time
	viewTiltDeg     float64
}

func pushEntities(ctx context.Context, s *state) error {
	s.mu.Lock()
	px, py, _ := s.game.Position()
	s.mu.Unlock()

	player := &pb.Entity{
		Id:      playerEntityID,
		Label:   proto.String("Goom"),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		ManualControl: &pb.ManualControlComponent{},
		Config: &pb.ConfigurationComponent{
			Value: instantSlewConfig(),
		},
		Device: &pb.DeviceComponent{
			Parent: proto.String(simcamServiceID),
			Class:  proto.String("camera"),
			State:  pb.DeviceState_DeviceStateActive,
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  anchorLatitude - py*0.00001,
			Longitude: anchorLongitude + px*0.00001,
			Altitude:  proto.Float64(1.5),
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: "SFGPUCI---",
		},
		Lifetime: &pb.Lifetime{},
	}

	return controller.Push(ctx, controllerName, player)
}

func publishAll(ctx context.Context, client pb.WorldServiceClient, s *state, slow bool) {
	s.mu.Lock()
	px, py, angle := s.game.Position()
	tiltDeg := s.viewTiltDeg
	var enemies []goom.Enemy
	var pickups []goom.Pickup
	var health int
	var ammo int
	var kills int
	if slow {
		enemies = s.game.Enemies()
		pickups = s.game.Pickups()
		health = s.game.Health()
		ammo = s.game.Ammo()
		kills = s.game.Kills()
	}
	s.mu.Unlock()

	az := gameAngleToAzimuth(angle)

	changes := []*pb.Entity{
		{
			Id: playerEntityID,
			Geo: &pb.GeoSpatialComponent{
				Latitude:  anchorLatitude - py*0.00001,
				Longitude: anchorLongitude + px*0.00001,
				Altitude:  proto.Float64(1.5),
			},
		},
		{
			Id: playerEntityID + "~fp",
			TargetPose: &pb.TargetPoseComponent{
				Offset: &pb.TargetPoseComponent_Polar{
					Polar: &pb.PolarOffset{
						Azimuth:   az,
						Elevation: &tiltDeg,
					},
				},
			},
		},
	}

	if slow {
		// enemies
		newEnemyIDs := make(map[string]bool, len(enemies))
		for i, e := range enemies {
			ent := enemyToEntity(i, e)
			newEnemyIDs[ent.Id] = true
			changes = append(changes, ent)
		}
		for id := range s.activeEnemyIDs {
			if !newEnemyIDs[id] {
				_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id})
			}
		}
		s.activeEnemyIDs = newEnemyIDs

		// pickups
		newPickupIDs := make(map[string]bool)
		for i, p := range pickups {
			if !p.Active {
				continue
			}
			id := pickupEntityID(i)
			newPickupIDs[id] = true
			icon := "package"
			sidc := "ENFPCC----H****"
			spriteID := ammoSpriteID
			if p.Health {
				icon = "heart-pulse"
				sidc = "ENOPA-----*****"
				spriteID = healthSpriteID
			}
			changes = append(changes, &pb.Entity{
				Id:      id,
				Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
				Controller: &pb.Controller{
					Id: proto.String(controllerName),
				},
				Geo: &pb.GeoSpatialComponent{
					Latitude:  anchorLatitude - p.Y*0.00001,
					Longitude: anchorLongitude + p.X*0.00001,
					Altitude:  proto.Float64(0.15),
				},
				Symbol: &pb.SymbolComponent{
					MilStd2525C: sidc,
				},
				Administrative: &pb.AdministrativeComponent{
					WidthM:  proto.Float32(0.3),
					HeightM: proto.Float32(0.3),
					Images:  []string{spriteID},
				},
				Interactivity: &pb.InteractivityComponent{
					Icon: proto.String(icon),
				},
			})
		}
		for id := range s.activePickupIDs {
			if !newPickupIDs[id] {
				_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id})
			}
		}
		s.activePickupIDs = newPickupIDs

		// metrics
		changes = append(changes, &pb.Entity{
			Id: playerEntityID,
			Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
				{
					Kind:  pb.MetricKind_MetricKindHealth.Enum(),
					Unit:  pb.MetricUnit_MetricUnitPercent,
					Label: proto.String("Health"),
					Id:    proto.Uint32(1),
					Val:   &pb.Metric_Double{Double: float64(health)},
				},
				{
					Kind:  pb.MetricKind_MetricKindAmmo.Enum(),
					Unit:  pb.MetricUnit_MetricUnitCount,
					Label: proto.String("Ammo"),
					Id:    proto.Uint32(3),
					Val:   &pb.Metric_Uint64{Uint64: uint64(ammo)},
				},
				{
					Kind:  pb.MetricKind_MetricKindCount.Enum(),
					Unit:  pb.MetricUnit_MetricUnitCount,
					Label: proto.String("Kills"),
					Id:    proto.Uint32(2),
					Val:   &pb.Metric_Uint64{Uint64: uint64(kills)},
				},
			}},
		})
	}

	_, _ = client.Push(ctx, &pb.EntityChangeRequest{Changes: changes})
}

func watchTargetPose(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, s *state) {
	id := playerEntityID + "~fp"
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &id,
			Component: []uint32{62}, // TargetPoseComponent
		},
	})
	if err != nil {
		logger.Warn("goom: target pose watch", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Warn("goom: target pose recv", "error", err)
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
		azRad := azimuthToGameAngle(polar.Polar.Azimuth)
		tiltRad := 0.0
		if polar.Polar.Elevation != nil {
			tiltRad = *polar.Polar.Elevation * math.Pi / 180
		}

		s.mu.Lock()
		s.game.SetView(azRad, tiltRad)
		s.viewTiltDeg = tiltRad * 180 / math.Pi
		s.mu.Unlock()
	}
}

func enemyEntityID(i int) string {
	return fmt.Sprintf("%s.enemy.%d", controllerName, i)
}

func pushEnemyTracks(ctx context.Context, s *state) error {
	s.mu.Lock()
	enemies := s.game.Enemies()
	s.mu.Unlock()

	var entities []*pb.Entity
	for i, e := range enemies {
		entities = append(entities, enemyToEntity(i, e))
	}
	return controller.Push(ctx, controllerName, entities...)
}

func pickupEntityID(i int) string {
	return fmt.Sprintf("%s.pickup.%d", controllerName, i)
}

func enemyToEntity(i int, e goom.Enemy) *pb.Entity {
	return &pb.Entity{
		Id:      enemyEntityID(i),
		Label:   proto.String(fmt.Sprintf("Imp %d", i+1)),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  anchorLatitude - e.Y*0.00001,
			Longitude: anchorLongitude + e.X*0.00001,
			Altitude:  proto.Float64(0.9),
		},
		Track: &pb.TrackComponent{
			Tracker: proto.String(playerEntityID),
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: "SHGPE-----",
		},
		Administrative: &pb.AdministrativeComponent{
			WidthM:  proto.Float32(0.5),
			HeightM: proto.Float32(1.8),
			Images:  []string{enemySpriteID},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("skull"),
		},
	}
}

const wallEntityID = controllerName + ".wall"

func tileToGeo(tx, ty int) (lat, lon float64) {
	return anchorLatitude - float64(ty)*0.00001, anchorLongitude + float64(tx)*0.00001
}

func pushWallGeometry(ctx context.Context, s *state) error {
	s.mu.Lock()
	wm := s.game.WallMap()
	s.mu.Unlock()

	var polys []*pb.PlanarGeometry
	for y, row := range wm {
		for x, tile := range row {
			if tile == 0 {
				continue
			}
			lat0, lon0 := tileToGeo(x, y)
			lat1, lon1 := tileToGeo(x+1, y+1)
			polys = append(polys, &pb.PlanarGeometry{
				Plane: &pb.PlanarGeometry_Polygon{Polygon: &pb.PlanarPolygon{
					Outer: &pb.PlanarRing{Points: []*pb.PlanarPoint{
						{Latitude: lat0, Longitude: lon0},
						{Latitude: lat0, Longitude: lon1},
						{Latitude: lat1, Longitude: lon1},
						{Latitude: lat1, Longitude: lon0},
						{Latitude: lat0, Longitude: lon0},
					}},
				}},
			})
		}
	}

	return controller.Push(ctx, controllerName, &pb.Entity{
		Id:      wallEntityID,
		Label:   proto.String("Arena"),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  anchorLatitude,
			Longitude: anchorLongitude,
		},
		Shape: &pb.GeoShapeComponent{
			Geometry: &pb.Geometry{
				Planar: &pb.PlanarGeometry{
					Plane: &pb.PlanarGeometry_Collection{Collection: &pb.PlanarGeometryCollection{
						Geometries: polys,
					}},
				},
			},
			Extrusion: &pb.GeometryExtrusion{
				HeightM: proto.Float64(3.0),
				Fill: &pb.FillStyle{
					Color: proto.String("#808080"),
				},
			},
		},
	})
}

func expireAll(ctx context.Context, s *state) {
	grpcConn, err := builtin.BuiltinClientConn("goom")
	if err != nil {
		return
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: playerEntityID})
	_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: wallEntityID})
	_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: enemySpriteID})
	_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: healthSpriteID})
	_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: ammoSpriteID})

	for id := range s.activeEnemyIDs {
		_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id})
	}
	for id := range s.activePickupIDs {
		_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id})
	}
	for _, tid := range taskableIDs() {
		_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: tid})
	}
}
