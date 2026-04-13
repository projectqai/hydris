package sapient

import (
	"strings"

	milstd "github.com/aep/gomilstd2525c"
	sapientpb "github.com/aep/gosapient/pkg/sapientpb"
)

// nodeTypeToSIDC maps SAPIENT BSI Flex 335 v2.0 node types to MIL-STD-2525C symbols.
var nodeTypeToSIDC = map[sapientpb.Registration_NodeType]string{
	// -- Unspecified / Other --
	sapientpb.Registration_NODE_TYPE_UNSPECIFIED: sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSns),
	sapientpb.Registration_NODE_TYPE_OTHER:       sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSns),

	// -- Sensors --
	sapientpb.Registration_NODE_TYPE_RADAR:            sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSnsRad),
	sapientpb.Registration_NODE_TYPE_LIDAR:            sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSnsRad),
	sapientpb.Registration_NODE_TYPE_CAMERA:           sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSnsEmp),
	sapientpb.Registration_NODE_TYPE_SEISMIC:          sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSnsEmp),
	sapientpb.Registration_NODE_TYPE_ACOUSTIC:         sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSnsEmp),
	sapientpb.Registration_NODE_TYPE_PROXIMITY_SENSOR: sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSnsEmp),
	sapientpb.Registration_NODE_TYPE_PASSIVE_RF:       sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSns),
	sapientpb.Registration_NODE_TYPE_HUMAN:            sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSns),
	sapientpb.Registration_NODE_TYPE_CHEMICAL:         sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSplCbrneq),
	sapientpb.Registration_NODE_TYPE_BIOLOGICAL:       sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSplCbrneq),
	sapientpb.Registration_NODE_TYPE_RADIATION:        sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSplCbrneq),

	// -- Effectors --
	sapientpb.Registration_NODE_TYPE_KINETIC: sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtWpnAdfg),
	sapientpb.Registration_NODE_TYPE_JAMMER:  sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSns),
	sapientpb.Registration_NODE_TYPE_CYBER:   sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSns),
	sapientpb.Registration_NODE_TYPE_LDEW:    sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtWpnAdfg),
	sapientpb.Registration_NODE_TYPE_RFDEW:   sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtWpnAdfg),

	// -- Platform / Fusion --
	sapientpb.Registration_NODE_TYPE_MOBILE_NODE:    sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtGrdveh),
	sapientpb.Registration_NODE_TYPE_POINTABLE_NODE: sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSnsEmp),
	sapientpb.Registration_NODE_TYPE_FUSION_NODE:    sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkUntC2hq),
}

// classificationRules maps SAPIENT detection classification strings to symbols.
// Checked in order; more specific patterns come first. Matching is case-insensitive
// substring so e.g. "UAV Rotary Wing" matches "rotary", "Land vehicle" matches "vehicle".
var classificationRules = []struct {
	pattern string
	sidc    string
}{
	// Air — specific first
	{"rotary wing", sidc(milstd.BattleDimensionAir, milstd.FunctionAirtrkMilRotDrn)},
	{"fixed wing", sidc(milstd.BattleDimensionAir, milstd.FunctionAirtrkMilFixdDrn)},
	{"helicopter", sidc(milstd.BattleDimensionAir, milstd.FunctionAirtrkMilRot)},
	{"uav", sidc(milstd.BattleDimensionAir, milstd.FunctionAirtrkMilFixdDrn)},
	{"drone", sidc(milstd.BattleDimensionAir, milstd.FunctionAirtrkMilFixdDrn)},
	{"air vehicle", sidc(milstd.BattleDimensionAir, milstd.FunctionAirtrkMilFixdDrn)},
	{"aircraft", sidc(milstd.BattleDimensionAir, milstd.FunctionAirtrkMilFixd)},

	// Ground — people
	{"human", sidcIdentity(milstd.BattleDimensionGround, "------", milstd.StandardIdentityUnknown)},
	{"person", sidcIdentity(milstd.BattleDimensionGround, "------", milstd.StandardIdentityUnknown)},
	{"male", sidcIdentity(milstd.BattleDimensionGround, "------", milstd.StandardIdentityUnknown)},
	{"female", sidcIdentity(milstd.BattleDimensionGround, "------", milstd.StandardIdentityUnknown)},

	// Ground — animals
	{"bird", "EPNPCA---------"},
	{"animal", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtGrdvehPkan)},

	// Ground — weapons / equipment
	{"bomb", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSplIed)},
	{"ied", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSplIed)},
	{"explosive", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSplIed)},
	{"mine", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtSplLndmne)},
	{"weapon", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtWpn)},
	{"equipment", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtGrdveh)},

	// Ground — vehicles
	{"land vehicle", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtGrdveh)},
	{"ground vehicle", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtGrdveh)},
	{"vehicle", sidc(milstd.BattleDimensionGround, milstd.FunctionGrdtrkEqtGrdveh)},

	// Sea
	{"vessel", sidc(milstd.BattleDimensionSeaSurface, "------")},
	{"ship", sidc(milstd.BattleDimensionSeaSurface, "------")},
	{"boat", sidc(milstd.BattleDimensionSeaSurface, "------")},
}

// matchClassificationSIDC returns the best SIDC for a classification type string,
// or empty string if nothing matches.
func matchClassificationSIDC(cls string) string {
	lower := strings.ToLower(cls)
	for _, rule := range classificationRules {
		if strings.Contains(lower, rule.pattern) {
			return rule.sidc
		}
	}
	return ""
}

// defaultDetectionSIDC is the symbol for detections with no/unknown classification.
var defaultDetectionSIDC = sidcIdentity(milstd.BattleDimensionUnknown, "------", milstd.StandardIdentityUnknown)

func sidcIdentity(dim milstd.BattleDimension, function string, identity milstd.StandardIdentity) string {
	return (&milstd.SIDC{
		CodingScheme:     milstd.CodingSchemeWarfighting,
		StandardIdentity: identity,
		BattleDimension:  dim,
		Status:           milstd.StatusPresent,
		FunctionID:       function,
		Modifier:         "*****",
	}).String()
}

func sidc(dim milstd.BattleDimension, function string) string {
	return (&milstd.SIDC{
		CodingScheme:     milstd.CodingSchemeWarfighting,
		StandardIdentity: milstd.StandardIdentityFriend,
		BattleDimension:  dim,
		Status:           milstd.StatusPresent,
		FunctionID:       function,
		Modifier:         "*****",
	}).String()
}
