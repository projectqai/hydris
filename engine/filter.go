package engine

import (
	pb "github.com/projectqai/proto/go"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/geo"
)

func entityHasComponent(entity *pb.Entity, field uint32) bool {
	switch pb.EntityComponent(field) {
	case pb.EntityComponent_EntityComponentLabel:
		return entity.Label != nil
	case pb.EntityComponent_EntityComponentController:
		return entity.Controller != nil
	case pb.EntityComponent_EntityComponentLifetime:
		return entity.Lifetime != nil
	case pb.EntityComponent_EntityComponentPriority:
		return entity.Priority != nil
	case pb.EntityComponent_EntityComponentGeo:
		return entity.Geo != nil
	case pb.EntityComponent_EntityComponentSymbol:
		return entity.Symbol != nil
	case pb.EntityComponent_EntityComponentCamera:
		return entity.Camera != nil
	case pb.EntityComponent_EntityComponentDetection:
		return entity.Detection != nil
	case pb.EntityComponent_EntityComponentBearing:
		return entity.Bearing != nil
	case pb.EntityComponent_EntityComponentTrack:
		return entity.Track != nil
	case pb.EntityComponent_EntityComponentLocator:
		return entity.Locator != nil
	case pb.EntityComponent_EntityComponentTaskable:
		return entity.Taskable != nil
	case pb.EntityComponent_EntityComponentKinematics:
		return entity.Kinematics != nil
	case pb.EntityComponent_EntityComponentShape:
		return entity.Shape != nil
	case pb.EntityComponent_EntityComponentClassification:
		return entity.Classification != nil
	case pb.EntityComponent_EntityComponentTransponder:
		return entity.Transponder != nil
	case pb.EntityComponent_EntityComponentAdministrative:
		return entity.Administrative != nil
	case pb.EntityComponent_EntityComponentLocalShape:
		return entity.LocalShape != nil
	case pb.EntityComponent_EntityComponentOrientation:
		return entity.Orientation != nil
	case pb.EntityComponent_EntityComponentMission:
		return entity.Mission != nil
	case pb.EntityComponent_EntityComponentLink:
		return entity.Link != nil
	case pb.EntityComponent_EntityComponentPower:
		return entity.Power != nil
	case pb.EntityComponent_EntityComponentNavigation:
		return entity.Navigation != nil
	case pb.EntityComponent_EntityComponentCapture:
		return entity.Capture != nil
	case pb.EntityComponent_EntityComponentMetric:
		return entity.Metric != nil
	case pb.EntityComponent_EntityComponentSensor:
		return entity.Sensor != nil
	case pb.EntityComponent_EntityComponentPose:
		return entity.Pose != nil
	case pb.EntityComponent_EntityComponentTaskExecution:
		return entity.TaskExecution != nil
	case pb.EntityComponent_EntityComponentDevice:
		return entity.Device != nil
	case pb.EntityComponent_EntityComponentConfig:
		return entity.Config != nil
	case pb.EntityComponent_EntityComponentConfigurable:
		return entity.Configurable != nil
	case pb.EntityComponent_EntityComponentInteractivity:
		return entity.Interactivity != nil
	case pb.EntityComponent_EntityComponentTargetPose:
		return entity.TargetPose != nil
	case pb.EntityComponent_EntityComponentChat:
		return entity.Chat != nil
	}
	return false
}

func matchesComponentList(entity *pb.Entity, components []uint32) bool {
	if len(components) == 0 {
		return true
	}

	// Entity must have ALL specified components
	for _, field := range components {
		if !entityHasComponent(entity, field) {
			return false
		}
	}

	return true
}

func taskableContainsContext(taskable *pb.TaskableComponent, ctx *pb.TaskableContext) bool {
	if taskable == nil || ctx == nil || ctx.EntityId == nil {
		return false
	}
	for _, c := range taskable.Context {
		if c.EntityId != nil && *c.EntityId == *ctx.EntityId {
			return true
		}
	}
	return false
}

func taskableContainsAssignee(taskable *pb.TaskableComponent, assignee *pb.TaskableAssignee) bool {
	if taskable == nil || assignee == nil || assignee.EntityId == nil {
		return false
	}
	for _, a := range taskable.Assignee {
		if a.EntityId != nil && *a.EntityId == *assignee.EntityId {
			return true
		}
	}
	return false
}

func planarToOrb(planar *pb.PlanarGeometry) orb.Geometry {
	if planar == nil {
		return nil
	}

	switch p := planar.Plane.(type) {
	case *pb.PlanarGeometry_Point:
		if p.Point != nil {
			return orb.Point{p.Point.Longitude, p.Point.Latitude}
		}
	case *pb.PlanarGeometry_Line:
		if p.Line != nil && len(p.Line.Points) > 0 {
			line := make(orb.LineString, len(p.Line.Points))
			for i, pt := range p.Line.Points {
				line[i] = orb.Point{pt.Longitude, pt.Latitude}
			}
			return line
		}
	case *pb.PlanarGeometry_Polygon:
		if p.Polygon != nil && p.Polygon.Outer != nil && len(p.Polygon.Outer.Points) > 0 {
			outer := make(orb.Ring, len(p.Polygon.Outer.Points))
			for i, pt := range p.Polygon.Outer.Points {
				outer[i] = orb.Point{pt.Longitude, pt.Latitude}
			}
			poly := orb.Polygon{outer}

			// Add holes if present
			for _, hole := range p.Polygon.Holes {
				if len(hole.Points) > 0 {
					holeRing := make(orb.Ring, len(hole.Points))
					for i, pt := range hole.Points {
						holeRing[i] = orb.Point{pt.Longitude, pt.Latitude}
					}
					poly = append(poly, holeRing)
				}
			}
			return poly
		}
	case *pb.PlanarGeometry_Circle:
		// Circles are handled directly in entityIntersectsGeoFilter
		// via haversine distance check; return nil here.
	}

	return nil
}

