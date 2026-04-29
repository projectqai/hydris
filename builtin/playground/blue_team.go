package playground

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ---------------------------------------------------------------
// Blue Team — two hiking teams in the Swiss Alps (Zermatt area)
// ---------------------------------------------------------------

// Trail waypoints: Team Alpha heads to Gornergrat, Team Bravo to Schwarzsee.
var (
	trailAlpha = []trailPoint{
		{46.0207, 7.7486, 1620}, // Zermatt
		{46.0150, 7.7550, 1800},
		{46.0100, 7.7620, 2100},
		{46.0050, 7.7700, 2500},
		{46.0020, 7.7850, 2900},
		{45.9983, 7.7862, 3089}, // Gornergrat
	}
	trailBravo = []trailPoint{
		{46.0207, 7.7486, 1620}, // Zermatt
		{46.0180, 7.7400, 1750},
		{46.0140, 7.7350, 1950},
		{46.0100, 7.7300, 2200},
		{46.0060, 7.7250, 2550},
		{46.0030, 7.7200, 2583}, // Schwarzsee
	}
	campLocation = trailPoint{46.0207, 7.7486, 1620}
)

type trailPoint struct{ lat, lon, alt float64 }

// --- Hiker definitions ---

type hikerSpec struct {
	key    string
	name   string
	team   string
	leader bool
	trail  []trailPoint
}

var hikerSpecs = []hikerSpec{
	{"alice", "Alice", "Alpha", true, trailAlpha},
	{"bob", "Bob", "Alpha", false, trailAlpha},
	{"charlie", "Charlie", "Alpha", false, trailAlpha},
	{"diana", "Diana", "Bravo", true, trailBravo},
	{"erik", "Erik", "Bravo", false, trailBravo},
}

// --- Chat script ---

// chatCycleTicks is the number of ticks after which the script repeats.
const chatCycleTicks = 130

type chatLine struct {
	hikerIdx int
	message  string
	atTick   int // fires when tick%chatCycleTicks == atTick
}

var chatScript = []chatLine{
	{0, "Alpha team at base camp, preparing to move out", 5},
	{3, "Bravo team ready, heading toward Schwarzsee", 10},
	{0, "Copy Bravo, we're taking the Gornergrat trail", 15},
	{1, "Weather looks clear from here", 25},
	{4, "Wind is picking up on our side", 35},
	{0, "Alpha passing the treeline now", 45},
	{3, "Bravo reached the first ridge, great view of the Matterhorn", 55},
	{2, "Charlie here, taking a short break", 65},
	{3, "Diana reporting, Bravo continuing upward", 75},
	{0, "Alpha at 2500m, feeling the altitude", 85},
	{1, "Bob here, can see the Gornergrat station above us", 95},
	{4, "Erik reporting, trail getting steep", 105},
	{2, "Snow patches ahead, watching our footing", 115},
	{0, "Alpha approaching the summit ridge", 125},
}

// --- Detection events ---

// detectionCycleTicks is the number of ticks after which the detection script repeats.
const detectionCycleTicks = 200

type detectionSpec struct {
	hikerIdx       int
	classification string
	label          string
	symbol         string
	atTick         int
	dangerZoneM    float64 // if > 0, also emit a hostile GeoShape circle around the sighting
}

var detectionScript = []detectionSpec{
	{1, "cat", "European Wildcat", "SNGPU-----*****", 20, 0},
	{4, "marmot", "Alpine Marmot", "SNGPU-----*****", 45, 0},
	{0, "ibex", "Alpine Ibex", "SNGPU-----*****", 70, 0},
	{2, "chamois", "Chamois", "SNGPU-----*****", 100, 0},
	{3, "bear", "Brown Bear", "SHGPU-----*****", 130, 200}, // hostile symbol + 200m danger zone
	{1, "eagle", "Golden Eagle", "SNAPU-----*****", 160, 0},
	{4, "marmot", "Alpine Marmot", "SNGPU-----*****", 185, 0},
}

// --- Per-hiker runtime state ---

type blueTeamConfig struct {
	UpdateIntervalMs int `json:"update_interval_ms"`
}

type hiker struct {
	id     string
	name   string
	team   string
	leader bool
	trail  []trailPoint

	progress float64
	speed    float64

	lat, lon, alt    float64
	velE, velN, velU float64

	heartRate     float64
	spo2          float64
	bodyTemp      float64
	windSpeed     float64
	windDirection float64
	radioRssi     int32
	radioBattery  float32
	radioVoltage  float32
}

