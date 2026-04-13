package sapient

import (
	"fmt"
	"math"
	"strings"
	"time"

	sapientpb "github.com/aep/gosapient/pkg/sapientpb"
	pb "github.com/projectqai/proto/go"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// registrationToEntity converts a SAPIENT Registration into a hydris Entity
// that represents the registered sensor as a subdevice.
func registrationToEntity(reg *sapientpb.Registration, sapientNodeID, parentEntityID, trackerEntityID string) *pb.Entity {
	entityID := fmt.Sprintf("sapient:%s", sapientNodeID)

	label := reg.GetName()
	if label == "" {
		label = reg.GetShortName()
	}
	if label == "" {
		label = sapientNodeID
	}

	entity := &pb.Entity{
		Id:    entityID,
		Label: &label,
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Parent:   &parentEntityID,
			Category: proto.String("Sensors"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Sensor:  &pb.SensorComponent{},
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
	}

	// Map node type to symbol
	if len(reg.GetNodeDefinition()) > 0 {
		nt := reg.NodeDefinition[0].GetNodeType()
		if sidc, ok := nodeTypeToSIDC[nt]; ok {
			entity.Symbol = &pb.SymbolComponent{MilStd2525C: sidc}
		}
	}

	// Modes → ConfigurableComponent
	if modes := reg.GetModeDefinition(); len(modes) > 0 {
		modeNames := make([]any, 0, len(modes))
		for _, m := range modes {
			if n := m.GetModeName(); n != "" {
				modeNames = append(modeNames, n)
			}
		}
		if len(modeNames) > 0 {
			schema, _ := structpb.NewStruct(map[string]any{
				"type": "object",
				"properties": map[string]any{
					"mode": map[string]any{
						"type":    "string",
						"title":   "Mode",
						"enum":    modeNames,
						"default": modeNames[0],
					},
				},
			})
			entity.Configurable = &pb.ConfigurableComponent{
				Label:  proto.String("Sensor Mode"),
				Schema: schema,
			}
		}
	}

	return entity
}

// registrationExpiry returns a detection expiry based on the node type.
func registrationExpiry(reg *sapientpb.Registration) time.Duration {
	if len(reg.GetNodeDefinition()) > 0 {
		switch reg.NodeDefinition[0].GetNodeType() {
		case sapientpb.Registration_NODE_TYPE_RADAR:
			return 5 * time.Second
		}
	}
	return 0
}

// shouldDropDetection returns true if the detection should be filtered out:
// no classification, classification "Unknown", or top-level confidence below 0.5.
func shouldDropDetection(det *sapientpb.DetectionReport) bool {
	if len(det.GetClassification()) == 0 {
		return true
	}
	cls := det.Classification[0]
	if strings.EqualFold(cls.GetType(), "unknown") {
		return true
	}
	if cls.Confidence != nil && cls.GetConfidence() < 0.5 {
		return true
	}
	return false
}

// detectionToEntity converts a SAPIENT DetectionReport into a hydris Entity.
func detectionToEntity(det *sapientpb.DetectionReport, sapientNodeID, trackerEntityID string, expiry time.Duration, sensorLat, sensorLng, sensorAlt float64, isRadar bool) *pb.Entity {
	objectID := det.GetObjectId()
	entityID := fmt.Sprintf("sapient:%s:%s", sapientNodeID, objectID)

	hasTrackInfo := len(det.GetTrackInfo()) > 0

	entity := &pb.Entity{
		Id: entityID,
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(expiry)),
		},
		Symbol:  &pb.SymbolComponent{MilStd2525C: defaultDetectionSIDC},
		Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
	}

	if hasTrackInfo {
		entity.Track = &pb.TrackComponent{
			Tracker: &trackerEntityID,
		}
	} else {
		entity.Detection = &pb.DetectionComponent{
			DetectorEntityId: &trackerEntityID,
		}
	}

	// Location — always emit PoseComponent relative to the sensor entity.
	sensorEntityID := fmt.Sprintf("sapient:%s", sapientNodeID)
	switch loc := det.GetLocationOneof().(type) {
	case *sapientpb.DetectionReport_Location:
		l := loc.Location
		detLat := l.GetY()
		detLng := l.GetX()
		posErr := math.Max(l.GetXError(), l.GetYError())
		// Convert to polar pose only for radars with error info and known sensor position
		if isRadar && posErr > 0 && sensorLat != 0 && sensorLng != 0 {
			az, rng := latLngToAzimuthRange(sensorLat, sensorLng, detLat, detLng)
			polar := &pb.PolarOffset{
				Azimuth: az,
				Range:   &rng,
			}
			if l.Z != nil && sensorAlt != 0 {
				dAlt := l.GetZ() - sensorAlt
				slantRange := math.Sqrt(rng*rng + dAlt*dAlt)
				elev := math.Atan2(dAlt, rng) * 180.0 / math.Pi
				polar.Range = &slantRange
				polar.Elevation = &elev
			}
			if rng > 0 {
				rngErr := posErr
				polar.RangeErrorM = &rngErr
				azErr := posErr / rng * 180.0 / math.Pi
				polar.AzimuthErrorDeg = &azErr
			}
			entity.Pose = &pb.PoseComponent{
				Parent: sensorEntityID,
				Offset: &pb.PoseComponent_Polar{Polar: polar},
			}
		} else {
			entity.Geo = &pb.GeoSpatialComponent{
				Latitude:  detLat,
				Longitude: detLng,
			}
			if l.Z != nil {
				alt := l.GetZ()
				entity.Geo.Altitude = &alt
			}
			if posErr > 0 {
				xVar := l.GetXError() * l.GetXError()
				yVar := l.GetYError() * l.GetYError()
				entity.Geo.Covariance = &pb.CovarianceMatrix{
					Mxx: &xVar,
					Myy: &yVar,
				}
			}
		}
	case *sapientpb.DetectionReport_RangeBearing:
		rb := loc.RangeBearing
		polar := &pb.PolarOffset{
			Azimuth: rb.GetAzimuth(),
		}
		if rb.Elevation != nil {
			polar.Elevation = rb.Elevation
		}
		if rb.Range != nil {
			polar.Range = rb.Range
		}
		if rb.AzimuthError != nil {
			errDeg := rb.GetAzimuthError()
			polar.AzimuthErrorDeg = &errDeg
		}
		if rb.ElevationError != nil {
			errDeg := rb.GetElevationError()
			polar.ElevationErrorDeg = &errDeg
		}
		if rb.RangeError != nil {
			errM := rb.GetRangeError()
			polar.RangeErrorM = &errM
		}
		entity.Pose = &pb.PoseComponent{
			Parent: sensorEntityID,
			Offset: &pb.PoseComponent_Polar{Polar: polar},
		}
	}

	// Classification — refine symbol from default unknown.
	// Walk sub-classes deepest-first so the most specific match wins.
	if len(det.GetClassification()) > 0 {
		cls := det.Classification[0]
		dim := classificationToBattleDimension(cls.GetType())
		entity.Classification = &pb.ClassificationComponent{
			Dimension: &dim,
		}
		if cls.GetType() != "" {
			entity.Label = proto.String(cls.GetType())
			if s := matchClassificationSIDC(cls.GetType()); s != "" {
				entity.Symbol.MilStd2525C = s
			}
		}
		for _, sub := range cls.GetSubClass() {
			if sub.GetType() != "" {
				entity.Label = proto.String(sub.GetType())
				if s := matchClassificationSIDC(sub.GetType()); s != "" {
					entity.Symbol.MilStd2525C = s
				}
			}
		}
	}

	// Velocity
	switch vel := det.GetVelocityOneof().(type) {
	case *sapientpb.DetectionReport_EnuVelocity:
		v := vel.EnuVelocity
		east := v.GetEastRate()
		north := v.GetNorthRate()
		up := v.GetUpRate()
		entity.Kinematics = &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				East:  &east,
				North: &north,
				Up:    &up,
			},
		}
	}

	return entity
}

