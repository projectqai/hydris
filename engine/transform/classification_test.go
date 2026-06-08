package transform

import (
	"testing"

	"github.com/projectqai/hydris/engine/meta"
	pb "github.com/projectqai/proto/go"
)

func TestClassification_ParsesFriendGround(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGP-----------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil {
		t.Fatal("expected ClassificationComponent")
	}
	if cls.Identity == nil || *cls.Identity != pb.ClassificationIdentity_ClassificationIdentityFriend { //nolint:staticcheck
		t.Errorf("expected Friend, got %v", cls.Identity) //nolint:staticcheck
	}
	if cls.Dimension == nil || *cls.Dimension != pb.ClassificationBattleDimension_ClassificationBattleDimensionGround { //nolint:staticcheck
		t.Errorf("expected Ground, got %v", cls.Dimension) //nolint:staticcheck
	}
	if len(cls.Taxonomy) != 1 {
		t.Fatalf("expected 1 taxonomy entry, got %d", len(cls.Taxonomy))
	}
	if cls.Taxonomy[0].GetPerson() == nil {
		t.Error("expected person taxonomy for bare ground track")
	}
	if cls.Taxonomy[0].Confidence != nil {
		t.Error("friend affiliation should not set suspected")
	}
}

func TestClassification_ParsesHostileAirFixedWing(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SHAPMF---------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil {
		t.Fatal("expected ClassificationComponent")
	}
	if cls.Identity == nil || *cls.Identity != pb.ClassificationIdentity_ClassificationIdentityHostile { //nolint:staticcheck
		t.Errorf("expected Hostile, got %v", cls.Identity) //nolint:staticcheck
	}
	if len(cls.Taxonomy) != 1 {
		t.Fatalf("expected 1 taxonomy entry, got %d", len(cls.Taxonomy))
	}
	v := cls.Taxonomy[0].GetVehicle()
	if v == nil {
		t.Fatal("expected vehicle taxonomy")
	}
	if v.GetAir() == nil {
		t.Fatal("expected air domain")
	}
	if v.GetAir().GetFixedWing() == nil {
		t.Error("expected fixed wing from MF function ID")
	}
}

func TestClassification_AirDroneRotary(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFAPMHQ--------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	v := cls.Taxonomy[0].GetVehicle()
	if v == nil {
		t.Fatal("expected vehicle")
	}
	if v.Unmanned == nil {
		t.Error("expected unmanned for MHQ")
	}
	if v.GetAir() == nil || v.GetAir().GetRotary() == nil {
		t.Error("expected rotary wing")
	}
}

func TestClassification_AirLighterThanAir(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFAPML---------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	v := cls.Taxonomy[0].GetVehicle()
	if v == nil {
		t.Fatal("expected vehicle")
	}
	if v.GetAir() == nil || v.GetAir().GetLighterThanAir() == nil {
		t.Error("expected lighter than air")
	}
}

func TestClassification_GroundVehicleArmored(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPEVA--------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	v := cls.Taxonomy[0].GetVehicle()
	if v == nil {
		t.Fatal("expected vehicle")
	}
	if v.GetLand() == nil {
		t.Fatal("expected land domain")
	}
	if v.GetLand().GetTracked() == nil {
		t.Error("expected tracked for EVA (armored)")
	}
}

func TestClassification_GroundVehicleCivilian(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPEVC--------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	v := cls.Taxonomy[0].GetVehicle()
	if v == nil {
		t.Fatal("expected vehicle")
	}
	if v.GetLand() == nil {
		t.Fatal("expected land domain")
	}
	if v.GetLand().GetMultiWheeled() == nil {
		t.Error("expected multi-wheeled for EVC (civilian)")
	}
}

func TestClassification_GroundSensorRadar(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPESR--------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	eq := cls.Taxonomy[0].GetEquipment()
	if eq == nil {
		t.Fatal("expected equipment taxonomy")
	}
	if eq.Sensor == nil {
		t.Fatal("expected sensor")
	}
	if eq.Sensor.GetRadar() == nil {
		t.Error("expected radar sensor for ESR")
	}
}

func TestClassification_GroundSensorEmplaced(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPESE--------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	eq := cls.Taxonomy[0].GetEquipment()
	if eq == nil {
		t.Fatal("expected equipment taxonomy")
	}
	if eq.Sensor == nil || eq.Sensor.Emplaced == nil {
		t.Error("expected emplaced sensor for ESE")
	}
}

func TestClassification_GroundEW(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPEW---------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	eq := cls.Taxonomy[0].GetEquipment()
	if eq == nil {
		t.Fatal("expected equipment taxonomy")
	}
	if eq.Sensor == nil || eq.Sensor.GetEw() == nil {
		t.Error("expected EW sensor for EW function")
	}
}

func TestClassification_GroundCBRN(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPEX---------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	eq := cls.Taxonomy[0].GetEquipment()
	if eq == nil {
		t.Fatal("expected equipment taxonomy")
	}
	if eq.Sensor == nil || eq.Sensor.GetCbrn() == nil {
		t.Error("expected CBRN sensor for EX function")
	}
}

