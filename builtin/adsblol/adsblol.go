package adsblol

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ADSBAircraft struct {
	Hex          string       `json:"hex"`
	Callsign     string       `json:"flight"`
	Registration string       `json:"r"`
	Type         string       `json:"t"`
	Lat          *float64     `json:"lat"`
	Lon          *float64     `json:"lon"`
	AltBaro      *FlexibleInt `json:"alt_baro"`
	AltGeom      *FlexibleInt `json:"alt_geom"`
	Track        *float64     `json:"track"`
	GroundSpeed  *float64     `json:"gs"`
	Category     string       `json:"category"`
	Emergency    string       `json:"emergency"`
	Squawk       string       `json:"squawk"`
	NACp         *int         `json:"nac_p"`
	NACv         *int         `json:"nac_v"`
	Seen         *float64     `json:"seen"`
	SeenPos      *float64     `json:"seen_pos"`
}

type FlexibleInt struct {
	Value int
	Valid bool
}

func (f *FlexibleInt) UnmarshalJSON(data []byte) error {
	var i int
	if err := json.Unmarshal(data, &i); err == nil {
		f.Value = i
		f.Valid = true
		return nil
	}

	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		f.Valid = false
		return nil
	}

	return fmt.Errorf("altitude must be int or string")
}

type ADSBResponse struct {
	AC      []ADSBAircraft `json:"ac"`
	Now     float64        `json:"now"`
	Total   int            `json:"total"`
	Message string         `json:"msg"`
}

type ADSBClient struct {
	httpClient *http.Client
}

