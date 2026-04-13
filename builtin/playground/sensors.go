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

const numSensors = 32

// 8 positions around Lake Geneva (Lac Léman).
var sensorPositions = [8]struct {
	name string
	lat  float64
	lon  float64
}{
	{"Geneva", 46.2044, 6.1432},
	{"Nyon", 46.3833, 6.2396},
	{"Lausanne", 46.5197, 6.6323},
	{"Vevey", 46.4603, 6.8431},
	{"Montreux", 46.4312, 6.9109},
	{"Evian", 46.4008, 6.5892},
	{"Thonon", 46.3707, 6.4794},
	{"Morges", 46.5113, 6.4981},
}

// 4 altitude tiers in metres above WGS-84 (lake surface ≈ 372 m).
var sensorAltitudes = [4]float64{375, 550, 800, 1200}

// Radiation-capable sensor indices (flat index = posIdx*4 + altIdx).
//
//	Geneva  alt 0,1  → idx 0,1
//	Nyon    alt 0,1  → idx 4,5
//	Lausanne alt 0,1 → idx 8,9
//	Vevey   alt 0    → idx 12  (overlap)
//	Montreux alt 0   → idx 16  (overlap)
//
// Total: 8
var radiationSensors = map[int]bool{
	0: true, 1: true,
	4: true, 5: true,
	8: true, 9: true,
	12: true,
	16: true,
}

// Chemical-capable sensor indices.
//
//	Vevey    alt 0   → idx 12 (overlap)
//	Montreux alt 0   → idx 16 (overlap)
//	Evian    alt 0,1 → idx 20,21
//	Thonon   alt 0,1 → idx 24,25
//	Morges   alt 0,1 → idx 28,29
//
// Total: 8 (2 overlap with radiation)
var chemicalSensors = map[int]bool{
	12: true,
	16: true,
	20: true, 21: true,
	24: true, 25: true,
	28: true, 29: true,
}

// --- Configuration ---

type sensorNetworkConfig struct {
	UpdateIntervalMs int `json:"update_interval_ms"`
}

// --- Per-sensor state ---

type weatherSensor struct {
	id    string
	label string
	lat   float64
	lon   float64
	alt   float64

	temperature   float64
	humidity      float64
	windSpeed     float64
	windDirection float64
	pressure      float64

	batteryCharge float32
	voltage       float32
	rssi          int32
}

func initWeatherSensors(parentID string) [numSensors]*weatherSensor {
	var sensors [numSensors]*weatherSensor
	for posIdx := 0; posIdx < 8; posIdx++ {
		pos := sensorPositions[posIdx]
		for altIdx := 0; altIdx < 4; altIdx++ {
			idx := posIdx*4 + altIdx
			alt := sensorAltitudes[altIdx]

			// Temperature lapse rate ~6.5 °C/km from ~15 °C at lake level.
			baseTemp := 15.0 - 6.5*(alt-375)/1000
			// Pressure drops ~12 hPa per 100 m from ~970 hPa at lake level.
			basePressure := 970.0 - 12.0*(alt-375)/100

			sensors[idx] = &weatherSensor{
				id:            fmt.Sprintf("%s.s%02d", parentID, idx),
				label:         fmt.Sprintf("%s %dm", pos.name, int(alt)),
				lat:           pos.lat,
				lon:           pos.lon,
				alt:           alt,
				temperature:   baseTemp + (rand.Float64()-0.5)*2,
				humidity:      65 + (rand.Float64()-0.5)*20,
				windSpeed:     2 + float64(altIdx)*1.5 + rand.Float64()*2,
				windDirection: rand.Float64() * 360,
				pressure:      basePressure + (rand.Float64()-0.5)*5,
				batteryCharge: 0.5 + float32(rand.Float64())*0.5,
				voltage:       3.6 + float32(rand.Float64())*0.6,
				rssi:          -70 - int32(rand.IntN(30)),
			}
		}
	}
	return sensors
}