func initHikers(parentID string) []*hiker {
	hikers := make([]*hiker, len(hikerSpecs))
	for i, spec := range hikerSpecs {
		h := &hiker{
			id:            fmt.Sprintf("%s.%s", parentID, spec.key),
			name:          spec.name,
			team:          spec.team,
			leader:        spec.leader,
			trail:         spec.trail,
			progress:      float64(i%3) * 0.02,
			speed:         0.002 + rand.Float64()*0.0005,
			heartRate:     72 + rand.Float64()*8,
			spo2:          97 + rand.Float64()*2,
			bodyTemp:      36.5 + rand.Float64()*0.4,
			windSpeed:     3 + rand.Float64()*2,
			windDirection: rand.Float64() * 360,
			radioRssi:     -60 - int32(rand.IntN(10)),
			radioBattery:  0.7 + float32(rand.Float64())*0.3,
			radioVoltage:  3.9,
		}
		h.resolvePosition()
		h.computeVelocity(1.2)
		hikers[i] = h
	}
	return hikers
}

func (h *hiker) resolvePosition() {
	n := len(h.trail)
	totalSeg := float64(n - 1)
	pos := h.progress * totalSeg

	if pos <= 0 {
		wp := h.trail[0]
		h.lat, h.lon, h.alt = wp.lat, wp.lon, wp.alt
		return
	}
	if pos >= totalSeg {
		wp := h.trail[n-1]
		h.lat, h.lon, h.alt = wp.lat, wp.lon, wp.alt
		return
	}

	seg := int(pos)
	frac := pos - float64(seg)
	a, b := h.trail[seg], h.trail[seg+1]
	h.lat = a.lat + (b.lat-a.lat)*frac
	h.lon = a.lon + (b.lon-a.lon)*frac
	h.alt = a.alt + (b.alt-a.alt)*frac
}

func (h *hiker) computeVelocity(speedMs float64) {
	n := len(h.trail)
	totalSeg := float64(n - 1)
	pos := h.progress * totalSeg
	seg := int(pos)
	if seg >= n-1 {
		seg = n - 2
	}
	if seg < 0 {
		seg = 0
	}
	a, b := h.trail[seg], h.trail[seg+1]

	dNorth := (b.lat - a.lat) * 111000
	dEast := (b.lon - a.lon) * 111000 * math.Cos(a.lat*math.Pi/180)
	dUp := b.alt - a.alt
	dist := math.Sqrt(dNorth*dNorth + dEast*dEast + dUp*dUp)
	if dist < 1 {
		h.velE, h.velN, h.velU = 0, 0, 0
		return
	}
	h.velE = dEast / dist * speedMs
	h.velN = dNorth / dist * speedMs
	h.velU = dUp / dist * speedMs
}

func (h *hiker) step() {
	h.progress += h.speed
	if h.progress > 1.0 {
		h.progress = 0.0
	}
	h.resolvePosition()
	h.computeVelocity(1.2 + rand.Float64()*0.3)

	// Heart rate rises with altitude.
	altFactor := (h.alt - 1600) / 1500 * 35
	h.heartRate = 72 + altFactor + (rand.Float64()-0.5)*6
	h.heartRate = max(55, min(180, h.heartRate))

	// SpO₂ drops at altitude.
	altDrop := (h.alt - 1600) / 1500 * 7
	h.spo2 = 98 - altDrop + (rand.Float64()-0.5)*1.5
	h.spo2 = max(85, min(100, h.spo2))

	// Body temperature drifts slightly.
	h.bodyTemp += (rand.Float64() - 0.5) * 0.1
	h.bodyTemp = max(36.0, min(38.5, h.bodyTemp))

	// Wind increases with altitude.
	altWind := (h.alt - 1600) / 1500 * 8
	h.windSpeed = 2 + altWind + (rand.Float64()-0.5)*2
	h.windSpeed = math.Max(0, h.windSpeed)
	h.windDirection = math.Mod(h.windDirection+(rand.Float64()-0.5)*8+360, 360)

	// Radio degrades with altitude/distance from camp.
	h.radioRssi = -55 - int32((h.alt-1600)/1500*30) + int32(rand.IntN(5)) - 2
	h.radioRssi = max(-110, min(-40, h.radioRssi))
	h.radioBattery += float32(rand.Float64()-0.52) * 0.003
	h.radioBattery = max(0.15, min(1.0, h.radioBattery))
	h.radioVoltage = 3.3 + h.radioBattery*0.9
}

// --- Helpers ---

func teamMemberIDs(hikers []*hiker, teamName string) []string {
	var ids []string
	for _, h := range hikers {
		if h.team == teamName {
			ids = append(ids, h.id)
		}
	}
	return ids
}

