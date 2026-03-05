package spacetrack

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/akhenakh/sgp4"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type TrackerConfig struct {
	TLESource            string  `json:"tle"`
	EntityID             string  `json:"id"`
	Label                string  `json:"label"`
	Symbol               string  `json:"symbol"`
	IntervalSeconds      float64 `json:"interval"`
	OrbitIntervalSeconds float64 `json:"orbit_interval"`
	TLERefreshSeconds    int     `json:"tle_refresh_seconds"`
	Username             string  `json:"username"`
	Password             string  `json:"password"`
	DisableOrbitTrack    bool    `json:"disable_orbit_track"`
}

type SatellitePosition struct {
	Latitude  float64
	Longitude float64
	Altitude  float64
	VelEast   float64
	VelNorth  float64
	VelUp     float64
}

func isURL(source string) bool {
	return len(source) > 4 && (source[:4] == "http" || (len(source) > 3 && source[:3] == "ftp"))
}

func parseInlineTLE(data string) (*sgp4.TLE, error) {
	tle, err := sgp4.ParseTLE(data)
	if err != nil {
		return nil, fmt.Errorf("failed to parse inline TLE: %w", err)
	}
	return tle, nil
}

func fetchMultipleTLEs(ctx context.Context, url, username, password string) ([]*sgp4.TLE, error) {
	client := &http.Client{Timeout: 30 * time.Second}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if username != "" && password != "" {
		req.SetBasicAuth(username, password)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch TLEs: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("TLE fetch returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read TLE response: %w", err)
	}

	allLines := strings.Split(strings.TrimSpace(string(body)), "\n")
	for i := range allLines {
		allLines[i] = strings.TrimSpace(allLines[i])
	}

	var tles []*sgp4.TLE
	for i := 0; i+2 < len(allLines); {
		if allLines[i] == "" {
			i++
			continue
		}

		if i+2 < len(allLines) && len(allLines[i+1]) > 0 && allLines[i+1][0] == '1' && len(allLines[i+2]) > 0 && allLines[i+2][0] == '2' {
			tleData := allLines[i] + "\n" + allLines[i+1] + "\n" + allLines[i+2]
			tle, err := sgp4.ParseTLE(tleData)
			if err != nil {
				i++
				continue
			}
			tles = append(tles, tle)
			i += 3
		} else {
			i++
		}
	}

	if len(tles) == 0 {
		return nil, fmt.Errorf("no valid TLEs found in response")
	}

	return tles, nil
}