func (s *weatherSensor) step() {
	s.temperature += (rand.Float64() - 0.5) * 0.3
	s.humidity = max(20, min(100, s.humidity+(rand.Float64()-0.5)*1.0))
	s.windSpeed = math.Max(0, s.windSpeed+(rand.Float64()-0.5)*0.5)
	s.windDirection = math.Mod(s.windDirection+(rand.Float64()-0.5)*5+360, 360)
	s.pressure += (rand.Float64() - 0.5) * 0.2

	s.batteryCharge += float32(rand.Float64()-0.52) * 0.005
	if s.batteryCharge > 1.0 {
		s.batteryCharge = 1.0
	} else if s.batteryCharge < 0.1 {
		s.batteryCharge = 0.1
	}
	s.voltage = 3.3 + s.batteryCharge*0.9

	s.rssi += int32(rand.IntN(5)) - 2
	s.rssi = max(-110, min(-40, s.rssi))
}

// --- Hazard readings with alarm cycling ---

// radiationReading returns (µSv/h, AlertLevel) for a radiation-capable sensor.
func radiationReading(sensorIdx, tick int) (float64, pb.AlertLevel) {
	switch sensorIdx {
	case 0: // Geneva 375m: persistent warning
		return 0.8 + rand.Float64()*0.4, pb.AlertLevel_AlertLevelWarning
	case 9: // Lausanne 550m: persistent critical
		return 8.0 + rand.Float64()*3.0, pb.AlertLevel_AlertLevelCritical
	case 12: // Vevey 375m (overlap): persistent alarm
		return 3.0 + rand.Float64()*1.5, pb.AlertLevel_AlertLevelAlarm
	case 16: // Montreux 375m (overlap): cycling normal→warning→alarm
		switch (tick / 30) % 3 {
		case 1:
			return 0.6 + rand.Float64()*0.3, pb.AlertLevel_AlertLevelWarning
		case 2:
			return 2.5 + rand.Float64()*1.0, pb.AlertLevel_AlertLevelAlarm
		}
		return 0.12 + rand.Float64()*0.05, pb.AlertLevel_AlertLevelNone
	case 4: // Nyon 375m: cycling warning
		if (tick/20)%2 == 1 {
			return 0.7 + rand.Float64()*0.3, pb.AlertLevel_AlertLevelWarning
		}
		return 0.12 + rand.Float64()*0.05, pb.AlertLevel_AlertLevelNone
	default: // background
		return 0.10 + rand.Float64()*0.08, pb.AlertLevel_AlertLevelNone
	}
}

type chemHazard struct {
	label string
	bars  uint64
	alert pb.AlertLevel
}

var chemHazardNames = []string{"Dimethyl Sulfide", "Hydrogen Sulfide", "Ammonia", "Methane", "Sulfur Dioxide"}

