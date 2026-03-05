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
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const radarSIDC = "SFGPESR---*****"

const maxHistoryPoints = 60

// --- Configuration ---

type BlankingSector struct {
	Angle   float64
	Span    float64
	Enabled bool
}

type RadarConfig struct {
	Latitude         float64 `json:"latitude"`
	Longitude        float64 `json:"longitude"`
	Altitude         float64 `json:"altitude"`
	GroundLevel      float64 `json:"ground_level"`
	Orientation      float64 `json:"orientation"`
	RangeKM          float64 `json:"range_km"`
	AltitudeMargin   float64 `json:"altitude_margin"`
	MaxDroneSpeedKmh float64 `json:"max_drone_speed_kmh"`
	TrackHistory     bool    `json:"track_history"`
	OnlyAlarms       bool    `json:"only_alarms"`
	ShowDrone        bool    `json:"show_drone"`
	ShowSuspected    bool    `json:"show_suspected"`
	ShowFixedWing    bool    `json:"show_fixed_wing"`
	ShowBird         bool    `json:"show_bird"`
	ShowVehicle      bool    `json:"show_vehicle"`
	TrackCount       int     `json:"track_count"`
	UpdateIntervalMs int     `json:"update_interval_ms"`
	Blanking1Angle   float64 `json:"blanking_1_angle"`
	Blanking1Span    float64 `json:"blanking_1_span"`
	Blanking1Enabled bool    `json:"blanking_1_enabled"`
	Blanking2Angle   float64 `json:"blanking_2_angle"`
	Blanking2Span    float64 `json:"blanking_2_span"`
	Blanking2Enabled bool    `json:"blanking_2_enabled"`
}

// --- Track types ---

type trackClass struct {
	name    string
	sidc    string // MIL-STD-2525C
	minAlt  float64
	maxAlt  float64
	minSpd  float64
	maxSpd  float64
	minRCS  float64
	maxRCS  float64
	isAlarm bool
}

var trackClasses = []trackClass{
	{"drone", "SHAPUF----*****", 10, 200, 2, 27, -25, -10, true},
	{"drone", "SHAPUF----*****", 10, 200, 2, 27, -25, -10, true},
	{"suspected_drone", "SUSPUF----*****", 10, 300, 2, 30, -28, -8, true},
	{"fixed_wing", "SNAPMF----*****", 100, 2000, 30, 130, -5, 15, false},
	{"bird", "SUPAP-----*****", 0, 150, 1, 35, -35, -15, false},
	{"vehicle", "SNGPU-----*****", 0, 5, 1, 30, -10, 5, false},
}

type simTrack struct {
	id       string
	class    trackClass
	azimuth  float64 // degrees from north
	rangeM   float64
	altM     float64
	speedMps float64
	heading  float64
	score    float64
	rcs      float64 // dBm²
	history  []*pb.PlanarPoint
}

