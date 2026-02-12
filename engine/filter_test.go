package engine

import (
	"testing"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func TestEntityHasComponent(t *testing.T) {
	tests := []struct {
		name   string
		entity *pb.Entity
		field  uint32
		want   bool
	}{
		{"label present", &pb.Entity{Label: ptr("test")}, 2, true},
		{"label absent", &pb.Entity{}, 2, false},
		{"controller present", &pb.Entity{Controller: &pb.Controller{}}, 3, true},
		{"lifetime present", &pb.Entity{Lifetime: &pb.Lifetime{}}, 4, true},
		{"priority present", &pb.Entity{Priority: ptr(pb.Priority_PriorityRoutine)}, 5, true},
		{"geo present", &pb.Entity{Geo: &pb.GeoSpatialComponent{}}, 11, true},
		{"symbol present", &pb.Entity{Symbol: &pb.SymbolComponent{}}, 12, true},
		{"camera present", &pb.Entity{Camera: &pb.CameraComponent{}}, 15, true},
		{"detection present", &pb.Entity{Detection: &pb.DetectionComponent{}}, 16, true},
		{"bearing present", &pb.Entity{Bearing: &pb.BearingComponent{}}, 17, true},
		{"track present", &pb.Entity{Track: &pb.TrackComponent{}}, 21, true},
		{"locator present", &pb.Entity{Locator: &pb.LocatorComponent{}}, 22, true},
		{"taskable present", &pb.Entity{Taskable: &pb.TaskableComponent{}}, 23, true},
		{"kinematics present", &pb.Entity{Kinematics: &pb.KinematicsComponent{}}, 24, true},
		{"shape present", &pb.Entity{Shape: &pb.GeoShapeComponent{}}, 25, true},
		{"classification present", &pb.Entity{Classification: &pb.ClassificationComponent{}}, 26, true},
		{"transponder present", &pb.Entity{Transponder: &pb.TransponderComponent{}}, 27, true},
		{"administrative present", &pb.Entity{Administrative: &pb.AdministrativeComponent{}}, 28, true},
		{"orientation present", &pb.Entity{Orientation: &pb.OrientationComponent{}}, 30, true},
		{"mission present", &pb.Entity{Mission: &pb.MissionComponent{}}, 31, true},
		{"link present", &pb.Entity{Link: &pb.LinkComponent{}}, 32, true},
		{"power present", &pb.Entity{Power: &pb.PowerComponent{}}, 33, true},
		{"navigation present", &pb.Entity{Navigation: &pb.NavigationComponent{}}, 34, true},
		{"device present", &pb.Entity{Device: &pb.DeviceComponent{}}, 50, true},
		{"config present", &pb.Entity{Config: &pb.ConfigurationComponent{}}, 51, true},
		{"unknown field", &pb.Entity{}, 99, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := entityHasComponent(tt.entity, tt.field)
			if got != tt.want {
				t.Errorf("entityHasComponent(%d) = %v, want %v", tt.field, got, tt.want)
			}
		})
	}
}

func TestMatchesComponentList(t *testing.T) {
	entity := &pb.Entity{
		Label: ptr("test"),
		Geo:   &pb.GeoSpatialComponent{},
	}

	// Empty list matches all
	if !matchesComponentList(entity, nil) {
		t.Error("nil components should match")
	}
	if !matchesComponentList(entity, []uint32{}) {
		t.Error("empty components should match")
	}

	// Single match
	if !matchesComponentList(entity, []uint32{2}) {
		t.Error("should match Label (2)")
	}

	// All present
	if !matchesComponentList(entity, []uint32{2, 11}) {
		t.Error("should match Label+Geo")
	}

	// One missing
	if matchesComponentList(entity, []uint32{2, 3}) {
		t.Error("should not match Label+Controller (no controller)")
	}
}