func TestClassification_GroundInstallationTower(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPIT---------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	infra := cls.Taxonomy[0].GetInfrastructure()
	if infra == nil {
		t.Fatal("expected infrastructure taxonomy")
	}
	if infra.Tower == nil {
		t.Error("expected tower for IT")
	}
}

func TestClassification_GroundUnit(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGPUC---------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	if cls.Taxonomy[0].GetPerson() == nil {
		t.Error("expected person taxonomy for ground unit")
	}
}

func TestClassification_SeaSurface(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SUSP------*****"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	v := cls.Taxonomy[0].GetVehicle()
	if v == nil {
		t.Fatal("expected vehicle")
	}
	if v.GetSea() == nil {
		t.Error("expected sea domain")
	}
}

func TestClassification_Subsurface(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SHUP------*****"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	v := cls.Taxonomy[0].GetVehicle()
	if v == nil {
		t.Fatal("expected vehicle")
	}
	if v.GetSubsurface() == nil {
		t.Error("expected subsurface domain")
	}
}

func TestClassification_PendingSetsPending(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SPAPMF---------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	conf := cls.Taxonomy[0].Confidence
	if conf == nil {
		t.Fatal("expected confidence on pending")
	}
	if !conf.Pending {
		t.Error("expected pending=true for affiliation P")
	}
}

func TestClassification_FriendDoesNotSetSuspected(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFAPMF---------"},
		},
	}

	ct.Resolve(head, "e1", nil)

	cls := head["e1"].Classification
	if cls == nil || len(cls.Taxonomy) == 0 {
		t.Fatal("expected taxonomy")
	}
	if cls.Taxonomy[0].Confidence != nil {
		t.Error("friend should not set confidence/suspected")
	}
}

func TestClassification_SkipsWhenTaxonomyExists(t *testing.T) {
	ct := NewClassificationTransformer()
	existing := []*pb.ClassificationTaxonomy{
		{Kind: &pb.ClassificationTaxonomy_Emitter{Emitter: &pb.EmitterTaxonomy{}}},
	}
	head := map[string]*pb.Entity{
		"e1": {
			Id:             "e1",
			Symbol:         &pb.SymbolComponent{MilStd2525C: "SHGP------*****"},
			Classification: &pb.ClassificationComponent{Taxonomy: existing},
		},
	}

	ct.Resolve(head, "e1", nil)

	if head["e1"].Classification.Taxonomy[0].GetEmitter() == nil {
		t.Error("should not override existing taxonomy")
	}
}

func TestClassification_SkipsWithoutSymbol(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {Id: "e1"},
	}

	ct.Resolve(head, "e1", nil)

	if head["e1"].Classification != nil {
		t.Error("should not create classification without symbol or taxonomy")
	}
}

func TestClassification_SkipsShortSIDC(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "S"},
		},
	}

	ct.Resolve(head, "e1", nil)

	if head["e1"].Classification != nil {
		t.Error("should not create classification from too-short SIDC")
	}
}

func TestClassification_SkipsExpiredEntity(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{}

	upsert, remove := ct.Resolve(head, "gone", nil)
	if len(upsert) != 0 || len(remove) != 0 {
		t.Error("should return nothing for expired entity")
	}
}

func TestClassification_ReversePerson(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{Kind: &pb.ClassificationTaxonomy_Person{Person: &pb.PersonTaxonomy{}}},
				},
			},
		},
	}

	ct.Resolve(head, "e1", nil)

	sym := head["e1"].Symbol
	if sym == nil {
		t.Fatal("expected symbol to be generated")
	}
	if len(sym.MilStd2525C) != 15 {
		t.Fatalf("expected 15-char SIDC, got %q", sym.MilStd2525C)
	}
	if sym.MilStd2525C[2] != 'G' {
		t.Errorf("expected ground dimension for person, got %c", sym.MilStd2525C[2])
	}
}

func TestClassification_ReverseAnimal(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{Kind: &pb.ClassificationTaxonomy_Animal{Animal: &pb.AnimalTaxonomy{}}},
				},
			},
		},
	}

	ct.Resolve(head, "e1", nil)

	sym := head["e1"].Symbol
	if sym == nil {
		t.Fatal("expected symbol to be generated")
	}
	if sym.MilStd2525C[2] != 'G' {
		t.Errorf("expected ground dimension for animal, got %c", sym.MilStd2525C[2])
	}
}

func TestClassification_ReverseVehicleAirDrone(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
						Unmanned: &pb.VehicleTaxonomyUnmanned{},
						Domain:   &pb.VehicleTaxonomy_Air{Air: &pb.VehicleTaxonomyAir{Kind: &pb.VehicleTaxonomyAir_Rotary{Rotary: &pb.VehicleTaxonomyAirRotary{}}}},
					}}},
				},
			},
		},
	}

	ct.Resolve(head, "e1", nil)

	sym := head["e1"].Symbol
	if sym == nil {
		t.Fatal("expected symbol to be generated")
	}
	if sym.MilStd2525C[1] != 'U' {
		t.Errorf("expected unknown identity, got %c", sym.MilStd2525C[1])
	}
	if sym.MilStd2525C[2] != 'A' {
		t.Errorf("expected air dimension, got %c", sym.MilStd2525C[2])
	}
	fn := sym.MilStd2525C[4:10]
	if fn != "MHQ---" {
		t.Errorf("expected MHQ--- function for rotary drone, got %q", fn)
	}
}