func runRadar(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg := RadarConfig{
		Latitude:         51.9555,
		Longitude:        4.1694,
		Altitude:         16.0,
		GroundLevel:      5.0,
		Orientation:      0,
		RangeKM:          5.0,
		AltitudeMargin:   5.0,
		MaxDroneSpeedKmh: 30.0,
		TrackHistory:     true,
		ShowDrone:        true,
		ShowSuspected:    true,
		ShowFixedWing:    true,
		ShowBird:         true,
		ShowVehicle:      true,
		TrackCount:       8,
		UpdateIntervalMs: 1000,
	}
	if entity.Config != nil && entity.Config.Value != nil {
		b, _ := entity.Config.Value.MarshalJSON()
		_ = json.Unmarshal(b, &cfg)
	}
	if cfg.RangeKM <= 0 {
		cfg.RangeKM = 5.0
	}
	if cfg.TrackCount <= 0 {
		cfg.TrackCount = 8
	}
	if cfg.UpdateIntervalMs < 200 {
		cfg.UpdateIntervalMs = 1000
	}

	blankingSectors := []BlankingSector{
		{Angle: cfg.Blanking1Angle, Span: cfg.Blanking1Span, Enabled: cfg.Blanking1Enabled},
		{Angle: cfg.Blanking2Angle, Span: cfg.Blanking2Span, Enabled: cfg.Blanking2Enabled},
	}

	ready()

	logger.Info("Starting simulated radar",
		"entityID", entity.Id,
		"lat", cfg.Latitude, "lon", cfg.Longitude,
		"range_km", cfg.RangeKM,
		"tracks", cfg.TrackCount,
	)

	radarEntityID := entity.Id
	coverageEntities, coverageIDs := buildRadarCoverage(radarEntityID, cfg, blankingSectors)

	pushEntities := []*pb.Entity{{
		Id: radarEntityID,
		Geo: &pb.GeoSpatialComponent{
			Longitude: cfg.Longitude,
			Latitude:  cfg.Latitude,
			Altitude:  proto.Float64(cfg.Altitude),
		},
		Symbol: &pb.SymbolComponent{MilStd2525C: radarSIDC},
		Sensor: &pb.SensorComponent{
			Coverage: coverageIDs,
		},
	}}
	pushEntities = append(pushEntities, coverageEntities...)

	if err := controller.Push(ctx, pushEntities...); err != nil {
		return err
	}

	tracks := make([]*simTrack, cfg.TrackCount)
	for i := range tracks {
		tracks[i] = randomTrack(radarEntityID, i, cfg)
	}

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return err
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	ticker := time.NewTicker(time.Duration(cfg.UpdateIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			expireTracks(context.Background(), worldClient, tracks)
			return ctx.Err()
		case <-ticker.C:
			stepAndPush(ctx, worldClient, tracks, cfg, blankingSectors, radarEntityID)
		}
	}
}

// --- Simulation logic ---

func randomTrack(radarEntityID string, idx int, cfg RadarConfig) *simTrack {
	tc := trackClasses[rand.IntN(len(trackClasses))]
	maxRange := cfg.RangeKM * 1000

	return &simTrack{
		id:       fmt.Sprintf("%s.track.%d", radarEntityID, idx),
		class:    tc,
		azimuth:  rand.Float64() * 360,
		rangeM:   200 + rand.Float64()*(maxRange-200),
		altM:     cfg.GroundLevel + tc.minAlt + rand.Float64()*(tc.maxAlt-tc.minAlt),
		speedMps: tc.minSpd + rand.Float64()*(tc.maxSpd-tc.minSpd),
		heading:  rand.Float64() * 360,
		score:    0.3 + rand.Float64()*0.7,
		rcs:      tc.minRCS + rand.Float64()*(tc.maxRCS-tc.minRCS),
	}
}