func TestTaskableContainsContext(t *testing.T) {
	eid := "ctx-entity"
	taskable := &pb.TaskableComponent{
		Context: []*pb.TaskableContext{
			{EntityId: &eid},
		},
	}

	// Match
	if !taskableContainsContext(taskable, &pb.TaskableContext{EntityId: &eid}) {
		t.Error("should find context")
	}

	// No match
	other := "other"
	if taskableContainsContext(taskable, &pb.TaskableContext{EntityId: &other}) {
		t.Error("should not find non-matching context")
	}

	// Nil cases
	if taskableContainsContext(nil, &pb.TaskableContext{EntityId: &eid}) {
		t.Error("nil taskable should return false")
	}
	if taskableContainsContext(taskable, nil) {
		t.Error("nil context should return false")
	}
	if taskableContainsContext(taskable, &pb.TaskableContext{}) {
		t.Error("nil EntityId should return false")
	}
}

func TestTaskableContainsAssignee(t *testing.T) {
	eid := "assignee-entity"
	taskable := &pb.TaskableComponent{
		Assignee: []*pb.TaskableAssignee{
			{EntityId: &eid},
		},
	}

	// Match
	if !taskableContainsAssignee(taskable, &pb.TaskableAssignee{EntityId: &eid}) {
		t.Error("should find assignee")
	}

	// No match
	other := "other"
	if taskableContainsAssignee(taskable, &pb.TaskableAssignee{EntityId: &other}) {
		t.Error("should not find non-matching assignee")
	}

	// Nil cases
	if taskableContainsAssignee(nil, &pb.TaskableAssignee{EntityId: &eid}) {
		t.Error("nil taskable should return false")
	}
	if taskableContainsAssignee(taskable, nil) {
		t.Error("nil assignee should return false")
	}
	if taskableContainsAssignee(taskable, &pb.TaskableAssignee{}) {
		t.Error("nil EntityId should return false")
	}
}

func TestMatchesEntityFilter_NilFilter(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{Id: "e1"}
	if !w.matchesEntityFilter(entity, nil) {
		t.Error("nil filter should match all")
	}
}

func TestMatchesEntityFilter_IDFilter(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{Id: "e1"}

	if !w.matchesEntityFilter(entity, &pb.EntityFilter{Id: proto.String("e1")}) {
		t.Error("should match same ID")
	}
	if w.matchesEntityFilter(entity, &pb.EntityFilter{Id: proto.String("e2")}) {
		t.Error("should not match different ID")
	}
}

func TestMatchesEntityFilter_LabelFilter(t *testing.T) {
	w := testWorld(nil)

	labeled := &pb.Entity{Id: "e1", Label: ptr("tank")}
	unlabeled := &pb.Entity{Id: "e2"}

	filter := &pb.EntityFilter{Label: proto.String("tank")}

	if !w.matchesEntityFilter(labeled, filter) {
		t.Error("should match same label")
	}
	if w.matchesEntityFilter(unlabeled, filter) {
		t.Error("should not match entity without label")
	}
	if w.matchesEntityFilter(labeled, &pb.EntityFilter{Label: proto.String("plane")}) {
		t.Error("should not match different label")
	}
}

func TestMatchesEntityFilter_ComponentFilter(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{Id: "e1", Geo: &pb.GeoSpatialComponent{}, Label: ptr("x")}

	if !w.matchesEntityFilter(entity, &pb.EntityFilter{Component: []uint32{11}}) {
		t.Error("should match Geo component")
	}
	if !w.matchesEntityFilter(entity, &pb.EntityFilter{Component: []uint32{2, 11}}) {
		t.Error("should match Label+Geo")
	}
	if w.matchesEntityFilter(entity, &pb.EntityFilter{Component: []uint32{11, 50}}) {
		t.Error("should not match when Device is missing")
	}
}