func calculatePosition(tle *sgp4.TLE, t time.Time) (*SatellitePosition, error) {
	eciState, err := tle.FindPositionAtTime(t)
	if err != nil {
		return nil, fmt.Errorf("failed to propagate satellite: %w", err)
	}

	lat, lon, alt := eciState.ToGeodetic()

	// Convert ECI velocity to ENU velocity
	gmst := eciState.GreenwichSiderealTime()
	cosGmst := math.Cos(gmst)
	sinGmst := math.Sin(gmst)

	// ECI position/velocity (km, km/s)
	px, py := eciState.Position.X, eciState.Position.Y
	vx, vy, vz := eciState.Velocity.X, eciState.Velocity.Y, eciState.Velocity.Z

	// ECI to ECEF position
	rxEcef := cosGmst*px + sinGmst*py
	ryEcef := -sinGmst*px + cosGmst*py

	// ECI to ECEF velocity (accounting for Earth rotation)
	const omegaEarth = 7.2921150e-5 // rad/s
	vxEcef := cosGmst*vx + sinGmst*vy + omegaEarth*ryEcef
	vyEcef := -sinGmst*vx + cosGmst*vy - omegaEarth*rxEcef
	vzEcef := vz

	// ECEF to ENU at geodetic (lat, lon)
	latRad := lat * math.Pi / 180.0
	lonRad := lon * math.Pi / 180.0
	sinLat := math.Sin(latRad)
	cosLat := math.Cos(latRad)
	sinLon := math.Sin(lonRad)
	cosLon := math.Cos(lonRad)

	east := -sinLon*vxEcef + cosLon*vyEcef
	north := -sinLat*cosLon*vxEcef - sinLat*sinLon*vyEcef + cosLat*vzEcef
	up := cosLat*cosLon*vxEcef + cosLat*sinLon*vyEcef + sinLat*vzEcef

	return &SatellitePosition{
		Latitude:  lat,
		Longitude: lon,
		Altitude:  alt * 1000,   // km to m
		VelEast:   east * 1000,  // km/s to m/s
		VelNorth:  north * 1000, // km/s to m/s
		VelUp:     up * 1000,    // km/s to m/s
	}, nil
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "spacetrack"

	orbitSchema, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"ui:groups": []any{
			map[string]any{"key": "source", "title": "TLE Source"},
			map[string]any{"key": "display", "title": "Display"},
			map[string]any{"key": "timing", "title": "Timing"},
			map[string]any{"key": "auth", "title": "Authentication", "collapsed": true},
		},
		"properties": map[string]any{
			"tle": map[string]any{
				"type":           "string",
				"title":          "TLE Data",
				"description":    "Inline TLE data or URL to TLE file",
				"ui:widget":      "textarea",
				"ui:placeholder": "Paste TLE or enter URL",
				"ui:group":       "source",
				"ui:order":       0,
			},
			"disable_orbit_track": map[string]any{
				"type":        "boolean",
				"title":       "Disable Orbit Track",
				"description": "Disable projected orbit ground track",
				"default":     false,
				"ui:group":    "source",
				"ui:order":    1,
			},
			"id": map[string]any{
				"type":           "string",
				"title":          "Entity ID",
				"description":    "Custom entity ID prefix",
				"ui:placeholder": "e.g. iss",
				"ui:group":       "display",
				"ui:order":       0,
			},
			"label": map[string]any{
				"type":           "string",
				"title":          "Label",
				"description":    "Display label for the satellite",
				"ui:placeholder": "e.g. ISS",
				"ui:group":       "display",
				"ui:order":       1,
			},
			"symbol": map[string]any{
				"type":           "string",
				"title":          "Symbol",
				"description":    "MIL-STD-2525C symbol code",
				"ui:placeholder": "e.g. SNPPS-----*****",
				"ui:group":       "display",
				"ui:order":       2,
			},
			"interval": map[string]any{
				"type":        "number",
				"title":       "Position Interval",
				"description": "Position update interval",
				"default":     1.0,
				"minimum":     0.1,
				"ui:unit":     "s",
				"ui:group":    "timing",
				"ui:order":    0,
			},
			"orbit_interval": map[string]any{
				"type":        "number",
				"title":       "Orbit Interval",
				"description": "Orbit track update interval",
				"default":     60.0,
				"minimum":     1.0,
				"ui:unit":     "s",
				"ui:group":    "timing",
				"ui:order":    1,
			},
			"tle_refresh_seconds": map[string]any{
				"type":        "number",
				"title":       "TLE Refresh",
				"description": "How often to re-fetch TLE from URL",
				"default":     3600.0,
				"minimum":     60.0,
				"ui:unit":     "s",
				"ui:group":    "timing",
				"ui:order":    2,
			},
			"username": map[string]any{
				"type":           "string",
				"title":          "Username",
				"description":    "HTTP basic auth username for TLE source",
				"ui:placeholder": "e.g. space-track.org username",
				"ui:group":       "auth",
				"ui:order":       0,
			},
			"password": map[string]any{
				"type":        "string",
				"title":       "Password",
				"description": "HTTP basic auth password for TLE source",
				"ui:widget":   "password",
				"ui:group":    "auth",
				"ui:order":    1,
			},
		},
		"required": []any{"tle"},
	})

	serviceEntityID := controllerName + ".service"

	if err := controller.Push(ctx,
		&pb.Entity{
			Id:    serviceEntityID,
			Label: proto.String("Space Track"),
			Controller: &pb.Controller{
				Id: &controllerName,
			},
			Device: &pb.DeviceComponent{
				Category: proto.String("Feeds"),
			},
			Configurable: &pb.ConfigurableComponent{
				SupportedDeviceClasses: []*pb.DeviceClassOption{
					{Class: "orbits", Label: "Orbit Tracker"},
				},
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String("satellite"),
			},
		},
	); err != nil {
		return fmt.Errorf("push service entity: %w", err)
	}

	classes := []controller.DeviceClass{
		{Class: "orbits", Label: "Orbit Tracker", Schema: orbitSchema},
	}

	return controller.WatchChildren(ctx, serviceEntityID, controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			ready()
			return runTracker(ctx, logger, entity)
		})
	})
}