func teamDestination(teamName string) string {
	if teamName == "Alpha" {
		return "Gornergrat (3089m)"
	}
	return "Schwarzsee (2583m)"
}

// --- Entity builders ---

func buildHikerEntity(h *hiker, blueTeamEntityID string, memberIDs []string, ttl *timestamppb.Timestamp) *pb.Entity {
	e := &pb.Entity{
		Id:      h.id,
		Label:   proto.String(fmt.Sprintf("Blue %s — %s", h.team, h.name)),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Device: &pb.DeviceComponent{
			Parent: proto.String(blueTeamEntityID),
			State:  pb.DeviceState_DeviceStateActive,
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  h.lat,
			Longitude: h.lon,
			Altitude:  proto.Float64(h.alt),
		},
		Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPUC----*****"},
		Kinematics: &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				East:  proto.Float64(h.velE),
				North: proto.Float64(h.velN),
				Up:    proto.Float64(h.velU),
			},
		},
		Lifetime: &pb.Lifetime{Until: ttl},
	}
	if h.leader {
		e.Mission = &pb.MissionComponent{
			Members:     memberIDs,
			Description: proto.String(fmt.Sprintf("Team %s alpine reconnaissance", h.team)),
			Destination: proto.String(teamDestination(h.team)),
		}
	}
	return e
}

func buildWindSensor(h *hiker, ttl *timestamppb.Timestamp) *pb.Entity {
	now := timestamppb.Now()
	return &pb.Entity{
		Id:    h.id + ".wind",
		Label: proto.String(h.name + " Wind Sensor"),
		Device: &pb.DeviceComponent{
			Parent: proto.String(h.id),
			State:  pb.DeviceState_DeviceStateActive,
		},
		Assembly: &pb.AssemblyComponent{Parent: proto.String(h.id)},
		Pose: &pb.PoseComponent{
			Parent: h.id,
			Offset: &pb.PoseComponent_Cartesian{
				Cartesian: &pb.CartesianOffset{
					UpM: proto.Float64(0.3), // backpack top
				},
			},
		},
		Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPE-----*****"},
		Sensor: &pb.SensorComponent{},
		Metric: &pb.MetricComponent{
			Metrics: []*pb.Metric{
				{
					Kind:       pb.MetricKind_MetricKindWindSpeed.Enum(),
					Unit:       pb.MetricUnit_MetricUnitMeterPerSecond,
					Label:      proto.String("Wind Speed"),
					Id:         proto.Uint32(1),
					MeasuredAt: now,
					Val:        &pb.Metric_Double{Double: h.windSpeed},
				},
				{
					Kind:       pb.MetricKind_MetricKindWindDirection.Enum(),
					Unit:       pb.MetricUnit_MetricUnitDegree,
					Label:      proto.String("Wind Direction"),
					Id:         proto.Uint32(2),
					MeasuredAt: now,
					Val:        &pb.Metric_Double{Double: h.windDirection},
				},
			},
		},
		Lifetime: &pb.Lifetime{Until: ttl},
	}
}

func buildVitalSensor(h *hiker, ttl *timestamppb.Timestamp) *pb.Entity {
	now := timestamppb.Now()
	return &pb.Entity{
		Id:    h.id + ".vitals",
		Label: proto.String(h.name + " Vital Monitor"),
		Device: &pb.DeviceComponent{
			Parent: proto.String(h.id),
			State:  pb.DeviceState_DeviceStateActive,
		},
		Assembly: &pb.AssemblyComponent{Parent: proto.String(h.id)},
		Pose: &pb.PoseComponent{
			Parent: h.id,
			Offset: &pb.PoseComponent_Cartesian{
				Cartesian: &pb.CartesianOffset{
					EastM: 0.1, // chest strap
				},
			},
		},
		Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPE-----*****"},
		Sensor: &pb.SensorComponent{},
		Metric: &pb.MetricComponent{
			Metrics: []*pb.Metric{
				{
					Kind:       pb.MetricKind_MetricKindHeartRate.Enum(),
					Unit:       pb.MetricUnit_MetricUnitBeatsPerMinute,
					Label:      proto.String("Heart Rate"),
					Id:         proto.Uint32(1),
					MeasuredAt: now,
					Val:        &pb.Metric_Double{Double: h.heartRate},
				},
				{
					Kind:       pb.MetricKind_MetricKindOxygenSaturation.Enum(),
					Unit:       pb.MetricUnit_MetricUnitPercent,
					Label:      proto.String("SpO₂"),
					Id:         proto.Uint32(2),
					MeasuredAt: now,
					Val:        &pb.Metric_Double{Double: h.spo2},
				},
				{
					Kind:       pb.MetricKind_MetricKindBodyTemperature.Enum(),
					Unit:       pb.MetricUnit_MetricUnitCelsius,
					Label:      proto.String("Body Temp"),
					Id:         proto.Uint32(3),
					MeasuredAt: now,
					Val:        &pb.Metric_Double{Double: h.bodyTemp},
				},
			},
		},
		Lifetime: &pb.Lifetime{Until: ttl},
	}
}