func TestMatchesEntityFilter_ControllerFilter(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{
		Id:         "e1",
		Controller: &pb.Controller{Id: proto.String("ctrl1")},
	}
	noCtrl := &pb.Entity{Id: "e2"}

	filter := &pb.EntityFilter{Controller: &pb.ControllerFilter{Id: proto.String("ctrl1")}}

	if !w.matchesEntityFilter(entity, filter) {
		t.Error("should match same controller ID")
	}
	if w.matchesEntityFilter(noCtrl, filter) {
		t.Error("should not match entity without controller")
	}
	if w.matchesEntityFilter(entity, &pb.EntityFilter{Controller: &pb.ControllerFilter{Id: proto.String("ctrl2")}}) {
		t.Error("should not match different controller ID")
	}
}

func TestMatchesEntityFilter_ConfigFilter(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{
		Id:     "e1",
		Config: &pb.ConfigurationComponent{Key: "mykey"},
	}
	noConfig := &pb.Entity{Id: "e2"}

	filter := &pb.EntityFilter{Config: &pb.ConfigurationFilter{Key: proto.String("mykey")}}

	if !w.matchesEntityFilter(entity, filter) {
		t.Error("should match config key")
	}
	if w.matchesEntityFilter(noConfig, filter) {
		t.Error("should not match entity without config")
	}
	if w.matchesEntityFilter(entity, &pb.EntityFilter{Config: &pb.ConfigurationFilter{Key: proto.String("other")}}) {
		t.Error("should not match different config key")
	}
}

func TestMatchesEntityFilter_DeviceFilter_Labels(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{
		Id: "e1",
		Device: &pb.DeviceComponent{
			Labels: map[string]string{"type": "sensor", "zone": "a"},
		},
	}

	// Subset match
	filter := &pb.EntityFilter{Device: &pb.DeviceFilter{
		Labels: map[string]string{"type": "sensor"},
	}}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("should match label subset")
	}

	// Non-matching label
	filter2 := &pb.EntityFilter{Device: &pb.DeviceFilter{
		Labels: map[string]string{"type": "camera"},
	}}
	if w.matchesEntityFilter(entity, filter2) {
		t.Error("should not match wrong label value")
	}

	// No device
	if w.matchesEntityFilter(&pb.Entity{Id: "e2"}, filter) {
		t.Error("should not match entity without device")
	}
}

func TestMatchesEntityFilter_DeviceFilter_USB(t *testing.T) {
	w := testWorld(nil)
	vid := uint32(0x1234)
	pid := uint32(0x5678)
	entity := &pb.Entity{
		Id: "e1",
		Device: &pb.DeviceComponent{
			Usb: &pb.UsbDevice{VendorId: &vid, ProductId: &pid},
		},
	}

	filter := &pb.EntityFilter{Device: &pb.DeviceFilter{
		Usb: &pb.UsbDevice{VendorId: &vid},
	}}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("should match USB vendor")
	}

	otherVid := uint32(0xFFFF)
	filter2 := &pb.EntityFilter{Device: &pb.DeviceFilter{
		Usb: &pb.UsbDevice{VendorId: &otherVid},
	}}
	if w.matchesEntityFilter(entity, filter2) {
		t.Error("should not match different USB vendor")
	}

	// Entity without USB
	noUsb := &pb.Entity{Id: "e2", Device: &pb.DeviceComponent{}}
	if w.matchesEntityFilter(noUsb, filter) {
		t.Error("should not match entity without USB")
	}
}

func TestMatchesEntityFilter_DeviceFilter_IP(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{
		Id: "e1",
		Device: &pb.DeviceComponent{
			Ip: &pb.IpDevice{Host: proto.String("192.168.1.1"), Port: proto.Uint32(8080)},
		},
	}

	filter := &pb.EntityFilter{Device: &pb.DeviceFilter{
		Ip: &pb.IpDevice{Host: proto.String("192.168.1.1")},
	}}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("should match IP host")
	}

	filter2 := &pb.EntityFilter{Device: &pb.DeviceFilter{
		Ip: &pb.IpDevice{Host: proto.String("10.0.0.1")},
	}}
	if w.matchesEntityFilter(entity, filter2) {
		t.Error("should not match different host")
	}

	// No IP on entity
	noIP := &pb.Entity{Id: "e2", Device: &pb.DeviceComponent{}}
	if w.matchesEntityFilter(noIP, filter) {
		t.Error("should not match entity without IP")
	}
}

