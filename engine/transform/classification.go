package transform

import (
	milstd "github.com/aep/gomilstd2525c"
	"github.com/projectqai/hydris/engine/meta"
	pb "github.com/projectqai/proto/go"
)

// ClassificationTransformer derives classification data from MIL-STD-2525C
// symbol codes and vice versa.
//
// Forward: SIDC → ClassificationComponent (deprecated fields + taxonomy)
// Reverse: taxonomy → SymbolComponent (when no symbol exists)
type ClassificationTransformer struct{}

func NewClassificationTransformer() *ClassificationTransformer {
	return &ClassificationTransformer{}
}

func (ct *ClassificationTransformer) Validate(head map[string]*pb.Entity, incoming *pb.Entity) error {
	return nil
}

func (ct *ClassificationTransformer) Resolve(head map[string]*pb.Entity, changedID string, components map[int32]meta.Component) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]
	if entity == nil {
		return nil, nil
	}

	ct.forwardSIDCToClassification(entity, components)
	ct.reverseTaxonomyToSIDC(entity, components)

	return nil, nil
}

const symbolProtoNum int32 = 12

// forwardSIDCToClassification derives classification from SIDC.
func (ct *ClassificationTransformer) forwardSIDCToClassification(entity *pb.Entity, components map[int32]meta.Component) {
	if entity.Symbol == nil || entity.Symbol.MilStd2525C == "" {
		return
	}

	sidc, err := milstd.ParseSIDC(entity.Symbol.MilStd2525C)
	if err != nil {
		return
	}

	if entity.Classification == nil {
		entity.Classification = &pb.ClassificationComponent{}
	}
	cls := entity.Classification

	// Deprecated fields: only set if not already present
	if cls.Identity == nil && cls.Dimension == nil { //nolint:staticcheck
		identity := parseIdentity(byte(sidc.StandardIdentity[0]))
		dimension := parseDimension(byte(sidc.BattleDimension[0]))

		if identity != pb.ClassificationIdentity_ClassificationIdentityInvalid {
			cls.Identity = &identity //nolint:staticcheck
		}
		if dimension != pb.ClassificationBattleDimension_ClassificationBattleDimensionInvalid {
			cls.Dimension = &dimension //nolint:staticcheck
		}
	}

	// Taxonomy: only derive if not already present
	if len(cls.Taxonomy) == 0 {
		if tax := taxonomyFromSIDC(sidc); tax != nil {
			if sidc.StandardIdentity == milstd.StandardIdentityPending {
				tax.Confidence = &pb.ClassificationConfidence{Pending: true}
			}
			cls.Taxonomy = []*pb.ClassificationTaxonomy{tax}
		}
	}
}

// reverseTaxonomyToSIDC generates an SIDC from taxonomy when no externally-authored symbol exists.
func (ct *ClassificationTransformer) reverseTaxonomyToSIDC(entity *pb.Entity, components map[int32]meta.Component) {
	if entity.Symbol != nil {
		cm, authored := components[symbolProtoNum]
		if authored && !cm.Generated {
			return
		}
	}
	if entity.Classification == nil || len(entity.Classification.Taxonomy) == 0 {
		return
	}

	sidc := sidcFromTaxonomy(entity.Classification.Taxonomy[0])
	if sidc == nil {
		return
	}

	if id := entity.Classification.GetIdentity(); id != pb.ClassificationIdentity_ClassificationIdentityInvalid { //nolint:staticcheck
		sidc.StandardIdentity = identityToStandardIdentity(id)
	} else if entity.Device != nil {
		sidc.StandardIdentity = milstd.StandardIdentityFriend
	}

	entity.Symbol = &pb.SymbolComponent{MilStd2525C: sidc.String()}
}

// taxonomyFromSIDC maps a parsed SIDC to a ClassificationTaxonomy.
func taxonomyFromSIDC(sidc *milstd.SIDC) *pb.ClassificationTaxonomy {
	switch sidc.BattleDimension {
	case milstd.BattleDimensionAir:
		return taxonomyFromAirSIDC(sidc)
	case milstd.BattleDimensionGround:
		return taxonomyFromGroundSIDC(sidc)
	case milstd.BattleDimensionSeaSurface:
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Vehicle{
			Vehicle: &pb.VehicleTaxonomy{Domain: &pb.VehicleTaxonomy_Sea{Sea: &pb.VehicleTaxonomySea{}}},
		}}
	case milstd.BattleDimensionSubsurface:
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Vehicle{
			Vehicle: &pb.VehicleTaxonomy{Domain: &pb.VehicleTaxonomy_Subsurface{Subsurface: &pb.VehicleTaxonomySubsurface{}}},
		}}
	default:
		return nil
	}
}