func buildRadioEntity(h *hiker, campID string, ttl *timestamppb.Timestamp) *pb.Entity {
	now := timestamppb.Now()
	linkStatus := pb.LinkStatus_LinkStatusConnected
	if h.radioRssi < -85 {
		linkStatus = pb.LinkStatus_LinkStatusDegraded
	}
	return &pb.Entity{
		Id:    h.id + ".radio",
		Label: proto.String(h.name + " Radio"),
		Device: &pb.DeviceComponent{
			Parent: proto.String(h.id),
			State:  pb.DeviceState_DeviceStateActive,
		},
		Assembly: &pb.AssemblyComponent{Parent: proto.String(h.id)},
		Pose: &pb.PoseComponent{
			Parent: h.id,
			Offset: &pb.PoseComponent_Cartesian{
				Cartesian: &pb.CartesianOffset{
					EastM: 0.15,
					UpM:   proto.Float64(-0.2), // on hip
				},
			},
		},
		Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPE-----*****"},
		Link: &pb.LinkComponent{
			Status:   linkStatus.Enum(),
			RssiDbm:  proto.Int32(h.radioRssi),
			SnrDb:    proto.Int32(h.radioRssi + 30),
			Via:      proto.String(campID),
			LastSeen: now,
		},
		Power: &pb.PowerComponent{
			BatteryChargeRemaining: proto.Float32(h.radioBattery),
			Voltage:                proto.Float32(h.radioVoltage),
		},
		Lifetime: &pb.Lifetime{Until: ttl},
	}
}

func buildCampEntity(parentID string, ttl *timestamppb.Timestamp) *pb.Entity {
	return &pb.Entity{
		Id:      parentID + ".camp",
		Label:   proto.String("Base Camp Zermatt"),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Device: &pb.DeviceComponent{
			Parent: proto.String(parentID),
			State:  pb.DeviceState_DeviceStateActive,
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  campLocation.lat,
			Longitude: campLocation.lon,
			Altitude:  proto.Float64(campLocation.alt),
		},
		Symbol:   &pb.SymbolComponent{MilStd2525C: "SFGPI-----*****"},
		Lifetime: &pb.Lifetime{Until: ttl},
	}
}

func buildChatEntity(parentID string, h *hiker, message string, tick, idx int) *pb.Entity {
	now := time.Now()
	return &pb.Entity{
		Id:      fmt.Sprintf("%s.chat.%d.%d", parentID, tick, idx),
		Label:   proto.String(h.name),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Chat: &pb.ChatComponent{
			Sender:  proto.String(h.id),
			Message: message,
		},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(now),
			Until: timestamppb.New(now.Add(1 * time.Hour)),
		},
	}
}

func buildDetectionEntity(parentID string, h *hiker, det detectionSpec, tick int) *pb.Entity {
	now := time.Now()
	// Place the animal 20–60 m from the hiker.
	latOff := (rand.Float64() - 0.5) * 0.0008
	lonOff := (rand.Float64() - 0.5) * 0.0008
	return &pb.Entity{
		Id:      fmt.Sprintf("%s.det.%d", parentID, tick),
		Label:   proto.String(det.label),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  h.lat + latOff,
			Longitude: h.lon + lonOff,
			Altitude:  proto.Float64(h.alt),
		},
		Symbol: &pb.SymbolComponent{MilStd2525C: det.symbol},
		Detection: &pb.DetectionComponent{
			DetectorEntityId: proto.String(h.id),
			Classification:   proto.String(det.classification),
			LastMeasured:     timestamppb.New(now),
		},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(now),
			Until: timestamppb.New(now.Add(5 * time.Minute)),
		},
	}
}