func TestMatchesEntityFilter_DeviceFilter_Serial(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{
		Id: "e1",
		Device: &pb.DeviceComponent{
			Serial: &pb.SerialDevice{Path: proto.String("/dev/ttyACM0")},
		},
	}

	filter := &pb.EntityFilter{Device: &pb.DeviceFilter{
		Serial: &pb.SerialDevice{Path: proto.String("/dev/ttyACM0")},
	}}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("should match serial path")
	}

	filter2 := &pb.EntityFilter{Device: &pb.DeviceFilter{
		Serial: &pb.SerialDevice{Path: proto.String("/dev/ttyUSB0")},
	}}
	if w.matchesEntityFilter(entity, filter2) {
		t.Error("should not match different serial path")
	}

	noSerial := &pb.Entity{Id: "e2", Device: &pb.DeviceComponent{}}
	if w.matchesEntityFilter(noSerial, filter) {
		t.Error("should not match entity without serial")
	}
}

func TestMatchesEntityFilter_TaskableFilter(t *testing.T) {
	w := testWorld(nil)
	ctxID := "ctx1"
	assigneeID := "a1"
	entity := &pb.Entity{
		Id: "e1",
		Taskable: &pb.TaskableComponent{
			Context:  []*pb.TaskableContext{{EntityId: &ctxID}},
			Assignee: []*pb.TaskableAssignee{{EntityId: &assigneeID}},
		},
	}

	// Context match
	filter := &pb.EntityFilter{Taskable: &pb.TaskableFilter{
		Context: &pb.TaskableContext{EntityId: &ctxID},
	}}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("should match taskable context")
	}

	// Context no match
	other := "other"
	filter2 := &pb.EntityFilter{Taskable: &pb.TaskableFilter{
		Context: &pb.TaskableContext{EntityId: &other},
	}}
	if w.matchesEntityFilter(entity, filter2) {
		t.Error("should not match wrong context")
	}

	// Assignee match
	filter3 := &pb.EntityFilter{Taskable: &pb.TaskableFilter{
		Assignee: &pb.TaskableAssignee{EntityId: &assigneeID},
	}}
	if !w.matchesEntityFilter(entity, filter3) {
		t.Error("should match taskable assignee")
	}
}

func TestMatchesEntityFilter_TrackFilter(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{
		Id:    "e1",
		Track: &pb.TrackComponent{Tracker: proto.String("tracker1")},
	}
	noTrack := &pb.Entity{Id: "e2"}

	filter := &pb.EntityFilter{Track: &pb.TrackFilter{Tracker: proto.String("tracker1")}}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("should match tracker")
	}
	if w.matchesEntityFilter(noTrack, filter) {
		t.Error("should not match entity without track")
	}
	if w.matchesEntityFilter(entity, &pb.EntityFilter{Track: &pb.TrackFilter{Tracker: proto.String("other")}}) {
		t.Error("should not match different tracker")
	}
}

func TestMatchesEntityFilter_OrFilter(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{Id: "e1", Label: ptr("tank")}

	filter := &pb.EntityFilter{
		Or: []*pb.EntityFilter{
			{Id: proto.String("e2")},
			{Label: proto.String("tank")},
		},
	}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("should match OR (second clause matches)")
	}

	filter2 := &pb.EntityFilter{
		Or: []*pb.EntityFilter{
			{Id: proto.String("e2")},
			{Label: proto.String("plane")},
		},
	}
	if w.matchesEntityFilter(entity, filter2) {
		t.Error("should not match OR when no clause matches")
	}
}

