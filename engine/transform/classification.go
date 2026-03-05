package transform

import pb "github.com/projectqai/proto/go"

// ClassificationTransformer derives a ClassificationComponent from the
// MIL-STD-2525C symbol code in SymbolComponent when no explicit
// ClassificationComponent is present.
//
// MIL-STD-2525C SIDC positions:
//   - Position 2 (index 1): Identity/Affiliation
//   - Position 3 (index 2): Battle Dimension
type ClassificationTransformer struct{}

func NewClassificationTransformer() *ClassificationTransformer {
	return &ClassificationTransformer{}
}

func (ct *ClassificationTransformer) Validate(head map[string]*pb.Entity, incoming *pb.Entity) error {
	return nil
}

func (ct *ClassificationTransformer) Resolve(head map[string]*pb.Entity, changedID string) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]
	if entity == nil {
		return nil, nil
	}

	// Only act when there's a symbol but no explicit classification
	if entity.Symbol == nil || entity.Symbol.MilStd2525C == "" {
		return nil, nil
	}
	if entity.Classification != nil {
		return nil, nil
	}

	sidc := entity.Symbol.MilStd2525C
	if len(sidc) < 3 {
		return nil, nil
	}

	identity := parseIdentity(sidc[1])
	dimension := parseDimension(sidc[2])

	if identity == pb.ClassificationIdentity_ClassificationIdentityInvalid &&
		dimension == pb.ClassificationBattleDimension_ClassificationBattleDimensionInvalid {
		return nil, nil
	}

	cls := &pb.ClassificationComponent{}
	if identity != pb.ClassificationIdentity_ClassificationIdentityInvalid {
		cls.Identity = &identity
	}
	if dimension != pb.ClassificationBattleDimension_ClassificationBattleDimensionInvalid {
		cls.Dimension = &dimension
	}
	entity.Classification = cls

	return nil, nil
}

func parseIdentity(c byte) pb.ClassificationIdentity {
	switch c {
	case 'P':
		return pb.ClassificationIdentity_ClassificationIdentityPending
	case 'U':
		return pb.ClassificationIdentity_ClassificationIdentityUnknown
	case 'F', 'A':
		// F = Friend, A = Assumed Friend (mapped to Friend)
		return pb.ClassificationIdentity_ClassificationIdentityFriend
	case 'N':
		return pb.ClassificationIdentity_ClassificationIdentityNeutral
	case 'H', 'J':
		// H = Hostile, J = Joker (mapped to Hostile)
		return pb.ClassificationIdentity_ClassificationIdentityHostile
	case 'S', 'K':
		// S = Suspect, K = Faker (mapped to Suspect)
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