func runTracker(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	config := entity.Config
	if config == nil {
		return fmt.Errorf("entity %s has no config", entity.Id)
	}

	trackerConfig, err := parseTrackerConfig(config)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	logger.Info("Starting tracker",
		"configEntityID", entity.Id,
		"interval", trackerConfig.IntervalSeconds,
		"tleRefresh", trackerConfig.TLERefreshSeconds,
		"tle", trackerConfig.TLESource)

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	worldClient := pb.NewWorldServiceClient(grpcConn)
	ticker := time.NewTicker(time.Duration(trackerConfig.IntervalSeconds * float64(time.Second)))
	defer ticker.Stop()

	isURLSource := isURL(trackerConfig.TLESource)
	var tles []*sgp4.TLE
	tleTicker := time.NewTicker(time.Duration(trackerConfig.TLERefreshSeconds) * time.Second)
	defer tleTicker.Stop()

	fetchCtx, fetchCancel := context.WithTimeout(ctx, 30*time.Second)
	if isURLSource {
		tles, err = fetchMultipleTLEs(fetchCtx, trackerConfig.TLESource, trackerConfig.Username, trackerConfig.Password)
	} else {
		var tle *sgp4.TLE
		tle, err = parseInlineTLE(trackerConfig.TLESource)
		if err == nil {
			tles = []*sgp4.TLE{tle}
		}
	}
	fetchCancel()

	if err != nil {
		return fmt.Errorf("load initial TLE: %w", err)
	}

	logger.Info("Loaded TLEs", "configEntityID", entity.Id, "count", len(tles))

	var positionUpdateCount uint64

	// Push initial position + orbit updates
	pushPositionUpdates(ctx, logger, worldClient, tles, entity.Id, trackerConfig)
	positionUpdateCount += uint64(len(tles))
	_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: entity.Id,
			Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
				{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("satellites tracked"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: uint64(len(tles))}},
				{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("position updates"), Id: proto.Uint32(2), Val: &pb.Metric_Uint64{Uint64: positionUpdateCount}},
			}},
		}},
	})
	if !trackerConfig.DisableOrbitTrack {
		pushOrbitEntities(ctx, logger, worldClient, tles, entity.Id, trackerConfig)
	}

	orbitTicker := time.NewTicker(time.Duration(trackerConfig.OrbitIntervalSeconds * float64(time.Second)))
	defer orbitTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Info("Tracker shutting down", "configEntityID", entity.Id)
			return ctx.Err()

		case <-ticker.C:
			pushPositionUpdates(ctx, logger, worldClient, tles, entity.Id, trackerConfig)
			positionUpdateCount += uint64(len(tles))
			_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{{
					Id: entity.Id,
					Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
						{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("satellites tracked"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: uint64(len(tles))}},
						{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("position updates"), Id: proto.Uint32(2), Val: &pb.Metric_Uint64{Uint64: positionUpdateCount}},
					}},
				}},
			})

		case <-orbitTicker.C:
			if trackerConfig.DisableOrbitTrack {
				continue
			}
			pushOrbitEntities(ctx, logger, worldClient, tles, entity.Id, trackerConfig)

		case <-tleTicker.C:
			if isURLSource {
				fetchCtx, fetchCancel := context.WithTimeout(ctx, 30*time.Second)
				newTLEs, err := fetchMultipleTLEs(fetchCtx, trackerConfig.TLESource, trackerConfig.Username, trackerConfig.Password)
				fetchCancel()
				if err != nil {
					logger.Error("Failed to refresh TLEs", "configEntityID", entity.Id, "error", err)
				} else {
					tles = newTLEs
					logger.Info("Refreshed TLEs", "configEntityID", entity.Id, "count", len(tles))
					pushOrbitEntities(ctx, logger, worldClient, tles, entity.Id, trackerConfig)
				}
			}
		}
	}
}

