package transform

import (
	"testing"

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

	ct.Resolve(head, "e1")

	cls := head["e1"].Classification
	if cls == nil {
		t.Fatal("expected ClassificationComponent")
	}
	if cls.Identity == nil || *cls.Identity != pb.ClassificationIdentity_ClassificationIdentityFriend {
		t.Errorf("expected Friend, got %v", cls.Identity)
	}
	if cls.Dimension == nil || *cls.Dimension != pb.ClassificationBattleDimension_ClassificationBattleDimensionGround {
		t.Errorf("expected Ground, got %v", cls.Dimension)
	}
}

func TestClassification_ParsesHostileAir(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SHAP-----------"},
		},
	}

	ct.Resolve(head, "e1")

	cls := head["e1"].Classification
	if cls == nil {
		t.Fatal("expected ClassificationComponent")
	}
	if cls.Identity == nil || *cls.Identity != pb.ClassificationIdentity_ClassificationIdentityHostile {
		t.Errorf("expected Hostile, got %v", cls.Identity)
	}
	if cls.Dimension == nil || *cls.Dimension != pb.ClassificationBattleDimension_ClassificationBattleDimensionAir {
		t.Errorf("expected Air, got %v", cls.Dimension)
	}
}

func TestClassification_ParsesUnknownSea(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SUS-----------"},
		},
	}

	ct.Resolve(head, "e1")

	cls := head["e1"].Classification
	if cls == nil {
		t.Fatal("expected ClassificationComponent")
	}
	if cls.Identity == nil || *cls.Identity != pb.ClassificationIdentity_ClassificationIdentityUnknown {
		t.Errorf("expected Unknown, got %v", cls.Identity)
	}
	if cls.Dimension == nil || *cls.Dimension != pb.ClassificationBattleDimension_ClassificationBattleDimensionSeaSurface {
		t.Errorf("expected SeaSurface, got %v", cls.Dimension)
	}
}

func TestClassification_SkipsWhenClassificationExists(t *testing.T) {
	ct := NewClassificationTransformer()
	identity := pb.ClassificationIdentity_ClassificationIdentityNeutral
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SHGP-----------"},
			Classification: &pb.ClassificationComponent{
				Identity: &identity,
			},
		},
	}

	ct.Resolve(head, "e1")

	if *head["e1"].Classification.Identity != pb.ClassificationIdentity_ClassificationIdentityNeutral {
		t.Error("should not override existing classification")
	}
}

func TestClassification_SkipsWithoutSymbol(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {Id: "e1"},
	}

	ct.Resolve(head, "e1")

	if head["e1"].Classification != nil {
		t.Error("should not create classification without symbol")
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

	ct.Resolve(head, "e1")

	if head["e1"].Classification != nil {
		t.Error("should not create classification from too-short SIDC")
	}
}

func TestClassification_SkipsExpiredEntity(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{}

	upsert, remove := ct.Resolve(head, "gone")
	if len(upsert) != 0 || len(remove) != 0 {
		t.Error("should return nothing for expired entity")
	}
}

func TestClassification_AssumedFriendMappedToFriend(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SAGP-----------"},
		},
	}

	ct.Resolve(head, "e1")

	cls := head["e1"].Classification
	if cls == nil {
		t.Fatal("expected ClassificationComponent")
	}
	if cls.Identity == nil || *cls.Identity != pb.ClassificationIdentity_ClassificationIdentityFriend {
		t.Errorf("assumed friend (A) should map to Friend, got %v", cls.Identity)
	}
}

func TestClassification_JokerMappedToHostile(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SJGP-----------"},
		},
	}

	ct.Resolve(head, "e1")

	cls := head["e1"].Classification
	if cls == nil {
		t.Fatal("expected ClassificationComponent")
	}
	if cls.Identity == nil || *cls.Identity != pb.ClassificationIdentity_ClassificationIdentityHostile {
		t.Errorf("joker (J) should map to Hostile, got %v", cls.Identity)
	}
}

func TestClassification_SubsurfaceDimension(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SHUP-----------"},
		},
	}

	ct.Resolve(head, "e1")

	cls := head["e1"].Classification
	if cls == nil {
		t.Fatal("expected ClassificationComponent")
	}
	if cls.Dimension == nil || *cls.Dimension != pb.ClassificationBattleDimension_ClassificationBattleDimensionSubsurface {
		t.Errorf("expected Subsurface, got %v", cls.Dimension)
	}
}

func TestClassification_SpaceDimension(t *testing.T) {
	ct := NewClassificationTransformer()
	head := map[string]*pb.Entity{
		"e1": {
			Id:     "e1",
			Symbol: &pb.SymbolComponent{MilStd2525C: "SFPP-----------"},
		},
	}

	ct.Resolve(head, "e1")

	cls := head["e1"].Classification
	if cls == nil {
		t.Fatal("expected ClassificationComponent")
	}
	if cls.Dimension == nil || *cls.Dimension != pb.ClassificationBattleDimension_ClassificationBattleDimensionSpace {
		t.Errorf("expected Space, got %v", cls.Dimension)
	}
}