// statusReportToEntities converts a SAPIENT StatusReport into entity updates
// for the sensor entity and optionally a coverage entity from the field of view.
func statusReportToEntities(sr *sapientpb.StatusReport, sapientNodeID string) []*pb.Entity {
	entityID := fmt.Sprintf("sapient:%s", sapientNodeID)
	coverageID := entityID + ".coverage"

	entity := &pb.Entity{
		Id: entityID,
	}

	if loc := sr.GetNodeLocation(); loc != nil {
		entity.Geo = &pb.GeoSpatialComponent{
			Latitude:  loc.GetY(),
			Longitude: loc.GetX(),
		}
		if loc.Z != nil {
			alt := loc.GetZ()
			entity.Geo.Altitude = &alt
		}
	}

	if sr.GetSystem() == sapientpb.StatusReport_SYSTEM_ERROR {
		entity.Device = &pb.DeviceComponent{
			State: pb.DeviceState_DeviceStateFailed,
		}
	}

	if p := sr.GetPower(); p != nil && p.Level != nil {
		charge := float32(p.GetLevel()) / 100.0
		entity.Power = &pb.PowerComponent{
			BatteryChargeRemaining: &charge,
		}
	}

	entities := []*pb.Entity{entity}

	// Extract field of view → coverage circle entity
	if fov := sr.GetFieldOfView(); fov != nil {
		if rb := fov.GetRangeBearing(); rb != nil && rb.GetRange() > 0 && entity.Geo != nil {
			entity.Sensor = &pb.SensorComponent{
				Coverage: []string{coverageID},
			}
			entities = append(entities, &pb.Entity{
				Id: coverageID,
				Controller: &pb.Controller{
					Id: proto.String(controllerName),
				},
				Shape: &pb.GeoShapeComponent{
					Geometry: &pb.Geometry{
						Planar: &pb.PlanarGeometry{
							Plane: &pb.PlanarGeometry_Circle{
								Circle: &pb.PlanarCircle{
									Center: &pb.PlanarPoint{
										Latitude:  entity.Geo.Latitude,
										Longitude: entity.Geo.Longitude,
									},
									RadiusM: rb.GetRange(),
								},
							},
						},
					},
				},
			})
		}
	}

	return entities
}

