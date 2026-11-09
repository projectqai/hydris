package playground

import (
	"fmt"
	"math"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	batteryCapacityMah = 22000.0
	batteryCells       = 6
	cruiseCurrentA     = 14.0
	adsbICAO           = 0x484F52
	adsbFlightID       = "ISR1"
)

// telemetry holds the simulated avionics state that is not part of the
// flight model: battery, datalink and GNSS.
type telemetry struct {
	start      time.Time
	gcsLat     float64 // ground station the datalink runs to
	gcsLon     float64
	usedMah    float64
	currentA   float64
	latencyAvg float64
}

func newTelemetry(now time.Time, gcsLat, gcsLon float64) *telemetry {
	return &telemetry{start: now, gcsLat: gcsLat, gcsLon: gcsLon}
}

// step integrates battery drain over dt: cruise current plus extra for the
// load factor in turns and for climbing.
func (t *telemetry) step(fw *fixedWing, dt float64) {
	loadFactor := 1 / math.Cos(fw.bank)
	t.currentA = cruiseCurrentA*loadFactor + math.Max(fw.climb, 0)*4
	// never run flat: the sim holds at a reserve instead of falling out of the sky
	t.usedMah = math.Min(t.usedMah+t.currentA*dt/3.6, batteryCapacityMah*0.95)
}

func (t *telemetry) charge() float64 { return 1 - t.usedMah/batteryCapacityMah }

// navState is what the aircraft is doing for the Navigation/Mission
// components.
type navState struct {
	mode           pb.NavigationMode
	tasked         bool
	centreLat      float64
	centreLon      float64
	distanceM      float64 // to the orbit centre
	radius         float64
	arrivalSeconds float64
}