func stepAndPush(ctx context.Context, client pb.WorldServiceClient, tracks []*simTrack, cfg RadarConfig, blankingSectors []BlankingSector, radarEntityID string) {
	maxRange := cfg.RangeKM * 1000
	dt := float64(cfg.UpdateIntervalMs) / 1000.0

	entities := make([]*pb.Entity, 0, len(tracks))

	for i, t := range tracks {
		// Wander heading
		t.heading = normalizeAngle(t.heading + (rand.Float64()-0.5)*10)

		headRad := t.heading * math.Pi / 180
		azRad := t.azimuth * math.Pi / 180

		// Current cartesian position relative to radar
		cx := t.rangeM * math.Sin(azRad)
		cy := t.rangeM * math.Cos(azRad)

		// Step
		cx += t.speedMps * dt * math.Sin(headRad)
		cy += t.speedMps * dt * math.Cos(headRad)

		t.rangeM = math.Sqrt(cx*cx + cy*cy)
		t.azimuth = normalizeAngle(math.Atan2(cx, cy) * 180 / math.Pi)

		// Altitude drift
		t.altM += (rand.Float64() - 0.5) * 2 * dt
		if t.altM < cfg.GroundLevel+t.class.minAlt {
			t.altM = cfg.GroundLevel + t.class.minAlt + 1
		}

		// Respawn if out of range
		if t.rangeM > maxRange || t.rangeM < 50 {
			old := t.id
			tracks[i] = randomTrack(radarEntityID, i, cfg)
			tracks[i].id = old
			tracks[i].history = nil
			t = tracks[i]
		}

		// Blanking sector check — track exists but radar can't see it
		if inBlankingSector(t.azimuth, blankingSectors) {
			continue
		}

		// Classify based on altitude margin and speed thresholds
		classification, isAlarm := classify(t, cfg)

		// Only-alarms filter: suppress non-alarm tracks from output
		if cfg.OnlyAlarms && !isAlarm {
			continue
		}

		// Classification filter
		if !classificationVisible(classification, cfg) {
			continue
		}

		// Apply orientation offset for output bearing
		outputAz := normalizeAngle(t.azimuth + cfg.Orientation)
		lat, lon := offsetLatLon(cfg.Latitude, cfg.Longitude, outputAz, t.rangeM)
		eastV := t.speedMps * math.Sin(headRad)
		northV := t.speedMps * math.Cos(headRad)

		ttl := timestamppb.New(time.Now().Add(time.Duration(cfg.UpdateIntervalMs)*time.Millisecond*3 + 10*time.Second))

		trackComp := &pb.TrackComponent{
			Tracker: proto.String(radarEntityID),
		}

		if cfg.TrackHistory {
			t.history = append(t.history, &pb.PlanarPoint{
				Longitude: lon,
				Latitude:  lat,
				Altitude:  proto.Float64(t.altM),
			})
			if len(t.history) > maxHistoryPoints {
				t.history = t.history[len(t.history)-maxHistoryPoints:]
			}

			historyID := t.id + ".history"
			trackComp.History = proto.String(historyID)

			entities = append(entities, &pb.Entity{
				Id: historyID,
				Shape: &pb.GeoShapeComponent{
					Geometry: &pb.Geometry{
						Planar: &pb.PlanarGeometry{
							Plane: &pb.PlanarGeometry_Line{
								Line: &pb.PlanarRing{Points: t.history},
							},
						},
					},
				},
				Lifetime: &pb.Lifetime{Until: ttl},
			})
		}

		entities = append(entities, &pb.Entity{
			Id:    t.id,
			Label: proto.String(classification),
			Geo: &pb.GeoSpatialComponent{
				Longitude: lon,
				Latitude:  lat,
				Altitude:  proto.Float64(t.altM),
			},
			Kinematics: &pb.KinematicsComponent{
				VelocityEnu: &pb.KinematicsEnu{
					East:  proto.Float64(eastV),
					North: proto.Float64(northV),
					Up:    proto.Float64(0),
				},
			},
			Detection: &pb.DetectionComponent{
				Classification: proto.String(classification),
				LastMeasured:   timestamppb.Now(),
			},
			Track:    trackComp,
			Symbol:   &pb.SymbolComponent{MilStd2525C: t.class.sidc},
			Lifetime: &pb.Lifetime{Until: ttl},
		})
	}

	if len(entities) > 0 {
		_, _ = client.Push(ctx, &pb.EntityChangeRequest{
			Changes: entities,
		})
	}
}

// --- Classification logic ---

func classify(t *simTrack, cfg RadarConfig) (string, bool) {
	aboveGround := t.altM > cfg.GroundLevel+cfg.AltitudeMargin
	speedKmh := t.speedMps * 3.6
	maxDroneSpeed := cfg.MaxDroneSpeedKmh
	if maxDroneSpeed <= 0 {
		maxDroneSpeed = 30.0
	}

	if !aboveGround {
		return "vehicle", false
	}
	if speedKmh > maxDroneSpeed {
		if t.class.name == "drone" || t.class.name == "suspected_drone" {
			return "suspected_fixed_wing", false
		}
		return t.class.name, t.class.isAlarm
	}
	return t.class.name, t.class.isAlarm
}

func classificationVisible(classification string, cfg RadarConfig) bool {
	switch classification {
	case "drone":
		return cfg.ShowDrone
	case "suspected_drone":
		return cfg.ShowSuspected
	case "fixed_wing", "suspected_fixed_wing":
		return cfg.ShowFixedWing
	case "bird":
		return cfg.ShowBird
	case "vehicle":
		return cfg.ShowVehicle
	}
	return true
}