func pushPositionUpdates(ctx context.Context, logger *slog.Logger, worldClient pb.WorldServiceClient, tles []*sgp4.TLE, configEntityID string, config *TrackerConfig) {
	for _, tle := range tles {
		// Check for cancellation before processing each TLE
		select {
		case <-ctx.Done():
			return
		default:
		}

		position, err := calculatePosition(tle, time.Now())
		if err != nil {
			logger.Error("Failed to calculate position", "configEntityID", configEntityID, "satellite", tle.Name, "error", err)
			continue
		}

		entityID, label := generateIDAndLabel(configEntityID, config, tle, len(tles))
		expires := time.Duration(config.IntervalSeconds * float64(time.Second))
		entity := positionToEntity(position, tle, entityID, label, config.Symbol, expires, "spacetrack", configEntityID)

		if entity == nil {
			logger.Error("Failed to convert position to entity", "configEntityID", configEntityID, "satellite", tle.Name)
			continue
		}

		if config.DisableOrbitTrack {
			entity.Track.Prediction = nil
		}

		entities := []*pb.Entity{entity}

		pushCtx, pushCancel := context.WithTimeout(ctx, 2*time.Second)
		_, err = worldClient.Push(pushCtx, &pb.EntityChangeRequest{
			Changes: entities,
		})
		pushCancel()

		if err != nil {
			logger.Error("Failed to push entity", "configEntityID", configEntityID, "satellite", tle.Name, "error", err)
		}
	}
}

func generateIDAndLabel(configEntityID string, config *TrackerConfig, tle *sgp4.TLE, tleCount int) (string, string) {
	var entityID, label string

	if tleCount == 1 && config.EntityID != "" {
		entityID = fmt.Sprintf("spacetrack.%s", config.EntityID)
	} else {
		trackName := sanitizeIDComponent(tle.Name)
		if trackName == "" {
			trackName = "track"
		}
		baseID := config.EntityID
		if baseID == "" {
			baseID = configEntityID
		}
		entityID = fmt.Sprintf("spacetrack.%s.%s", baseID, trackName)
	}

	switch {
	case tleCount == 1 && config.Label != "":
		label = config.Label
	case tleCount > 1 && config.Label != "":
		if tle.Name != "" {
			label = fmt.Sprintf("%s - %s", config.Label, tle.Name)
		} else {
			label = fmt.Sprintf("%s - track", config.Label)
		}
	case tle.Name != "":
		label = tle.Name
	default:
		baseID := config.EntityID
		if baseID == "" {
			baseID = configEntityID
		}
		label = fmt.Sprintf("%s track", baseID)
	}

	return entityID, label
}

// sanitizeIDComponent converts a TLE name into a valid entity ID component
// by lowercasing, replacing spaces with hyphens, and dropping other
// non-alphanumeric characters.
func sanitizeIDComponent(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '.':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('-')
		}
	}
	return b.String()
}

func positionToEntity(position *SatellitePosition, tle *sgp4.TLE, entityID, label, symbol string, expires time.Duration, controllerName string, trackerID string) *pb.Entity {
	// SGP4 position uncertainty grows with TLE age.
	// Baseline ~1 km at epoch, growing ~1.5 km/day.
	tleAgeDays := time.Since(tle.EpochTime()).Hours() / 24.0
	if tleAgeDays < 0 {
		tleAgeDays = 0
	}
	posUncertaintyM := 1000.0 + 1500.0*tleAgeDays // meters
	posVar := posUncertaintyM * posUncertaintyM   // variance (m²)

	// SGP4 velocity uncertainty: ~1 m/s baseline, ~0.5 m/s per day
	velUncertaintyMs := 1.0 + 0.5*tleAgeDays
	velVar := velUncertaintyMs * velUncertaintyMs

	entity := &pb.Entity{
		Id:    entityID,
		Label: &label,
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(expires * 2)),
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  position.Latitude,
			Longitude: position.Longitude,
			Altitude:  &position.Altitude,
			Covariance: &pb.CovarianceMatrix{
				Mxx: &posVar,
				Myy: &posVar,
				Mzz: &posVar,
			},
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: symbol,
		},
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Track: &pb.TrackComponent{
			Tracker:    &trackerID,
			Prediction: proto.String(entityID + ".orbit"),
		},
		Kinematics: &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				East:  &position.VelEast,
				North: &position.VelNorth,
				Up:    &position.VelUp,
				Covariance: &pb.CovarianceMatrix{
					Mxx: &velVar,
					Myy: &velVar,
					Mzz: &velVar,
				},
			},
		},
	}

	return entity
}