func TestMatchesEntityFilter_NotFilter(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{Id: "e1"}

	filter := &pb.EntityFilter{Not: &pb.EntityFilter{Id: proto.String("e2")}}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("NOT(id=e2) should match e1")
	}

	filter2 := &pb.EntityFilter{Not: &pb.EntityFilter{Id: proto.String("e1")}}
	if w.matchesEntityFilter(entity, filter2) {
		t.Error("NOT(id=e1) should not match e1")
	}
}

func TestMatchesListEntitiesRequest(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{Id: "e1"}

	req := &pb.ListEntitiesRequest{Filter: &pb.EntityFilter{Id: proto.String("e1")}}
	if !w.matchesListEntitiesRequest(entity, req) {
		t.Error("should match via filter delegation")
	}

	req2 := &pb.ListEntitiesRequest{Filter: &pb.EntityFilter{Id: proto.String("e2")}}
	if w.matchesListEntitiesRequest(entity, req2) {
		t.Error("should not match different ID")
	}
}

func TestEntityIntersectsGeoFilter_NilFilter(t *testing.T) {
	entity := &pb.Entity{Id: "e1", Geo: &pb.GeoSpatialComponent{Latitude: 1.0, Longitude: 2.0}}
	if !entityIntersectsGeoFilter(entity, nil) {
		t.Error("nil geo filter should match all")
	}
}

func TestEntityIntersectsGeoFilter_NoGeo(t *testing.T) {
	entity := &pb.Entity{Id: "e1"}
	filter := &pb.GeoFilter{
		Geo: &pb.GeoFilter_Geometry{
			Geometry: &pb.Geometry{
				Planar: &pb.PlanarGeometry{
					Plane: &pb.PlanarGeometry_Point{
						Point: &pb.PlanarPoint{Latitude: 1.0, Longitude: 2.0},
					},
				},
			},
		},
	}
	if entityIntersectsGeoFilter(entity, filter) {
		t.Error("entity without geo should not match geo filter")
	}
}

func TestEntityIntersectsGeoFilter_PointIntersection(t *testing.T) {
	entity := &pb.Entity{
		Id:  "e1",
		Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
	}

	// Filter with polygon that contains the point
	filter := &pb.GeoFilter{
		Geo: &pb.GeoFilter_Geometry{
			Geometry: &pb.Geometry{
				Planar: &pb.PlanarGeometry{
					Plane: &pb.PlanarGeometry_Polygon{
						Polygon: &pb.PlanarPolygon{
							Outer: &pb.PlanarRing{
								Points: []*pb.PlanarPoint{
									{Latitude: 47.0, Longitude: 10.0},
									{Latitude: 49.0, Longitude: 10.0},
									{Latitude: 49.0, Longitude: 12.0},
									{Latitude: 47.0, Longitude: 12.0},
									{Latitude: 47.0, Longitude: 10.0},
								},
							},
						},
					},
				},
			},
		},
	}
	if !entityIntersectsGeoFilter(entity, filter) {
		t.Error("point inside polygon should match")
	}
}

func TestEntityIntersectsGeoFilter_NilGeometry(t *testing.T) {
	entity := &pb.Entity{
		Id:  "e1",
		Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
	}

	// Filter with nil geometry data
	filter := &pb.GeoFilter{
		Geo: &pb.GeoFilter_Geometry{
			Geometry: &pb.Geometry{},
		},
	}
	if !entityIntersectsGeoFilter(entity, filter) {
		t.Error("nil planar in geometry should match all")
	}
}

func TestPlanarToOrb_Point(t *testing.T) {
	planar := &pb.PlanarGeometry{
		Plane: &pb.PlanarGeometry_Point{
			Point: &pb.PlanarPoint{Latitude: 48.0, Longitude: 11.0},
		},
	}
	g := planarToOrb(planar)
	if g == nil {
		t.Fatal("expected non-nil geometry for point")
	}
}