// --- Blanking sector geometry ---

func inBlankingSector(azimuth float64, sectors []BlankingSector) bool {
	for _, s := range sectors {
		if !s.Enabled || s.Span <= 0 {
			continue
		}
		half := s.Span / 2
		start := normalizeAngle(s.Angle - half)
		end := normalizeAngle(s.Angle + half)

		if start < end {
			if azimuth >= start && azimuth <= end {
				return true
			}
		} else {
			// wraps around 0/360
			if azimuth >= start || azimuth <= end {
				return true
			}
		}
	}
	return false
}

func normalizeAngle(a float64) float64 {
	a = math.Mod(a, 360)
	if a < 0 {
		a += 360
	}
	return a
}

func offsetLatLon(lat, lon, bearingDeg, distM float64) (float64, float64) {
	const R = 6371000.0
	latR := lat * math.Pi / 180
	lonR := lon * math.Pi / 180
	brng := bearingDeg * math.Pi / 180
	d := distM / R

	newLat := math.Asin(math.Sin(latR)*math.Cos(d) + math.Cos(latR)*math.Sin(d)*math.Cos(brng))
	newLon := lonR + math.Atan2(math.Sin(brng)*math.Sin(d)*math.Cos(latR), math.Cos(d)-math.Sin(latR)*math.Sin(newLat))

	return newLat * 180 / math.Pi, newLon * 180 / math.Pi
}

func expireTracks(ctx context.Context, client pb.WorldServiceClient, tracks []*simTrack) {
	var wg sync.WaitGroup
	for _, t := range tracks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: t.id})
			_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: t.id + ".history"})
		}()
	}
	wg.Wait()
}

// --- Coverage shape ---

const arcSegments = 32

// buildRadarCoverage creates LocalShapeComponent entities representing the
// radar's detection area. Without blanking sectors it's a full circle.
// With blanking sectors enabled the circle is split into wedge-shaped arcs
// that skip the blanked azimuth ranges.
func buildRadarCoverage(radarEntityID string, cfg RadarConfig, sectors []BlankingSector) ([]*pb.Entity, []string) {
	rangeM := cfg.RangeKM * 1000

	// Collect enabled blanking intervals as [startDeg, endDeg) pairs.
	var blanks []arc
	for _, s := range sectors {
		if !s.Enabled || s.Span <= 0 {
			continue
		}
		half := s.Span / 2
		blanks = append(blanks, arc{
			start: normalizeAngle(s.Angle - half),
			end:   normalizeAngle(s.Angle + half),
		})
	}

	// No blanking: simple circle.
	if len(blanks) == 0 {
		id := radarEntityID + ".coverage.0"
		return []*pb.Entity{{
			Id: id,
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: radarEntityID,
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Circle{
						Circle: &pb.LocalCircle{
							Center:  &pb.LocalPoint{},
							RadiusM: rangeM,
						},
					},
				},
			},
		}}, []string{id}
	}

	// With blanking: split into visible arc wedges.
	arcs := visibleArcs(blanks)

	var entities []*pb.Entity
	var ids []string

	for i, arc := range arcs {
		id := fmt.Sprintf("%s.coverage.%d", radarEntityID, i)
		ids = append(ids, id)
		entities = append(entities, &pb.Entity{
			Id: id,
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: radarEntityID,
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Polygon{
						Polygon: buildArcWedge(arc.start, arc.end, rangeM),
					},
				},
			},
		})
	}

	return entities, ids
}

type arc struct{ start, end float64 } // degrees, clockwise from north