func pushOrbitEntities(ctx context.Context, logger *slog.Logger, worldClient pb.WorldServiceClient, tles []*sgp4.TLE, configEntityID string, config *TrackerConfig) {
	for _, tle := range tles {
		select {
		case <-ctx.Done():
			return
		default:
		}

		entityID, _ := generateIDAndLabel(configEntityID, config, tle, len(tles))
		expires := time.Duration(config.OrbitIntervalSeconds * float64(time.Second))
		entity := orbitMissionEntity(tle, entityID, "spacetrack", expires)

		pushCtx, pushCancel := context.WithTimeout(ctx, 2*time.Second)
		_, err := worldClient.Push(pushCtx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		pushCancel()

		if err != nil {
			logger.Error("Failed to push orbit entity", "configEntityID", configEntityID, "satellite", tle.Name, "error", err)
		}
	}
}

// orbitMissionEntity projects the ground track forward one orbital period
// from the current time and returns it as a separate mission entity.
func orbitMissionEntity(tle *sgp4.TLE, satelliteEntityID string, controllerName string, expires time.Duration) *pb.Entity {
	missionID := satelliteEntityID + ".orbit"
	periodMin := 1440.0 / tle.MeanMotion
	steps := int(math.Ceil(periodMin))
	now := time.Now()

	points := make([]*pb.PlanarPoint, 0, steps+1)
	var prevLon float64
	for i := 0; i <= steps; i++ {
		t := now.Add(time.Duration(i) * time.Minute)
		pos, err := calculatePosition(tle, t)
		if err != nil {
			continue
		}
		lon := pos.Longitude
		if len(points) > 0 {
			for lon-prevLon > 180 {
				lon -= 360
			}
			for lon-prevLon < -180 {
				lon += 360
			}
		}
		prevLon = lon
		points = append(points, &pb.PlanarPoint{
			Longitude: lon,
			Latitude:  pos.Latitude,
			Altitude:  &pos.Altitude,
		})
	}

	entity := &pb.Entity{
		Id: missionID,
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(expires * 2)),
		},
		Controller: &pb.Controller{
			Id: &controllerName,
		},
	}

	if len(points) > 0 {
		entity.Shape = &pb.GeoShapeComponent{
			Geometry: &pb.Geometry{
				Planar: &pb.PlanarGeometry{
					Plane: &pb.PlanarGeometry_Line{
						Line: &pb.PlanarRing{Points: points},
					},
				},
			},
		}
	}

	return entity
}

func parseTrackerConfig(config *pb.ConfigurationComponent) (*TrackerConfig, error) {
	trackerConfig := &TrackerConfig{
		TLESource:            "",
		EntityID:             "",
		Label:                "",
		Symbol:               "SNPPS-----*****",
		IntervalSeconds:      1.0,
		OrbitIntervalSeconds: 60,
		TLERefreshSeconds:    3600,
	}

	if config.Value == nil || config.Value.Fields == nil {
		return nil, fmt.Errorf("tle field is required")
	}

	fields := config.Value.Fields
	if v, ok := fields["tle"]; ok {
		trackerConfig.TLESource = v.GetStringValue()
	}
	if trackerConfig.TLESource == "" {
		return nil, fmt.Errorf("tle field is required")
	}

	if v, ok := fields["id"]; ok {
		trackerConfig.EntityID = v.GetStringValue()
	}
	if v, ok := fields["label"]; ok {
		trackerConfig.Label = v.GetStringValue()
	}
	if v, ok := fields["symbol"]; ok {
		if symbol := v.GetStringValue(); symbol != "" {
			trackerConfig.Symbol = symbol
		}
	}
	if v, ok := fields["interval"]; ok {
		if interval := v.GetNumberValue(); interval > 0 {
			trackerConfig.IntervalSeconds = interval
		}
	}
	if v, ok := fields["orbit_interval"]; ok {
		if interval := v.GetNumberValue(); interval > 0 {
			trackerConfig.OrbitIntervalSeconds = interval
		}
	}
	if v, ok := fields["tle_refresh_seconds"]; ok {
		if refresh := int(v.GetNumberValue()); refresh > 0 {
			trackerConfig.TLERefreshSeconds = refresh
		}
	}
	if v, ok := fields["disable_orbit_track"]; ok {
		trackerConfig.DisableOrbitTrack = v.GetBoolValue()
	}
	if v, ok := fields["username"]; ok {
		trackerConfig.Username = v.GetStringValue()
	}
	if v, ok := fields["password"]; ok {
		trackerConfig.Password = v.GetStringValue()
	}

	return trackerConfig, nil
}

func init() {
	builtin.Register("spacetrack", Run)
}