func TestPlanarToOrb_Line(t *testing.T) {
	planar := &pb.PlanarGeometry{
		Plane: &pb.PlanarGeometry_Line{
			Line: &pb.PlanarRing{
				Points: []*pb.PlanarPoint{
					{Latitude: 48.0, Longitude: 11.0},
					{Latitude: 49.0, Longitude: 12.0},
				},
			},
		},
	}
	g := planarToOrb(planar)
	if g == nil {
		t.Fatal("expected non-nil geometry for line")
	}
}

func TestPlanarToOrb_Polygon(t *testing.T) {
	planar := &pb.PlanarGeometry{
		Plane: &pb.PlanarGeometry_Polygon{
			Polygon: &pb.PlanarPolygon{
				Outer: &pb.PlanarRing{
					Points: []*pb.PlanarPoint{
						{Latitude: 47.0, Longitude: 10.0},
						{Latitude: 49.0, Longitude: 10.0},
						{Latitude: 49.0, Longitude: 12.0},
						{Latitude: 47.0, Longitude: 10.0},
					},
				},
				Holes: []*pb.PlanarRing{
					{
						Points: []*pb.PlanarPoint{
							{Latitude: 47.5, Longitude: 10.5},
							{Latitude: 48.5, Longitude: 10.5},
							{Latitude: 48.5, Longitude: 11.5},
							{Latitude: 47.5, Longitude: 10.5},
						},
					},
				},
			},
		},
	}
	g := planarToOrb(planar)
	if g == nil {
		t.Fatal("expected non-nil geometry for polygon with holes")
	}
}

func TestPlanarToOrb_Nil(t *testing.T) {
	if planarToOrb(nil) != nil {
		t.Error("nil planar should return nil")
	}
}

func TestPlanarToOrb_EmptyLine(t *testing.T) {
	planar := &pb.PlanarGeometry{
		Plane: &pb.PlanarGeometry_Line{
			Line: &pb.PlanarRing{},
		},
	}
	if planarToOrb(planar) != nil {
		t.Error("empty line should return nil")
	}
}

func TestPlanarToOrb_EmptyPolygon(t *testing.T) {
	planar := &pb.PlanarGeometry{
		Plane: &pb.PlanarGeometry_Polygon{
			Polygon: &pb.PlanarPolygon{},
		},
	}
	if planarToOrb(planar) != nil {
		t.Error("empty polygon should return nil")
	}
}

func TestMatchesEntityFilter_GeoEntityId(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{
		Id:  "e1",
		Geo: &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
	}

	// GeoEntityId is a TODO - should return true
	filter := &pb.EntityFilter{
		Geo: &pb.GeoFilter{
			Geo: &pb.GeoFilter_GeoEntityId{GeoEntityId: "ref-entity"},
		},
	}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("GeoEntityId filter should match (TODO returns true)")
	}
}

func TestMatchesEntityFilter_CombinedFilters(t *testing.T) {
	w := testWorld(nil)
	entity := &pb.Entity{
		Id:         "e1",
		Label:      ptr("tank"),
		Controller: &pb.Controller{Id: proto.String("ctrl1")},
		Geo:        &pb.GeoSpatialComponent{Latitude: 48.0, Longitude: 11.0},
	}

	// All match
	filter := &pb.EntityFilter{
		Id:         proto.String("e1"),
		Label:      proto.String("tank"),
		Controller: &pb.ControllerFilter{Id: proto.String("ctrl1")},
		Component:  []uint32{11}, // Geo
	}
	if !w.matchesEntityFilter(entity, filter) {
		t.Error("all criteria match, should return true")
	}

	// One fails
	filter2 := &pb.EntityFilter{
		Id:    proto.String("e1"),
		Label: proto.String("plane"), // mismatch
	}
	if w.matchesEntityFilter(entity, filter2) {
		t.Error("label mismatch, should return false")
	}
}