// visibleArcs returns the visible (non-blanked) arc segments of a full circle.
// blanks are the blanking intervals. If none, returns a single full-circle arc.
func visibleArcs(blanks []arc) []arc {
	if len(blanks) == 0 {
		return []arc{{0, 360}}
	}

	// Mark blanked degrees on a 0-360 number line.
	// Expand wrap-around intervals into two.
	type edge struct {
		angle float64
		open  bool // true = start of blank, false = end of blank
	}
	var edges []edge
	for _, b := range blanks {
		if b.start < b.end {
			edges = append(edges, edge{b.start, true}, edge{b.end, false})
		} else {
			// wraps around 0
			edges = append(edges, edge{0, true}, edge{b.end, false})
			edges = append(edges, edge{b.start, true}, edge{360, false})
		}
	}

	// Sort edges by angle
	for i := 1; i < len(edges); i++ {
		for j := i; j > 0 && edges[j].angle < edges[j-1].angle; j-- {
			edges[j], edges[j-1] = edges[j-1], edges[j]
		}
	}

	// Sweep and collect visible gaps
	var result []arc
	depth := 0
	cursor := 0.0

	for _, e := range edges {
		if e.open {
			if depth == 0 && e.angle > cursor {
				result = append(result, arc{cursor, e.angle})
			}
			depth++
		} else {
			depth--
			if depth == 0 {
				cursor = e.angle
			}
		}
	}
	// Trailing visible segment
	if depth == 0 && cursor < 360 {
		result = append(result, arc{cursor, 360})
	}

	// Merge first and last if they meet at 0/360
	if len(result) > 1 && result[0].start == 0 && result[len(result)-1].end == 360 {
		result[len(result)-1].end = result[0].end + 360
		result = result[1:]
	}

	return result
}

// buildArcWedge creates a polygon wedge from the origin spanning startDeg to
// endDeg (clockwise from north) at the given radius.
func buildArcWedge(startDeg, endDeg, radiusM float64) *pb.LocalPolygon {
	span := endDeg - startDeg
	if span <= 0 {
		span += 360
	}

	// Number of segments proportional to span
	nSeg := int(math.Ceil(float64(arcSegments) * span / 360))
	if nSeg < 2 {
		nSeg = 2
	}

	points := make([]*pb.LocalPoint, 0, nSeg+3)
	points = append(points, &pb.LocalPoint{EastM: 0, NorthM: 0})

	for i := 0; i <= nSeg; i++ {
		deg := startDeg + span*float64(i)/float64(nSeg)
		rad := deg * math.Pi / 180
		points = append(points, &pb.LocalPoint{
			EastM:  radiusM * math.Sin(rad),
			NorthM: radiusM * math.Cos(rad),
		})
	}

	points = append(points, &pb.LocalPoint{EastM: 0, NorthM: 0})

	return &pb.LocalPolygon{
		Outer: &pb.LocalRing{Points: points},
	}
}

// --- Radar config schema ---

func radarSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"ui:groups": []any{
			map[string]any{"key": "position", "title": "Position"},
			map[string]any{"key": "radar", "title": "Radar"},
			map[string]any{"key": "classification", "title": "Classification"},
			map[string]any{"key": "filter", "title": "Track Filters"},
			map[string]any{"key": "simulation", "title": "Simulation"},
			map[string]any{"key": "blanking", "title": "Blanking Sectors", "collapsed": true},
		},
		"properties": map[string]any{
			"latitude": map[string]any{
				"type": "number", "title": "Latitude",
				"default": 51.9555, "ui:group": "position", "ui:order": 0,
			},
			"longitude": map[string]any{
				"type": "number", "title": "Longitude",
				"default": 4.1694, "ui:group": "position", "ui:order": 1,
			},
			"altitude": map[string]any{
				"type": "number", "title": "Altitude",
				"description": "Height above WGS84 ellipsoid",
				"default":     16.0, "ui:unit": "m", "ui:group": "position", "ui:order": 2,
			},
			"ground_level": map[string]any{
				"type": "number", "title": "Ground Level",
				"description": "Terrain elevation. Tracks below this are classified differently.",
				"default":     5.0, "ui:unit": "m", "ui:group": "position", "ui:order": 3,
			},
			"range_km": map[string]any{
				"type": "number", "title": "Range",
				"description": "Maximum detection range",
				"default":     5.0, "minimum": 0.5, "maximum": 100.0,
				"ui:unit": "km", "ui:group": "radar", "ui:order": 0,
			},
			"orientation": map[string]any{
				"type": "number", "title": "Orientation",
				"description": "North offset. Rotates all track bearings by this angle.",
				"default":     0, "minimum": 0, "maximum": 360,
				"ui:unit": "°", "ui:group": "radar", "ui:order": 1,
			},
			"altitude_margin": map[string]any{
				"type": "number", "title": "Altitude Margin",
				"description": "Height above ground level below which targets are classified as ground vehicles.",
				"default":     5.0, "minimum": 0, "maximum": 50,
				"ui:unit": "m", "ui:group": "classification", "ui:order": 0,
			},
			"max_drone_speed_kmh": map[string]any{
				"type": "number", "title": "Max Drone Speed",
				"description": "Speed threshold. Aerial targets faster than this are classified as fixed-wing.",
				"default":     30.0, "minimum": 1, "maximum": 200,
				"ui:unit": "km/h", "ui:group": "classification", "ui:order": 1,
			},
			"track_history": map[string]any{
				"type": "boolean", "title": "Track History",
				"description": "Show track trail lines.",
				"default":     true,
				"ui:group":    "radar", "ui:order": 2,
			},
			"only_alarms": map[string]any{
				"type": "boolean", "title": "Only Alarms",
				"description": "When enabled, only output tracks that trigger an alarm (drones).",
				"default":     false,
				"ui:group":    "filter", "ui:order": 0,
			},
			"show_drone": map[string]any{
				"type": "boolean", "title": "Show Drones",
				"default": true, "ui:group": "filter", "ui:order": 1,
			},
			"show_suspected": map[string]any{
				"type": "boolean", "title": "Show Suspected Drones",
				"default": true, "ui:group": "filter", "ui:order": 2,
			},
			"show_fixed_wing": map[string]any{
				"type": "boolean", "title": "Show Fixed Wing",
				"default": true, "ui:group": "filter", "ui:order": 3,
			},
			"show_bird": map[string]any{
				"type": "boolean", "title": "Show Birds",
				"default": true, "ui:group": "filter", "ui:order": 4,
			},
			"show_vehicle": map[string]any{
				"type": "boolean", "title": "Show Vehicles",
				"default": true, "ui:group": "filter", "ui:order": 5,
			},
			"track_count": map[string]any{
				"type": "number", "title": "Track Count",
				"description": "Number of simultaneous simulated targets",
				"default":     8, "minimum": 1, "maximum": 50,
				"ui:group": "simulation", "ui:order": 0,
			},
			"update_interval_ms": map[string]any{
				"type": "number", "title": "Update Interval",
				"default": 1000, "minimum": 200, "maximum": 10000,
				"ui:unit": "ms", "ui:group": "simulation", "ui:order": 1,
			},
			"blanking_1_enabled": map[string]any{
				"type": "boolean", "title": "Sector 1 Enabled", "default": false,
				"ui:group": "blanking", "ui:order": 0,
			},
			"blanking_1_angle": map[string]any{
				"type": "number", "title": "Sector 1 Angle",
				"minimum": 0, "maximum": 360, "ui:unit": "°",
				"ui:group": "blanking", "ui:order": 1,
			},
			"blanking_1_span": map[string]any{
				"type": "number", "title": "Sector 1 Span",
				"minimum": 0, "maximum": 360, "ui:unit": "°",
				"ui:group": "blanking", "ui:order": 2,
			},
			"blanking_2_enabled": map[string]any{
				"type": "boolean", "title": "Sector 2 Enabled", "default": false,
				"ui:group": "blanking", "ui:order": 3,
			},
			"blanking_2_angle": map[string]any{
				"type": "number", "title": "Sector 2 Angle",
				"minimum": 0, "maximum": 360, "ui:unit": "°",
				"ui:group": "blanking", "ui:order": 4,
			},
			"blanking_2_span": map[string]any{
				"type": "number", "title": "Sector 2 Span",
				"minimum": 0, "maximum": 360, "ui:unit": "°",
				"ui:group": "blanking", "ui:order": 5,
			},
		},
		"required": []any{"latitude", "longitude"},
	})
	return s
}