// fullEntity is the drone with every telemetry component. It is published
// at the telemetry rate; the fast pose loop only sends position, attitude
// and kinematics.
func (t *telemetry) fullEntity(id, parent, gcsID string, fw *fixedWing, nav navState, now time.Time) *pb.Entity {
	sec := now.Sub(t.start).Seconds()
	e := poseEntity(id, fw)
	e.Label = proto.String("ISR1")
	e.Controller = &pb.Controller{Id: proto.String(controllerName)}
	e.Device = &pb.DeviceComponent{Parent: proto.String(parent), State: pb.DeviceState_DeviceStateActive}
	e.Symbol = &pb.SymbolComponent{MilStd2525C: "SFAPMFQ--------"}
	e.Interactivity = &pb.InteractivityComponent{Icon: proto.String("plane")}
	e.ManualControl = &pb.ManualControlComponent{}
	e.Classification = &pb.ClassificationComponent{Taxonomy: []*pb.ClassificationTaxonomy{{
		Confidence: &pb.ClassificationConfidence{Confidence: 1},
		Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
			Unmanned: &pb.VehicleTaxonomyUnmanned{},
			Domain: &pb.VehicleTaxonomy_Air{Air: &pb.VehicleTaxonomyAir{
				Kind: &pb.VehicleTaxonomyAir_FixedWing{FixedWing: &pb.VehicleTaxonomyAirFixedWing{}},
			}},
		}},
	}}}
	e.Administrative = &pb.AdministrativeComponent{
		Id:           proto.String("ISR1"),
		Flag:         proto.String("NL"),
		Owner:        proto.String("Playground"),
		Operator:     proto.String("Playground ISR Flight"),
		Manufacturer: proto.String("Hydris Simulation"),
		Model:        proto.String("ISR-1 fixed wing"),
		YearBuilt:    proto.Uint32(2026),
		LengthM:      proto.Float32(2.1),
		WidthM:       proto.Float32(3.4), // wingspan
		HeightM:      proto.Float32(0.5),
		SpeedMaxKn:   proto.Float32(60),
	}

	// GNSS: a healthy 3D fix whose geometry drifts slowly with the
	// constellation; the position covariance follows the DOP.
	visible := uint32(15 + int(2.5*math.Sin(sec/97)))
	hdop := 0.8 + 0.12*math.Sin(sec/53)
	vdop := 1.2 + 0.15*math.Sin(sec/71)
	e.Gnss = &pb.GnssComponent{
		FixType:           pb.GnssFixType_GnssFixType3D.Enum(),
		SatellitesVisible: proto.Uint32(visible),
		SatellitesUsed:    proto.Uint32(visible - 3),
		Hdop:              proto.Float32(float32(hdop)),
		Vdop:              proto.Float32(float32(vdop)),
		Pdop:              proto.Float32(float32(math.Hypot(hdop, vdop))),
	}
	sh, sv := hdop*1.5, vdop*2.5
	e.Geo.Covariance = &pb.CovarianceMatrix{Mxx: proto.Float64(sh * sh), Myy: proto.Float64(sh * sh), Mzz: proto.Float64(sv * sv)}

	charge := t.charge()
	cellV := 3.5 + 0.7*charge - 0.004*t.currentA // sag under load
	e.Power = &pb.PowerComponent{
		BatteryChargeRemaining: proto.Float32(float32(charge)),
		BatteryChargePercent:   proto.Uint32(uint32(math.Round(charge * 100))),
		Voltage:                proto.Float32(float32(cellV * batteryCells)),
		CurrentA:               proto.Float32(float32(t.currentA)),
		CapacityUsedMah:        proto.Float32(float32(t.usedMah)),
		RemainingSeconds:       proto.Uint32(uint32((batteryCapacityMah - t.usedMah) / t.currentA * 3.6)),
	}

	// datalink to the ground station: free-space-ish path loss with range
	ge, gn := enuDelta(t.gcsLat, t.gcsLon, fw.lat, fw.lon)
	gcsDist := math.Max(math.Hypot(math.Hypot(ge, gn), fw.alt), 50)
	rssi := -42 - 20*math.Log10(gcsDist/100)
	quality := clampF((rssi+105)*2, 0, 100)
	latency := 22 + gcsDist/1000*1.5 + 4*math.Sin(sec*1.7)
	if t.latencyAvg == 0 {
		t.latencyAvg = latency
	}
	t.latencyAvg += (latency - t.latencyAvg) * 0.1
	status := pb.LinkStatus_LinkStatusConnected
	if quality < 40 {
		status = pb.LinkStatus_LinkStatusDegraded
	}
	e.Link = &pb.LinkComponent{
		Status:             status.Enum(),
		RssiDbm:            proto.Int32(int32(math.Round(rssi))),
		SnrDb:              proto.Int32(int32(math.Round(rssi + 100))),
		Via:                proto.String(gcsID),
		LastLatencyMs:      proto.Uint32(uint32(latency)),
		AvgLatencyMs:       proto.Uint32(uint32(t.latencyAvg)),
		LastSeen:           timestamppb.New(now),
		LinkQualityPercent: proto.Uint32(uint32(quality)),
		TxPowerMw:          proto.Uint32(1000),
		ActiveAntenna:      proto.Uint32(uint32(int(sec/10) % 2)),
		RfMode:             proto.String("OFDM 10MHz"),
		PacketRateHz:       proto.Uint32(uint32(time.Second / isrPoseInterval)),
	}

	e.Transponder = &pb.TransponderComponent{Adsb: &pb.TransponderADSB{
		IcaoAddress: proto.Uint32(adsbICAO),
		FlightId:    proto.String(adsbFlightID),
	}}

	e.Navigation = &pb.NavigationComponent{
		Mode:      nav.mode.Enum(),
		Armed:     proto.Bool(true),
		Emergency: proto.Bool(false),
	}
	dest := fmt.Sprintf("%.5f, %.5f", nav.centreLat, nav.centreLon)
	mission := &pb.MissionComponent{Members: []string{id}, Destination: proto.String(dest)}
	switch nav.mode {
	case pb.NavigationMode_NavigationModeUnderway:
		mission.Description = proto.String(fmt.Sprintf("Under manual control at %.0f m, %.0f m/s", fw.alt, fw.speed))
	case pb.NavigationMode_NavigationModeLoitering:
		mission.Description = proto.String(fmt.Sprintf("Loitering over %s, %.0f m orbit at %.0f m", dest, nav.radius, fw.alt))
	default:
		mission.Description = proto.String(fmt.Sprintf("En route to %s, %.1f km to go", dest, nav.distanceM/1000))
		mission.Eta = timestamppb.New(now.Add(time.Duration(nav.arrivalSeconds * float64(time.Second))))
	}
	if nav.tasked {
		e.Navigation.WaypointTotal = proto.Uint32(1)
		e.Navigation.WaypointCurrent = proto.Uint32(0)
		if nav.mode == pb.NavigationMode_NavigationModeLoitering {
			e.Navigation.WaypointCurrent = proto.Uint32(1)
		}
	}
	e.Mission = mission

	at := timestamppb.New(now)
	metric := func(id uint32, label string, kind pb.MetricKind, unit pb.MetricUnit, v float64) *pb.Metric {
		return &pb.Metric{Id: proto.Uint32(id), Label: proto.String(label), Kind: kind.Enum(), Unit: unit,
			MeasuredAt: at, Val: &pb.Metric_Double{Double: v}}
	}
	ve, vn := fw.velocity()
	e.Metric = &pb.MetricComponent{Metrics: []*pb.Metric{
		metric(1, "Airspeed", pb.MetricKind_MetricKindSpeed, pb.MetricUnit_MetricUnitMeterPerSecond, fw.speed),
		metric(2, "Ground speed", pb.MetricKind_MetricKindSpeed, pb.MetricUnit_MetricUnitMeterPerSecond, math.Hypot(ve, vn)),
		metric(3, "Altitude", pb.MetricKind_MetricKindDistance, pb.MetricUnit_MetricUnitMeter, fw.alt),
		metric(4, "Climb rate", pb.MetricKind_MetricKindSpeed, pb.MetricUnit_MetricUnitMeterPerSecond, fw.climb),
		metric(5, "Heading", pb.MetricKind_MetricKindWindDirection, pb.MetricUnit_MetricUnitDegree, fw.headingDeg()),
		metric(6, "Bank angle", pb.MetricKind_MetricKindUnspecified, pb.MetricUnit_MetricUnitDegree, fw.bank*180/math.Pi),
		metric(7, "Pitch angle", pb.MetricKind_MetricKindUnspecified, pb.MetricUnit_MetricUnitDegree, fw.pitch*180/math.Pi),
		metric(8, "Distance to target", pb.MetricKind_MetricKindDistance, pb.MetricUnit_MetricUnitMeter, nav.distanceM),
		metric(9, "Flight time", pb.MetricKind_MetricKindDuration, pb.MetricUnit_MetricUnitSecond, sec),
		metric(10, "Battery temperature", pb.MetricKind_MetricKindTemperature, pb.MetricUnit_MetricUnitCelsius, 24+12*(1-math.Exp(-sec/900))+t.currentA*0.2),
	}}
	return e
}

// poseEntity carries the fast-changing state: position, attitude and
// kinematics.
func poseEntity(id string, fw *fixedWing) *pb.Entity {
	ve, vn := fw.velocity()
	ae, an, au := fw.acceleration()
	return &pb.Entity{
		Id:          id,
		Geo:         &pb.GeoSpatialComponent{Latitude: fw.lat, Longitude: fw.lon, Altitude: proto.Float64(fw.alt)},
		Orientation: &pb.OrientationComponent{Orientation: fw.attitude().proto()},
		Kinematics: &pb.KinematicsComponent{
			VelocityEnu:     &pb.KinematicsEnu{East: proto.Float64(ve), North: proto.Float64(vn), Up: proto.Float64(fw.climb)},
			AccelerationEnu: &pb.KinematicsEnu{East: proto.Float64(ae), North: proto.Float64(an), Up: proto.Float64(au)},
			// body rates: roll about the forward axis, yaw about up
			// (positive counter-clockwise, so a right turn is negative)
			AngularVelocityBody: &pb.AngularVelocity{RollRate: fw.bankRate, PitchRate: 0, YawRate: -fw.turnRate},
		},
	}
}