func entityIntersectsGeoFilter(entity *pb.Entity, geoFilter *pb.GeoFilter) bool {
	if geoFilter == nil {
		return true // no geo filter = match all
	}

	if entity.Geo == nil {
		return false
	}

	entityPoint := orb.Point{entity.Geo.Longitude, entity.Geo.Latitude}

	// Handle geometry-based filtering
	if geoFilter.Geo != nil {
		switch g := geoFilter.Geo.(type) {
		case *pb.GeoFilter_Geometry:
			if g.Geometry == nil || g.Geometry.Planar == nil {
				return true
			}

			// Handle circle with geodesic distance check
			if circle, ok := g.Geometry.Planar.Plane.(*pb.PlanarGeometry_Circle); ok {
				if circle.Circle == nil || circle.Circle.Center == nil {
					return true
				}
				center := orb.Point{circle.Circle.Center.Longitude, circle.Circle.Center.Latitude}
				dist := geo.Distance(center, entityPoint)
				return dist <= circle.Circle.RadiusM
			}

			filterGeom := planarToOrb(g.Geometry.Planar)
			if filterGeom == nil {
				return true
			}

			// Check if entity point intersects with filter geometry bounds
			entityBound := entityPoint.Bound()
			filterBound := filterGeom.Bound()
			return entityBound.Intersects(filterBound)

		case *pb.GeoFilter_GeoEntityId:
			// TODO: implement entity-based geo filtering
			// Would need to look up the referenced entity's geo bounds
			return true
		}
	}

	return true
}
func (s *WorldServer) matchesEntityFilter(entity *pb.Entity, filter *pb.EntityFilter) bool {
	if filter == nil {
		return true
	}

	// Handle OR filters
	if len(filter.Or) > 0 {
		for _, orFilter := range filter.Or {
			if s.matchesEntityFilter(entity, orFilter) {
				return true
			}
		}
		return false
	}

	// Handle NOT filter
	if filter.Not != nil {
		return !s.matchesEntityFilter(entity, filter.Not)
	}

	// ID filter (exact match)
	if filter.Id != nil && entity.Id != *filter.Id {
		return false
	}

	// Label filter (exact match)
	if filter.Label != nil {
		if entity.Label == nil || *entity.Label != *filter.Label {
			return false
		}
	}

	// Component filter (must have ALL specified components)
	if !matchesComponentList(entity, filter.Component) {
		return false
	}

	// Geo filter
	if !entityIntersectsGeoFilter(entity, filter.Geo) {
		return false
	}

	// Controller filter
	if filter.Controller != nil {
		if entity.Controller == nil {
			return false
		}
		if filter.Controller.Id != nil && entity.Controller.GetId() != *filter.Controller.Id {
			return false
		}
	}

	// Configuration filter (existence check only)
	if filter.Config != nil {
		if entity.Config == nil {
			return false
		}
	}

	// Device filter
	if filter.Device != nil {
		if entity.Device == nil {
			return false
		}
		if filter.Device.Parent != nil && entity.Device.GetParent() != *filter.Device.Parent {
			return false
		}
		if filter.Device.UniqueHardwareId != nil && entity.Device.GetUniqueHardwareId() != *filter.Device.UniqueHardwareId {
			return false
		}
	}

	// Taskable filter
	if filter.Taskable != nil {
		if filter.Taskable.Context != nil {
			if !taskableContainsContext(entity.Taskable, filter.Taskable.Context) {
				return false
			}
		}
		if filter.Taskable.Assignee != nil {
			if !taskableContainsAssignee(entity.Taskable, filter.Taskable.Assignee) {
				return false
			}
		}
	}

	// Channel filter
	if filter.Channel != nil {
		if entity.Routing == nil {
			return false
		}
		found := false
		for _, ch := range entity.Routing.Channels {
			if ch.Name == filter.Channel.Name {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// Track filter
	if filter.Track != nil {
		if entity.Track == nil {
			return false
		}
		if filter.Track.Tracker != nil && entity.Track.GetTracker() != *filter.Track.Tracker {
			return false
		}
	}

	// Mission filter
	if filter.Mission != nil {
		if entity.Mission == nil {
			return false
		}
		if filter.Mission.MissionId != nil {
			// find member assets of this mission: entity must have this mission's ID
			if entity.Id != *filter.Mission.MissionId {
				return false
			}
		}
		if filter.Mission.MemberId != nil {
			// find missions containing this asset
			found := false
			for _, m := range entity.Mission.Members {
				if m == *filter.Mission.MemberId {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}
	}

	return true
}

func (s *WorldServer) matchesListEntitiesRequest(entity *pb.Entity, req *pb.ListEntitiesRequest) bool {
	return s.matchesEntityFilter(entity, req.Filter)
}