func taxonomyFromAirSIDC(sidc *milstd.SIDC) *pb.ClassificationTaxonomy {
	v := &pb.VehicleTaxonomy{}
	air := &pb.VehicleTaxonomyAir{}

	fn := sidc.FunctionID
	if len(fn) >= 2 {
		switch {
		case fn[0] == 'M' && fn[1] == 'F':
			air.Kind = &pb.VehicleTaxonomyAir_FixedWing{FixedWing: &pb.VehicleTaxonomyAirFixedWing{}}
			if len(fn) >= 3 && fn[2] == 'Q' {
				v.Unmanned = &pb.VehicleTaxonomyUnmanned{}
			}
		case fn[0] == 'M' && fn[1] == 'H':
			air.Kind = &pb.VehicleTaxonomyAir_Rotary{Rotary: &pb.VehicleTaxonomyAirRotary{}}
			if len(fn) >= 3 && fn[2] == 'Q' {
				v.Unmanned = &pb.VehicleTaxonomyUnmanned{}
			}
		case fn[0] == 'M' && fn[1] == 'L':
			air.Kind = &pb.VehicleTaxonomyAir_LighterThanAir{LighterThanAir: &pb.VehicleTaxonomyAirLighterThanAir{}}
		}
	}

	v.Domain = &pb.VehicleTaxonomy_Air{Air: air}
	return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: v}}
}

func taxonomyFromGroundSIDC(sidc *milstd.SIDC) *pb.ClassificationTaxonomy {
	fn := sidc.FunctionID
	if len(fn) < 1 || fn[0] == '-' {
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Person{Person: &pb.PersonTaxonomy{}}}
	}

	switch fn[0] {
	case 'E':
		return taxonomyFromGroundEquipment(fn)
	case 'I':
		return taxonomyFromGroundInstallation(fn)
	case 'U':
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Person{Person: &pb.PersonTaxonomy{}}}
	default:
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Vehicle{
			Vehicle: &pb.VehicleTaxonomy{Domain: &pb.VehicleTaxonomy_Land{Land: &pb.VehicleTaxonomyLand{}}},
		}}
	}
}

func taxonomyFromGroundEquipment(fn string) *pb.ClassificationTaxonomy {
	if len(fn) < 2 || fn[1] == '-' {
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Equipment{
			Equipment: &pb.EquipmentTaxonomy{},
		}}
	}

	switch fn[1] {
	case 'V':
		land := &pb.VehicleTaxonomyLand{}
		if len(fn) >= 3 {
			switch fn[2] {
			case 'A', 'T':
				land.Kind = &pb.VehicleTaxonomyLand_Tracked{Tracked: &pb.VehicleTaxonomyTracked{}}
			case 'C':
				land.Kind = &pb.VehicleTaxonomyLand_MultiWheeled{MultiWheeled: &pb.VehicleTaxonomyMultiWheeled{}}
			}
		}
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Vehicle{
			Vehicle: &pb.VehicleTaxonomy{Domain: &pb.VehicleTaxonomy_Land{Land: land}},
		}}
	case 'S':
		sensor := &pb.EquipmentTaxonomySensor{}
		if len(fn) >= 3 {
			switch fn[2] {
			case 'R':
				sensor.Kind = &pb.EquipmentTaxonomySensor_Radar{Radar: &pb.EquipmentTaxonomySensorRadar{}}
			case 'E':
				sensor.Emplaced = &pb.EquipmentTaxonomySensorEmplaced{}
			}
		}
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Equipment{
			Equipment: &pb.EquipmentTaxonomy{Sensor: sensor},
		}}
	case 'W':
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Equipment{
			Equipment: &pb.EquipmentTaxonomy{Sensor: &pb.EquipmentTaxonomySensor{
				Kind: &pb.EquipmentTaxonomySensor_Ew{Ew: &pb.EquipmentTaxonomySensorEW{}},
			}},
		}}
	case 'X':
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Equipment{
			Equipment: &pb.EquipmentTaxonomy{Sensor: &pb.EquipmentTaxonomySensor{
				Kind: &pb.EquipmentTaxonomySensor_Cbrn{Cbrn: &pb.EquipmentTaxonomySensorCBRN{}},
			}},
		}}
	default:
		return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Equipment{
			Equipment: &pb.EquipmentTaxonomy{},
		}}
	}
}