// chemicalReadings returns per-hazard bar readings for a chemical-capable sensor.
func chemicalReadings(sensorIdx, tick int) []chemHazard {
	hazards := make([]chemHazard, len(chemHazardNames))
	for i, name := range chemHazardNames {
		hazards[i] = chemHazard{label: name, alert: pb.AlertLevel_AlertLevelNone}
	}

	switch sensorIdx {
	case 12: // Vevey 375m (overlap): persistent GB+HD warning
		hazards[0].bars = 2 + uint64(rand.IntN(2))
		hazards[0].alert = pb.AlertLevel_AlertLevelWarning
		hazards[2].bars = 1 + uint64(rand.IntN(2))
		hazards[2].alert = pb.AlertLevel_AlertLevelWarning
	case 16: // Montreux 375m (overlap): cycling VX+HCN
		switch (tick / 25) % 3 {
		case 1:
			hazards[1].bars = 1 + uint64(rand.IntN(2))
			hazards[1].alert = pb.AlertLevel_AlertLevelWarning
		case 2:
			hazards[1].bars = 4 + uint64(rand.IntN(3))
			hazards[1].alert = pb.AlertLevel_AlertLevelAlarm
			hazards[3].bars = 2 + uint64(rand.IntN(2))
			hazards[3].alert = pb.AlertLevel_AlertLevelWarning
		}
	case 20: // Evian 375m: persistent GB+VX+CG alarm
		hazards[0].bars = 3 + uint64(rand.IntN(3))
		hazards[0].alert = pb.AlertLevel_AlertLevelAlarm
		hazards[1].bars = 2 + uint64(rand.IntN(2))
		hazards[1].alert = pb.AlertLevel_AlertLevelWarning
		hazards[4].bars = 1 + uint64(rand.IntN(3))
		hazards[4].alert = pb.AlertLevel_AlertLevelWarning
	case 25: // Thonon 550m: persistent critical HD+HCN+CG
		hazards[2].bars = 6 + uint64(rand.IntN(3))
		hazards[2].alert = pb.AlertLevel_AlertLevelCritical
		hazards[3].bars = 4 + uint64(rand.IntN(3))
		hazards[3].alert = pb.AlertLevel_AlertLevelAlarm
		hazards[4].bars = 3 + uint64(rand.IntN(3))
		hazards[4].alert = pb.AlertLevel_AlertLevelAlarm
	case 21: // Evian 550m: cycling GB alarm
		if (tick/15)%2 == 1 {
			hazards[0].bars = 3 + uint64(rand.IntN(3))
			hazards[0].alert = pb.AlertLevel_AlertLevelAlarm
			hazards[2].bars = 1 + uint64(rand.IntN(2))
			hazards[2].alert = pb.AlertLevel_AlertLevelWarning
		}
	}

	return hazards
}

// --- Entity builder ---

func buildSensorEntity(s *weatherSensor, sensorIdx, tick int, networkEntityID string, ttl *timestamppb.Timestamp) *pb.Entity {
	now := timestamppb.Now()

	metrics := []*pb.Metric{
		{
			Kind:       pb.MetricKind_MetricKindTemperature.Enum(),
			Unit:       pb.MetricUnit_MetricUnitCelsius,
			Label:      proto.String("Temperature"),
			Id:         proto.Uint32(1),
			MeasuredAt: now,
			Val:        &pb.Metric_Double{Double: s.temperature},
		},
		{
			Kind:       pb.MetricKind_MetricKindHumidity.Enum(),
			Unit:       pb.MetricUnit_MetricUnitPercent,
			Label:      proto.String("Humidity"),
			Id:         proto.Uint32(2),
			MeasuredAt: now,
			Val:        &pb.Metric_Double{Double: s.humidity},
		},
		{
			Kind:       pb.MetricKind_MetricKindWindSpeed.Enum(),
			Unit:       pb.MetricUnit_MetricUnitMeterPerSecond,
			Label:      proto.String("Wind Speed"),
			Id:         proto.Uint32(3),
			MeasuredAt: now,
			Val:        &pb.Metric_Double{Double: s.windSpeed},
		},
		{
			Kind:       pb.MetricKind_MetricKindWindDirection.Enum(),
			Unit:       pb.MetricUnit_MetricUnitDegree,
			Label:      proto.String("Wind Direction"),
			Id:         proto.Uint32(4),
			MeasuredAt: now,
			Val:        &pb.Metric_Double{Double: s.windDirection},
		},
		{
			Kind:       pb.MetricKind_MetricKindPressure.Enum(),
			Unit:       pb.MetricUnit_MetricUnitHectopascal,
			Label:      proto.String("Pressure"),
			Id:         proto.Uint32(5),
			MeasuredAt: now,
			Val:        &pb.Metric_Double{Double: s.pressure},
		},
	}

	if radiationSensors[sensorIdx] {
		rate, alert := radiationReading(sensorIdx, tick)
		metrics = append(metrics, &pb.Metric{
			Kind:       pb.MetricKind_MetricKindRadiationHazard.Enum(),
			Unit:       pb.MetricUnit_MetricUnitMicrosievertPerHour,
			Label:      proto.String("Dose Rate"),
			Id:         proto.Uint32(6),
			MeasuredAt: now,
			Val:        &pb.Metric_Double{Double: rate},
			Alerting:   alert.Enum(),
		})
	}

	if chemicalSensors[sensorIdx] {
		for i, hazard := range chemicalReadings(sensorIdx, tick) {
			metrics = append(metrics, &pb.Metric{
				Kind:       pb.MetricKind_MetricKindChemicalHazard.Enum(),
				Unit:       pb.MetricUnit_MetricUnitBar,
				Label:      proto.String(hazard.label),
				Id:         proto.Uint32(7 + uint32(i)),
				MeasuredAt: now,
				Val:        &pb.Metric_Uint64{Uint64: hazard.bars},
				Alerting:   hazard.alert.Enum(),
			})
		}
	}

	linkStatus := pb.LinkStatus_LinkStatusConnected
	if s.rssi < -95 {
		linkStatus = pb.LinkStatus_LinkStatusDegraded
	}

	return &pb.Entity{
		Id:      s.id,
		Label:   proto.String(s.label),
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
		Device: &pb.DeviceComponent{
			Parent: proto.String(networkEntityID),
			State:  pb.DeviceState_DeviceStateActive,
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  s.lat,
			Longitude: s.lon,
			Altitude:  proto.Float64(s.alt),
		},
		Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPE-----*****"},
		Metric: &pb.MetricComponent{Metrics: metrics},
		Link: &pb.LinkComponent{
			Status:   linkStatus.Enum(),
			RssiDbm:  proto.Int32(s.rssi),
			SnrDb:    proto.Int32(s.rssi + 30),
			Via:      proto.String(networkEntityID),
			LastSeen: now,
		},
		Power: &pb.PowerComponent{
			BatteryChargeRemaining: proto.Float32(s.batteryCharge),
			Voltage:                proto.Float32(s.voltage),
		},
		Sensor:   &pb.SensorComponent{},
		Lifetime: &pb.Lifetime{Until: ttl},
	}
}