// entityToDetection converts a hydris Entity (with Geo, Detection, etc.) to a
// SAPIENT DetectionReport for outbound client mode.
func entityToDetection(entity *pb.Entity) *sapientpb.DetectionReport {
	objectID := entity.Id
	det := &sapientpb.DetectionReport{
		ReportId: proto.String(fmt.Sprintf("%s-%d", entity.Id, time.Now().UnixMilli())),
		ObjectId: &objectID,
	}

	if geo := entity.Geo; geo != nil {
		det.LocationOneof = &sapientpb.DetectionReport_Location{
			Location: &sapientpb.Location{
				X:                &geo.Longitude,
				Y:                &geo.Latitude,
				CoordinateSystem: sapientpb.LocationCoordinateSystem_LOCATION_COORDINATE_SYSTEM_LAT_LNG_DEG_M.Enum(),
				Datum:            sapientpb.LocationDatum_LOCATION_DATUM_WGS84_E.Enum(),
			},
		}
		if geo.Altitude != nil {
			det.GetLocation().Z = geo.Altitude
		}
	}

	if kin := entity.Kinematics; kin != nil {
		if v := kin.VelocityEnu; v != nil {
			det.VelocityOneof = &sapientpb.DetectionReport_EnuVelocity{
				EnuVelocity: &sapientpb.ENUVelocity{
					EastRate:  v.East,
					NorthRate: v.North,
					UpRate:    v.Up,
				},
			}
		}
	}

	return det
}

// latLngToAzimuthRange computes bearing (degrees clockwise from north) and
// horizontal ground distance (meters) between two WGS84 points.
func latLngToAzimuthRange(lat1, lng1, lat2, lng2 float64) (azimuth, distance float64) {
	const earthR = 6371000.0 // meters
	lat1r := lat1 * math.Pi / 180.0
	lat2r := lat2 * math.Pi / 180.0
	dlat := (lat2 - lat1) * math.Pi / 180.0
	dlng := (lng2 - lng1) * math.Pi / 180.0

	// Haversine for distance
	a := math.Sin(dlat/2)*math.Sin(dlat/2) +
		math.Cos(lat1r)*math.Cos(lat2r)*math.Sin(dlng/2)*math.Sin(dlng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	distance = earthR * c

	// Forward azimuth
	y := math.Sin(dlng) * math.Cos(lat2r)
	x := math.Cos(lat1r)*math.Sin(lat2r) - math.Sin(lat1r)*math.Cos(lat2r)*math.Cos(dlng)
	azimuth = math.Atan2(y, x) * 180.0 / math.Pi
	if azimuth < 0 {
		azimuth += 360.0
	}
	return azimuth, distance
}

func classificationToBattleDimension(cls string) pb.ClassificationBattleDimension {
	switch cls {
	case "Air Vehicle", "UAV", "Aircraft":
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionAir
	case "Ground Vehicle", "Vehicle", "Person", "Human":
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionGround
	case "Surface Vessel", "Ship", "Boat":
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionSeaSurface
	default:
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionUnknown
	}
}