func taxonomyFromGroundInstallation(fn string) *pb.ClassificationTaxonomy {
	infra := &pb.InfrastructureTaxonomy{}
	if len(fn) >= 2 {
		switch fn[1] {
		case 'T':
			infra.Tower = &pb.InfrastructureTaxonomyTower{}
		case 'R':
			infra.Road = &pb.InfrastructureTaxonomyRoad{}
		}
	}
	return &pb.ClassificationTaxonomy{Kind: &pb.ClassificationTaxonomy_Infrastructure{
		Infrastructure: infra,
	}}
}

// sidcFromTaxonomy generates an SIDC from a taxonomy entry.
func sidcFromTaxonomy(tax *pb.ClassificationTaxonomy) *milstd.SIDC {
	identity := milstd.StandardIdentityUnknown
	if tax.Confidence != nil && tax.Confidence.Pending {
		identity = milstd.StandardIdentityPending
	}

	sidc := &milstd.SIDC{
		CodingScheme:     milstd.CodingSchemeWarfighting,
		StandardIdentity: identity,
		Status:           milstd.StatusPresent,
		FunctionID:       "------",
		Modifier:         "*****",
	}

	switch k := tax.Kind.(type) {
	case *pb.ClassificationTaxonomy_Person:
		sidc.BattleDimension = milstd.BattleDimensionGround
		sidc.FunctionID = "U-----"
	case *pb.ClassificationTaxonomy_Animal:
		sidc.BattleDimension = milstd.BattleDimensionGround
		sidc.FunctionID = milstd.FunctionGrdtrkEqtGrdvehPkan
	case *pb.ClassificationTaxonomy_Infrastructure:
		sidc.BattleDimension = milstd.BattleDimensionGround
		sidc.FunctionID = sidcFunctionFromInfrastructure(k.Infrastructure)
	case *pb.ClassificationTaxonomy_Vehicle:
		if k.Vehicle != nil {
			sidcFromVehicleTaxonomy(sidc, k.Vehicle)
		} else {
			sidc.BattleDimension = milstd.BattleDimensionGround
			sidc.FunctionID = milstd.FunctionGrdtrkEqtGrdveh
		}
	case *pb.ClassificationTaxonomy_Equipment:
		sidc.BattleDimension = milstd.BattleDimensionGround
		sidc.FunctionID = sidcFunctionFromEquipment(k.Equipment)
	case *pb.ClassificationTaxonomy_Emitter:
		sidc.BattleDimension = milstd.BattleDimensionGround
		sidc.FunctionID = milstd.FunctionGrdtrkEqtSns
	default:
		return nil
	}

	return sidc
}

func sidcFromVehicleTaxonomy(sidc *milstd.SIDC, v *pb.VehicleTaxonomy) {
	switch d := v.Domain.(type) {
	case *pb.VehicleTaxonomy_Air:
		sidc.BattleDimension = milstd.BattleDimensionAir
		sidc.FunctionID = sidcFunctionFromAirVehicle(v, d.Air)
	case *pb.VehicleTaxonomy_Land:
		sidc.BattleDimension = milstd.BattleDimensionGround
		sidc.FunctionID = sidcFunctionFromLandVehicle(d.Land)
	case *pb.VehicleTaxonomy_Sea:
		sidc.BattleDimension = milstd.BattleDimensionSeaSurface
	case *pb.VehicleTaxonomy_Subsurface:
		sidc.BattleDimension = milstd.BattleDimensionSubsurface
	default:
		sidc.BattleDimension = milstd.BattleDimensionGround
		sidc.FunctionID = milstd.FunctionGrdtrkEqtGrdveh
	}
}

func sidcFunctionFromAirVehicle(v *pb.VehicleTaxonomy, air *pb.VehicleTaxonomyAir) string {
	if air == nil {
		if v.Unmanned != nil {
			return milstd.FunctionAirtrkMilFixdDrn
		}
		return milstd.FunctionAirtrkMilFixd
	}

	switch air.Kind.(type) {
	case *pb.VehicleTaxonomyAir_FixedWing:
		if v.Unmanned != nil {
			return milstd.FunctionAirtrkMilFixdDrn
		}
		return milstd.FunctionAirtrkMilFixd
	case *pb.VehicleTaxonomyAir_Rotary:
		if v.Unmanned != nil {
			return milstd.FunctionAirtrkMilRotDrn
		}
		return milstd.FunctionAirtrkMilRot
	case *pb.VehicleTaxonomyAir_LighterThanAir:
		return milstd.FunctionAirtrkMilLta
	default:
		if v.Unmanned != nil {
			return milstd.FunctionAirtrkMilFixdDrn
		}
		return milstd.FunctionAirtrkMilFixd
	}
}