func NewADSBClient() *ADSBClient {
	return &ADSBClient{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *ADSBClient) FetchByLocation(ctx context.Context, lat, lon float64, radiusNM int) ([]ADSBAircraft, error) {
	url := fmt.Sprintf("https://api.adsb.lol/v2/lat/%.6f/lon/%.6f/dist/%d", lat, lon, radiusNM)
	return c.fetchAircraft(ctx, url)
}

func (c *ADSBClient) FetchByCallsign(ctx context.Context, callsign string) ([]ADSBAircraft, error) {
	url := fmt.Sprintf("https://api.adsb.lol/v2/callsign/%s", callsign)
	return c.fetchAircraft(ctx, url)
}

func (c *ADSBClient) FetchByICAO(ctx context.Context, icao string) ([]ADSBAircraft, error) {
	url := fmt.Sprintf("https://api.adsb.lol/v2/icao/%s", icao)
	return c.fetchAircraft(ctx, url)
}

func (c *ADSBClient) FetchMilitary(ctx context.Context) ([]ADSBAircraft, error) {
	url := "https://api.adsb.lol/v2/mil"
	return c.fetchAircraft(ctx, url)
}

func (c *ADSBClient) fetchAircraft(ctx context.Context, url string) ([]ADSBAircraft, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch data: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var adsbResp ADSBResponse
	if err := json.Unmarshal(body, &adsbResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return adsbResp.AC, nil
}

// nacpToEPU maps NACp (Navigation Accuracy Category - Position) to
// Estimated Position Uncertainty radius in meters (DO-260B Table 2-73).
var nacpToEPU = [12]float64{
	18520, // 0: EPU >= 18.52 km
	18520, // 1: EPU < 18.52 km (10 NM)
	7408,  // 2: EPU < 7.408 km (4 NM)
	3704,  // 3: EPU < 3.704 km (2 NM)
	1852,  // 4: EPU < 1.852 km (1 NM)
	926,   // 5: EPU < 926 m (0.5 NM)
	555.6, // 6: EPU < 555.6 m (0.3 NM)
	185.2, // 7: EPU < 185.2 m (0.1 NM)
	92.6,  // 8: EPU < 92.6 m (0.05 NM)
	30,    // 9: EPU < 30 m
	10,    // 10: EPU < 10 m
	3,     // 11: EPU < 3 m
}

// nacvToVelocityUncertainty maps NACv to velocity uncertainty in m/s (DO-260B).
var nacvToVelocityUncertainty = [5]float64{
	10,  // 0: unknown, use 10 m/s
	10,  // 1: < 10 m/s
	3,   // 2: < 3 m/s
	1,   // 3: < 1 m/s
	0.3, // 4: < 0.3 m/s
}

func ADSBAircraftToEntity(aircraft ADSBAircraft, controllerName string, trackerID string, expires time.Duration) *pb.Entity {
	if aircraft.Lat == nil || aircraft.Lon == nil {
		return nil
	}

	entityID := fmt.Sprintf("adsblol.%s", aircraft.Hex)

	label := strings.TrimSpace(aircraft.Callsign)
	if label == "" {
		label = strings.TrimSpace(aircraft.Registration)
	}
	if label == "" {
		label = aircraft.Hex
	}

	altitude := 0.0
	if aircraft.AltBaro != nil && aircraft.AltBaro.Valid {
		altitude = float64(aircraft.AltBaro.Value) * 0.3048
	} else if aircraft.AltGeom != nil && aircraft.AltGeom.Valid {
		altitude = float64(aircraft.AltGeom.Value) * 0.3048
	}

	sidc := aircraftToSIDC(aircraft)

	geo := &pb.GeoSpatialComponent{
		Latitude:  *aircraft.Lat,
		Longitude: *aircraft.Lon,
		Altitude:  &altitude,
	}

	// Populate position covariance from NACp
	if aircraft.NACp != nil && *aircraft.NACp >= 0 && *aircraft.NACp < len(nacpToEPU) {
		epu := nacpToEPU[*aircraft.NACp]
		// EPU is 95% containment radius; σ ≈ EPU/2, variance = σ²
		posVar := (epu / 2) * (epu / 2)
		geo.Covariance = &pb.CovarianceMatrix{
			Mxx: &posVar,
			Myy: &posVar,
		}
	}

	transponderADSB := &pb.TransponderADSB{}
	if icao, err := strconv.ParseUint(aircraft.Hex, 16, 32); err == nil {
		icao32 := uint32(icao)
		transponderADSB.IcaoAddress = &icao32
	}
	callsign := strings.TrimSpace(aircraft.Callsign)
	if callsign != "" {
		transponderADSB.FlightId = &callsign
	}

	entity := &pb.Entity{
		Id:    entityID,
		Label: &label,
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(expires * 2 * time.Second)),
		},
		Geo: geo,
		Symbol: &pb.SymbolComponent{
			MilStd2525C: sidc,
		},
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Track: &pb.TrackComponent{
			Tracker: &trackerID,
		},
		Transponder: &pb.TransponderComponent{
			Adsb: transponderADSB,
		},
	}

	navMode := pb.NavigationMode_NavigationModeStationary
	if aircraft.GroundSpeed != nil && *aircraft.GroundSpeed > 1 {
		navMode = pb.NavigationMode_NavigationModeUnderway
	}
	entity.Navigation = &pb.NavigationComponent{
		Mode: &navMode,
	}
	if (aircraft.Emergency != "" && aircraft.Emergency != "none") ||
		aircraft.Squawk == "7500" || aircraft.Squawk == "7600" || aircraft.Squawk == "7700" {
		emergency := true
		entity.Navigation.Emergency = &emergency
	}

	if aircraft.Track != nil {
		rad := *aircraft.Track * math.Pi / 180.0
		halfRad := rad / 2.0
		sz := math.Sin(halfRad)
		cz := math.Cos(halfRad)
		entity.Orientation = &pb.OrientationComponent{
			Orientation: &pb.Quaternion{
				X: 0,
				Y: 0,
				Z: sz,
				W: cz,
			},
		}

		if aircraft.GroundSpeed != nil {
			speedMs := *aircraft.GroundSpeed * 0.514444
			east := speedMs * math.Sin(rad)
			north := speedMs * math.Cos(rad)
			velEnu := &pb.KinematicsEnu{
				East:  &east,
				North: &north,
			}

			// Populate velocity covariance from NACv
			if aircraft.NACv != nil && *aircraft.NACv >= 0 && *aircraft.NACv < len(nacvToVelocityUncertainty) {
				vu := nacvToVelocityUncertainty[*aircraft.NACv]
				velVar := vu * vu
				velEnu.Covariance = &pb.CovarianceMatrix{
					Mxx: &velVar,
					Myy: &velVar,
				}
			}

			entity.Kinematics = &pb.KinematicsComponent{
				VelocityEnu: velEnu,
			}
		}
	}

	return entity
}

func aircraftToSIDC(aircraft ADSBAircraft) string {
	affiliation := "F"

	if aircraft.Squawk != "" {
		switch aircraft.Squawk {
		case "7500", "7700":
			affiliation = "H"
		case "7600":
			affiliation = "N"
		}
	}

	dimension := "A"
	status := "P"
	functionID := "MF"

	if aircraft.Type != "" {
		t := aircraft.Type
		if len(t) > 0 && (t[0] == 'H' || containsAny(t, "60", "47", "53")) {
			functionID = "MH"
		} else if containsAny(t, "737", "320", "380", "777", "787") {
			functionID = "CF"
		} else if containsAny(t, "C130", "C17", "KC", "B1", "B2", "B52", "F15", "F16", "F18", "F22", "F35") {
			affiliation = "F"
			functionID = "MF"
		}
	}

	sidc := fmt.Sprintf("S%s%s%s%s--------*", affiliation, dimension, status, functionID)

	if len(sidc) > 15 {
		sidc = sidc[:15]
	}

	return sidc
}

func containsAny(s string, substrs ...string) bool {
	for _, substr := range substrs {
		if strings.Contains(s, substr) {
			return true
		}
	}
	return false
}