// --- Main loop ---

func runSensorNetwork(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	cfg := sensorNetworkConfig{UpdateIntervalMs: 5000}
	if entity.Config != nil && entity.Config.Value != nil {
		b, _ := entity.Config.Value.MarshalJSON()
		_ = json.Unmarshal(b, &cfg)
	}
	if cfg.UpdateIntervalMs < 1000 {
		cfg.UpdateIntervalMs = 5000
	}

	ready()

	networkEntityID := entity.Id
	sensors := initWeatherSensors(networkEntityID)

	logger.Info("Starting sensor network",
		"entityID", networkEntityID,
		"sensors", numSensors,
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
			expireSensors(context.Background(), worldClient, sensors[:])
			return ctx.Err()
		case <-ticker.C:
			ttl := timestamppb.New(time.Now().Add(
				time.Duration(cfg.UpdateIntervalMs)*time.Millisecond*3 + 30*time.Second))

			entities := make([]*pb.Entity, numSensors)
			for i, s := range sensors {
				s.step()
				entities[i] = buildSensorEntity(s, i, tick, networkEntityID, ttl)
			}

			_, _ = worldClient.Push(ctx, &pb.EntityChangeRequest{Changes: entities})
			tick++
		}
	}
}

func expireSensors(ctx context.Context, client pb.WorldServiceClient, sensors []*weatherSensor) {
	var wg sync.WaitGroup
	for _, s := range sensors {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: s.id})
		}()
	}
	wg.Wait()
}

// --- Schema ---

func sensorNetworkSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"update_interval_ms": map[string]any{
				"type":        "number",
				"title":       "Update Interval",
				"description": "How often sensor readings are updated",
				"default":     5000,
				"minimum":     1000,
				"maximum":     60000,
				"ui:unit":     "ms",
			},
		},
	})
	return s
}