func sidcFunctionFromLandVehicle(land *pb.VehicleTaxonomyLand) string {
	if land == nil {
		return milstd.FunctionGrdtrkEqtGrdveh
	}
	switch land.Kind.(type) {
	case *pb.VehicleTaxonomyLand_Tracked:
		return milstd.FunctionGrdtrkEqtGrdvehArmd
	case *pb.VehicleTaxonomyLand_TwoWheeled:
		return milstd.FunctionGrdtrkEqtGrdveh
	case *pb.VehicleTaxonomyLand_MultiWheeled:
		return milstd.FunctionGrdtrkEqtGrdvehCvlveh
	default:
		return milstd.FunctionGrdtrkEqtGrdveh
	}
}

func sidcFunctionFromInfrastructure(infra *pb.InfrastructureTaxonomy) string {
	if infra == nil {
		return "I-----"
	}
	if infra.Tower != nil {
		return "IT----"
	}
	if infra.Bridge != nil {
		return "IB----"
	}
	if infra.Road != nil {
		return "IR----"
	}
	if infra.Dam != nil {
		return "ID----"
	}
	return "I-----"
}

func sidcFunctionFromEquipment(eq *pb.EquipmentTaxonomy) string {
	if eq == nil || eq.Sensor == nil {
		return milstd.FunctionGrdtrkEqtSns
	}
	switch eq.Sensor.Kind.(type) {
	case *pb.EquipmentTaxonomySensor_Radar:
		return milstd.FunctionGrdtrkEqtSnsRad
	case *pb.EquipmentTaxonomySensor_Ew:
		return milstd.FunctionGrdtrkEqtSns
	case *pb.EquipmentTaxonomySensor_Cbrn:
		return milstd.FunctionGrdtrkEqtSplCbrneq
	case *pb.EquipmentTaxonomySensor_Acoustic:
		return milstd.FunctionGrdtrkEqtSnsEmp
	case *pb.EquipmentTaxonomySensor_ElectroOptical:
		return milstd.FunctionGrdtrkEqtSnsEmp
	default:
		if eq.Sensor.Emplaced != nil {
			return milstd.FunctionGrdtrkEqtSnsEmp
		}
		return milstd.FunctionGrdtrkEqtSns
	}
}

func identityToStandardIdentity(id pb.ClassificationIdentity) milstd.StandardIdentity {
	switch id {
	case pb.ClassificationIdentity_ClassificationIdentityFriend:
		return milstd.StandardIdentityFriend
	case pb.ClassificationIdentity_ClassificationIdentityHostile:
		return milstd.StandardIdentityHostile
	case pb.ClassificationIdentity_ClassificationIdentityNeutral:
		return milstd.StandardIdentityNeutral
	case pb.ClassificationIdentity_ClassificationIdentitySuspect:
		return milstd.StandardIdentitySuspect
	case pb.ClassificationIdentity_ClassificationIdentityPending:
		return milstd.StandardIdentityPending
	default:
		return milstd.StandardIdentityUnknown
	}
}

func parseIdentity(c byte) pb.ClassificationIdentity {
	switch c {
	case 'P':
		return pb.ClassificationIdentity_ClassificationIdentityPending
	case 'U':
		return pb.ClassificationIdentity_ClassificationIdentityUnknown
	case 'F', 'A':
		return pb.ClassificationIdentity_ClassificationIdentityFriend
	case 'N':
		return pb.ClassificationIdentity_ClassificationIdentityNeutral
	case 'H', 'J':
		return pb.ClassificationIdentity_ClassificationIdentityHostile
	case 'S', 'K':
		return pb.ClassificationIdentity_ClassificationIdentitySuspect
	default:
		return pb.ClassificationIdentity_ClassificationIdentityInvalid
	}
}

func parseDimension(c byte) pb.ClassificationBattleDimension {
	switch c {
	case 'Z':
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionUnknown
	case 'P':
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionSpace
	case 'A':
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionAir
	case 'G':
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionGround
	case 'S':
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionSeaSurface
	case 'U':
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionSubsurface
	default:
		return pb.ClassificationBattleDimension_ClassificationBattleDimensionInvalid
	}
}