func TestClassification_ReverseVehiclePending(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{
						Confidence: &pb.ClassificationConfidence{Pending: true},
						Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
							Domain: &pb.VehicleTaxonomy_Air{Air: &pb.VehicleTaxonomyAir{Kind: &pb.VehicleTaxonomyAir_FixedWing{FixedWing: &pb.VehicleTaxonomyAirFixedWing{}}}},
						}},
					},
				},
			},
		},
	}

	ct.Resolve(head, "e1", nil)

	sym := head["e1"].Symbol
	if sym == nil {
		t.Fatal("expected symbol to be generated")
	}
	if sym.MilStd2525C[1] != 'P' {
		t.Errorf("expected pending identity (P) for pending taxonomy, got %c", sym.MilStd2525C[1])
	}
}

func TestClassification_ReverseVehicleSea(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
						Domain: &pb.VehicleTaxonomy_Sea{Sea: &pb.VehicleTaxonomySea{}},
					}}},
				},
			},
		},
	}

	ct.Resolve(head, "e1", nil)

	sym := head["e1"].Symbol
	if sym == nil {
		t.Fatal("expected symbol to be generated")
	}
	if sym.MilStd2525C[2] != 'S' {
		t.Errorf("expected sea dimension, got %c", sym.MilStd2525C[2])
	}
}

func TestClassification_ReverseEquipmentRadar(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{Kind: &pb.ClassificationTaxonomy_Equipment{Equipment: &pb.EquipmentTaxonomy{
						Sensor: &pb.EquipmentTaxonomySensor{
							Kind: &pb.EquipmentTaxonomySensor_Radar{Radar: &pb.EquipmentTaxonomySensorRadar{}},
						},
					}}},
				},
			},
		},
	}

	ct.Resolve(head, "e1", nil)

	sym := head["e1"].Symbol
	if sym == nil {
		t.Fatal("expected symbol to be generated")
	}
	if sym.MilStd2525C[2] != 'G' {
		t.Errorf("expected ground dimension for equipment, got %c", sym.MilStd2525C[2])
	}
}

func TestClassification_ReverseInfrastructureBridge(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{Kind: &pb.ClassificationTaxonomy_Infrastructure{Infrastructure: &pb.InfrastructureTaxonomy{
						Bridge: &pb.InfrastructureTaxonomyBridge{},
					}}},
				},
			},
		},
	}

	ct.Resolve(head, "e1", nil)

	sym := head["e1"].Symbol
	if sym == nil {
		t.Fatal("expected symbol to be generated")
	}
	if sym.MilStd2525C[2] != 'G' {
		t.Errorf("expected ground dimension for infrastructure, got %c", sym.MilStd2525C[2])
	}
}

func TestClassification_ReverseEmitter(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id: "e1",
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{Kind: &pb.ClassificationTaxonomy_Emitter{Emitter: &pb.EmitterTaxonomy{}}},
				},
			},
		},
	}

	ct.Resolve(head, "e1", nil)

	sym := head["e1"].Symbol
	if sym == nil {
		t.Fatal("expected symbol to be generated")
	}
	if sym.MilStd2525C[2] != 'G' {
		t.Errorf("expected ground dimension for emitter, got %c", sym.MilStd2525C[2])
	}
}

func TestClassification_ReverseSkipsWhenSymbolAuthored(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGP------*****"},
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
						Domain: &pb.VehicleTaxonomy_Sea{Sea: &pb.VehicleTaxonomySea{}},
					}}},
				},
			},
		},
	}

	// Symbol was externally authored (has a lifetime entry, not generated)
	authored := map[int32]meta.Component{
		12: {},
	}
	ct.Resolve(head, "e1", authored)

	if head["e1"].Symbol.MilStd2525C != "SFGP------*****" {
		t.Error("should not override externally authored symbol")
	}
}

func TestClassification_ReverseOverridesGeneratedSymbol(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFGP------*****"},
			Classification: &pb.ClassificationComponent{
				Taxonomy: []*pb.ClassificationTaxonomy{
					{Kind: &pb.ClassificationTaxonomy_Vehicle{Vehicle: &pb.VehicleTaxonomy{
						Domain: &pb.VehicleTaxonomy_Sea{Sea: &pb.VehicleTaxonomySea{}},
					}}},
				},
			},
		},
	}

	// Symbol was generated by a transformer
	generated := map[int32]meta.Component{
		12: {Generated: true},
	}
	ct.Resolve(head, "e1", generated)

	if head["e1"].Symbol.MilStd2525C == "SFGP------*****" {
		t.Error("should override generated symbol when taxonomy changes")
	}
}