func buildDangerZoneEntity(parentID string, detEntity *pb.Entity, radiusM float64, tick int) *pb.Entity {
	now := time.Now()
	return &pb.Entity{
		Id:      fmt.Sprintf("%s.zone.%d", parentID, tick),
		Label:   proto.String("Danger Zone — " + detEntity.GetLabel()),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Symbol:  &pb.SymbolComponent{MilStd2525C: "SHGPG-----*****"}, // hostile ground zone
		Shape: &pb.GeoShapeComponent{
			Geometry: &pb.Geometry{
				Planar: &pb.PlanarGeometry{
					Plane: &pb.PlanarGeometry_Circle{
						Circle: &pb.PlanarCircle{
							Center: &pb.PlanarPoint{
								Longitude: detEntity.Geo.Longitude,
								Latitude:  detEntity.Geo.Latitude,
								Altitude:  detEntity.Geo.Altitude,
							},
							RadiusM: radiusM,
						},
					},
				},
			},
		},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(now),
			Until: timestamppb.New(now.Add(5 * time.Minute)),
		},
	}
}

// --- Main loop ---

func runBlueTeam(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg := blueTeamConfig{UpdateIntervalMs: 3000}
	if entity.Config != nil && entity.Config.Value != nil {
		b, _ := entity.Config.Value.MarshalJSON()
		_ = json.Unmarshal(b, &cfg)
	}
	if cfg.UpdateIntervalMs < 1000 {
		cfg.UpdateIntervalMs = 3000
	}

	ready()

	blueTeamEntityID := entity.Id
	hikers := initHikers(blueTeamEntityID)
	campID := blueTeamEntityID + ".camp"

	alphaMemberIDs := teamMemberIDs(hikers, "Alpha")
	bravoMemberIDs := teamMemberIDs(hikers, "Bravo")

	logger.Info("Starting blue team simulation",
		"entityID", blueTeamEntityID,
		"hikers", len(hikers),
		"update_ms", cfg.UpdateIntervalMs,
	)

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	ticker := time.NewTicker(time.Duration(cfg.UpdateIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	tick := 0
	for {
		select {
		case <-ctx.Done():
			expireBlueTeam(context.Background(), worldClient, hikers, blueTeamEntityID)
			return ctx.Err()
		case <-ticker.C:
			ttl := timestamppb.New(time.Now().Add(
				time.Duration(cfg.UpdateIntervalMs)*time.Millisecond*3 + 30*time.Second))

			for _, h := range hikers {
				h.step()
			}

			// camp + 4 entities per hiker (person, wind, vitals, radio)
			entities := make([]*pb.Entity, 0, 1+len(hikers)*4)
			entities = append(entities, buildCampEntity(blueTeamEntityID, ttl))

			for _, h := range hikers {
				var memberIDs []string
				if h.leader && h.team == "Alpha" {
					memberIDs = alphaMemberIDs
				} else if h.leader {
					memberIDs = bravoMemberIDs
				}
				entities = append(entities,
					buildHikerEntity(h, blueTeamEntityID, memberIDs, ttl),
					buildWindSensor(h, ttl),
					buildVitalSensor(h, ttl),
					buildRadioEntity(h, campID, ttl),
				)
			}

			// Fire chat messages according to the script.
			cycleTick := tick % chatCycleTicks
			for i, line := range chatScript {
				if cycleTick == line.atTick {
					entities = append(entities,
						buildChatEntity(blueTeamEntityID, hikers[line.hikerIdx], line.message, tick, i))
				}
			}

			// Fire detection events (wildlife sightings).
			detCycleTick := tick % detectionCycleTicks
			for _, det := range detectionScript {
				if detCycleTick == det.atTick {
					spotter := hikers[det.hikerIdx]
					detEnt := buildDetectionEntity(blueTeamEntityID, spotter, det, tick)
					entities = append(entities, detEnt)

					if det.dangerZoneM > 0 {
						entities = append(entities, buildDangerZoneEntity(blueTeamEntityID, detEnt, det.dangerZoneM, tick))
						// The team also announces the sighting over radio.
						entities = append(entities, buildChatEntity(blueTeamEntityID, spotter,
							fmt.Sprintf("CONTACT — %s spotted! Stay clear, marking danger zone", det.label), tick, 99))
					}
				}
			}

			_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{Changes: entities})
			tick++
		}
	}
}

func expireBlueTeam(ctx context.Context, client pb.WorldServiceClient, hikers []*hiker, parentID string) {
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: parentID + ".camp"})
	}()
	for _, h := range hikers {
		for _, suffix := range []string{"", ".wind", ".vitals", ".radio"} {
			id := h.id + suffix
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id})
			}()
		}
	}
	wg.Wait()
}

// --- Schema ---

func blueTeamSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"update_interval_ms": map[string]any{
				"type":        "number",
				"title":       "Update Interval",
				"description": "How often hiker positions and sensor readings are updated",
				"default":     3000,
				"minimum":     1000,
				"maximum":     60000,
				"ui:unit":     "ms",
			},
		},
	})
	return s
}
