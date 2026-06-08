package playground

import (
	"math"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const simcamServiceID = "simcam.service"

func shipCameraConfig() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"instant_slew": true,
	})
	return s
}

func demoShip() []*pb.Entity {
	shipID := "playground.ship"
	hullID := shipID + ".hull"
	bowCamID := shipID + ".camera.bow"
	radarID := shipID + ".radar"
	radarCoverageID := radarID + ".coverage"
	sternCamID := shipID + ".camera.stern"

	headingDeg := 30.0
	headingRad := headingDeg * math.Pi / 180.0
	halfRad := headingRad / 2.0

	return []*pb.Entity{
		{
			Id:      shipID,
			Label:   proto.String("MV Demo Vessel"),
			Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
			Device: &pb.DeviceComponent{
				Parent: proto.String(controllerName + ".service"),
				State:  pb.DeviceState_DeviceStateActive,
			},
			Geo: &pb.GeoSpatialComponent{
				Latitude:  51.95,
				Longitude: 4.05,
				Altitude:  proto.Float64(0),
			},
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFSPXM----*****"},
			Orientation: &pb.OrientationComponent{
				Orientation: &pb.Quaternion{
					X: 0, Y: 0,
					Z: math.Sin(halfRad),
					W: math.Cos(halfRad),
				},
			},
			Kinematics: &pb.KinematicsComponent{
				VelocityEnu: &pb.KinematicsEnu{
					East:  proto.Float64(3.0 * math.Sin(headingRad)),
					North: proto.Float64(3.0 * math.Cos(headingRad)),
				},
			},
			Assembly: &pb.AssemblyComponent{
				Outline: []string{hullID},
			},
			Classification: &pb.ClassificationComponent{
				Identity: pb.ClassificationIdentity_ClassificationIdentityFriend.Enum(), //nolint:staticcheck
				Taxonomy: []*pb.ClassificationTaxonomy{{
					Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
						Domain: &pb.VehicleTaxonomy_Sea{Sea: &pb.VehicleTaxonomySea{}},
					}},
				}},
			},
			Bounds: &pb.BoundsComponent{
				WidthM:  32,
				HeightM: 200,
				DepthM:  12,
			},
		},

		// Hull outline — 200 m vessel in local ENU (north = forward)
		{
			Id: hullID,
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: shipID,
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Polygon{
						Polygon: &pb.LocalPolygon{
							Outer: &pb.LocalRing{
								Points: []*pb.LocalPoint{
									{EastM: 0, NorthM: 100},
									{EastM: 12, NorthM: 85},
									{EastM: 16, NorthM: 50},
									{EastM: 16, NorthM: -70},
									{EastM: 14, NorthM: -95},
									{EastM: -14, NorthM: -95},
									{EastM: -16, NorthM: -70},
									{EastM: -16, NorthM: 50},
									{EastM: -12, NorthM: 85},
									{EastM: 0, NorthM: 100},
								},
							},
						},
					},
				},
			},
		},

		// Bow camera — forward-looking, picked up by simcam
		{
			Id:      bowCamID,
			Label:   proto.String("Bow Camera"),
			Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Parent: proto.String(simcamServiceID),
				Class:  proto.String("camera"),
				State:  pb.DeviceState_DeviceStateActive,
			},
			Config: &pb.ConfigurationComponent{
				Value: shipCameraConfig(),
			},
			Assembly: &pb.AssemblyComponent{Parent: proto.String(shipID)},
			Pose: &pb.PoseComponent{
				Parent: shipID,
				Offset: &pb.PoseComponent_Cartesian{
					Cartesian: &pb.CartesianOffset{
						NorthM: 90,
						UpM:    proto.Float64(15),
					},
				},
			},
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{{
					Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
						Sensor: &pb.EquipmentTaxonomySensor{
							Kind: &pb.EquipmentTaxonomySensor_ElectroOptical{
								ElectroOptical: &pb.EquipmentTaxonomySensorElectroOptical{},
							},
						},
					}},
				}},
			},
			Camera: &pb.CameraComponent{
				Fov:      proto.Float64(60),
				RangeMax: proto.Float64(5000),
			},
		},

		// Navigation radar — center mast
		{
			Id:      radarID,
			Label:   proto.String("Navigation Radar"),
			Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
			Device: &pb.DeviceComponent{
				Parent: proto.String(shipID),
				State:  pb.DeviceState_DeviceStateActive,
			},
			Assembly: &pb.AssemblyComponent{Parent: proto.String(shipID)},
			Pose: &pb.PoseComponent{
				Parent: shipID,
				Offset: &pb.PoseComponent_Cartesian{
					Cartesian: &pb.CartesianOffset{
						UpM: proto.Float64(25),
					},
				},
			},
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{{
					Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
						Sensor: &pb.EquipmentTaxonomySensor{
							Kind: &pb.EquipmentTaxonomySensor_Radar{
								Radar: &pb.EquipmentTaxonomySensorRadar{},
							},
						},
					}},
				}},
			},
			Sensor: &pb.SensorComponent{
				Coverage: []string{radarCoverageID},
			},
		},

		// Radar coverage — 20 km circle
		{
			Id: radarCoverageID,
			LocalShape: &pb.LocalShapeComponent{
				RelativeTo: shipID,
				Geometry: &pb.LocalGeometry{
					Shape: &pb.LocalGeometry_Circle{
						Circle: &pb.LocalCircle{
							Center:  &pb.LocalPoint{},
							RadiusM: 20000,
						},
					},
				},
			},
		},

		// Stern camera — aft-facing, picked up by simcam
		{
			Id:      sternCamID,
			Label:   proto.String("Stern Camera"),
			Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Parent: proto.String(simcamServiceID),
				Class:  proto.String("camera"),
				State:  pb.DeviceState_DeviceStateActive,
			},
			Config: &pb.ConfigurationComponent{
				Value: shipCameraConfig(),
			},
			Assembly: &pb.AssemblyComponent{Parent: proto.String(shipID)},
			Pose: &pb.PoseComponent{
				Parent: shipID,
				Offset: &pb.PoseComponent_Cartesian{
					Cartesian: &pb.CartesianOffset{
						NorthM: -85,
						UpM:    proto.Float64(10),
					},
				},
			},
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{{
					Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
						Sensor: &pb.EquipmentTaxonomySensor{
							Kind: &pb.EquipmentTaxonomySensor_ElectroOptical{
								ElectroOptical: &pb.EquipmentTaxonomySensorElectroOptical{},
							},
						},
					}},
				}},
			},
			Camera: &pb.CameraComponent{
				Fov:      proto.Float64(90),
				RangeMax: proto.Float64(3000),
			},
		},
	}
}
