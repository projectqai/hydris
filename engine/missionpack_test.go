package engine

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/projectqai/hydris/pkg/missionpkg"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestComputeManifest_CountsEntities(t *testing.T) {
	entities := []*pb.Entity{
		{Id: "plugins.reolink", Device: &pb.DeviceComponent{Category: proto.String("Plugins")}},
		{Id: "camera.front", Device: &pb.DeviceComponent{Category: proto.String("Camera")}},
		{Id: "track.001"},
	}
	got := ComputeManifest(entities, missionpkg.Index{})
	if got.EntityCount != 3 {
		t.Errorf("entity_count: got %d, want 3", got.EntityCount)
	}
	if len(got.EntityIDs) != 3 {
		t.Errorf("entity_ids: got %v", got.EntityIDs)
	}
}

func TestComputeManifest_MissionKitPresenceAndLayoutNames(t *testing.T) {
	idx := missionpkg.Index{
		MissionKit: &missionpkg.MissionKit{
			Layouts: map[string]string{"beta": "{}", "alpha": "{}"},
		},
	}
	got := ComputeManifest(nil, idx)
	if !got.MissionKitPresent {
		t.Error("mission_kit_present: got false, want true")
	}
	if len(got.LayoutNames) != 2 || got.LayoutNames[0] != "alpha" || got.LayoutNames[1] != "beta" {
		t.Errorf("layout_names: got %v, want sorted [alpha beta]", got.LayoutNames)
	}
}

func TestComputeManifest_ViewStatePresence(t *testing.T) {
	cases := []struct {
		name      string
		viewState json.RawMessage
		want      bool
	}{
		{name: "nil", viewState: nil, want: false},
		{name: "empty", viewState: json.RawMessage{}, want: false},
		{name: "populated", viewState: json.RawMessage(`{"p":"x"}`), want: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ComputeManifest(nil, missionpkg.Index{ViewState: tc.viewState})
			if got.ViewStatePresent != tc.want {
				t.Errorf("view_state_present: got %v, want %v", got.ViewStatePresent, tc.want)
			}
		})
	}
}

func TestSnapshotForPack_PersistableVsAll(t *testing.T) {
	now := time.Now()
	w := testWorld(map[string]*pb.Entity{
		// durable local device — packed in both modes
		"device.cam": {
			Id:         "device.cam",
			Controller: &pb.Controller{Node: proto.String("n1")},
			Device:     &pb.DeviceComponent{State: pb.DeviceState_DeviceStateActive},
		},
		// expiring local track — only in the all=true dump
		"track.001": {
			Id:         "track.001",
			Controller: &pb.Controller{Node: proto.String("n1")},
			Lifetime:   &pb.Lifetime{Until: timestamppb.New(now.Add(30 * time.Second))},
			Geo:        &pb.GeoSpatialComponent{Latitude: 1, Longitude: 2},
		},
		// remote device — only in the all=true dump
		"device.remote": {
			Id:         "device.remote",
			Controller: &pb.Controller{Node: proto.String("other")},
			Device:     &pb.DeviceComponent{State: pb.DeviceState_DeviceStateActive},
		},
	})
	w.nodeID = "n1"

	persisted := entityIDsOf(w.snapshotForPack(false, exportOpts{}.resolveFilter()))
	if len(persisted) != 1 || persisted[0] != "device.cam" {
		t.Errorf("snapshotForPack(false): got %v, want [device.cam]", persisted)
	}

	if all := entityIDsOf(w.snapshotForPack(true, exportOpts{}.resolveFilter())); len(all) != 3 {
		t.Errorf("snapshotForPack(true): got %v, want all 3 entities", all)
	}
}

func TestSnapshotForPack_Filters(t *testing.T) {
	w := testWorld(map[string]*pb.Entity{
		"device.cam": {
			Id:         "device.cam",
			Controller: &pb.Controller{Node: proto.String("n1")},
			Device:     &pb.DeviceComponent{State: pb.DeviceState_DeviceStateActive},
			Artifact:   &pb.ArtifactComponent{Id: "blob1"},
			Policy:     &pb.PolicyComponent{},
		},
		"shape.fence": {
			Id:         "shape.fence",
			Controller: &pb.Controller{Node: proto.String("n1")},
			Policy:     &pb.PolicyComponent{},
		},
		"device.default": {
			Id:         "device.default",
			Controller: &pb.Controller{Node: proto.String("n1")},
			Device:     &pb.DeviceComponent{State: pb.DeviceState_DeviceStateActive},
			Lifetime:   &pb.Lifetime{Fresh: timestamppb.New(time.Unix(0, 0))},
		},
	})
	w.nodeID = "n1"

	t.Run("without_artifacts", func(t *testing.T) {
		f := proto.Bool(false)
		entities := w.snapshotForPack(false, exportOpts{WithArtifacts: f}.resolveFilter())
		for _, e := range entities {
			if e.Artifact != nil {
				t.Errorf("entity %s: expected nil Artifact", e.Id)
			}
		}
	})

	t.Run("without_policy", func(t *testing.T) {
		f := proto.Bool(false)
		entities := w.snapshotForPack(false, exportOpts{WithPolicy: f}.resolveFilter())
		for _, e := range entities {
			if e.Policy != nil {
				t.Errorf("entity %s: expected nil Policy", e.Id)
			}
		}
	})

	t.Run("with_defaults", func(t *testing.T) {
		without := entityIDsOf(w.snapshotForPack(false, exportOpts{}.resolveFilter()))
		for _, id := range without {
			if id == "device.default" {
				t.Error("default entity should be excluded by default")
			}
		}
		f := proto.Bool(true)
		with := entityIDsOf(w.snapshotForPack(false, exportOpts{WithDefaults: f}.resolveFilter()))
		found := false
		for _, id := range with {
			if id == "device.default" {
				found = true
			}
		}
		if !found {
			t.Error("default entity should be included when with_defaults=true")
		}
	})
}

func entityIDsOf(entities []*pb.Entity) []string {
	ids := make([]string, len(entities))
	for i, e := range entities {
		ids[i] = e.Id
	}
	return ids
}

func TestParseExportOpts(t *testing.T) {
	cases := []struct {
		name    string
		body    io.Reader
		want    exportOpts
		wantErr bool
	}{
		{name: "nil body", body: nil, want: exportOpts{}},
		{name: "empty body", body: strings.NewReader(""), want: exportOpts{}},
		{name: "whitespace body", body: strings.NewReader("   \n  "), want: exportOpts{}},
		{name: "empty object", body: strings.NewReader("{}"), want: exportOpts{}},
		{
			name: "both flags",
			body: strings.NewReader(`{"include_diagnostic":true,"include_mission_kit":true}`),
			want: exportOpts{IncludeDiagnostic: true, IncludeMissionKit: true},
		},
		{
			name: "only diagnostic",
			body: strings.NewReader(`{"include_diagnostic":true}`),
			want: exportOpts{IncludeDiagnostic: true},
		},
		{
			name: "all entities",
			body: strings.NewReader(`{"all_entities":true}`),
			want: exportOpts{AllEntities: true},
		},
		{name: "invalid json", body: strings.NewReader("not json"), wantErr: true},
		{name: "oversize", body: strings.NewReader(strings.Repeat("a", exportRequestMaxBytes+1)), wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/mission/export", tc.body)
			got, err := parseExportOpts(r)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err: got %v, wantErr=%v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			if got != tc.want {
				t.Errorf("opts: got %+v, want %+v", got, tc.want)
			}
		})
	}
}
