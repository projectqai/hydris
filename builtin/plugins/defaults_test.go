package plugins

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func TestActorsComeFromTheManifest(t *testing.T) {
	info := PluginInfo{EntityID: "plugins.unsafelora"}
	actor, extra := Actors("../../plugins/unsafelora", info)
	if actor != "plugins.unsafelora" || len(extra) != 1 || extra[0] != "unsafelora.actor" {
		t.Errorf("actors = %q %q, want the install entity and hydris.actors from package.json", actor, extra)
	}
	if actor, extra := Actors(t.TempDir(), info); actor != "plugins.unsafelora" || extra != nil {
		t.Errorf("actors without a declaration = %q %q, want the install entity alone", actor, extra)
	}
}

func TestPluginDefaultsCarryTheActorPolicy(t *testing.T) {
	entities, err := PluginDefaults("../../plugins/unsafelora")
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 1 || entities[0].Id != "unsafelora.actor" {
		t.Fatalf("got %v, want the actor identity", entities)
	}
	e := entities[0]
	if e.GetPolicy() == nil {
		t.Error("the actor policy is missing")
	}
	if y := e.GetLifetime().GetFresh().AsTime().Year(); y != 1970 {
		t.Errorf("fresh year = %d, want the epoch stamp from the file so operator edits win", y)
	}
}

func TestPluginDefaultsAbsent(t *testing.T) {
	for _, dir := range []string{"", t.TempDir()} {
		entities, err := PluginDefaults(dir)
		if err != nil || entities != nil {
			t.Errorf("dir %q: got %v, %v; want nothing", dir, entities, err)
		}
	}
}

func TestPluginDefaultsRequireAnEpochTimestamp(t *testing.T) {
	for name, yaml := range map[string]string{
		"real timestamp": "id: x\nlifetime:\n  fresh: '2026-09-27T00:00:00Z'\nlabel: x\n",
		"no timestamp":   "id: x\nlabel: x\n",
	} {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "defaults.yaml"), []byte(yaml), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := PluginDefaults(dir); err == nil {
			t.Errorf("%s: the loader must refuse it, the timestamp belongs in the file", name)
		}
	}
}

func TestCheckActor(t *testing.T) {
	info := PluginInfo{Name: "x", EntityID: "plugins.x"}
	policy := DefaultPluginPolicy()
	entity := func(owner string, policy *pb.PolicyComponent) *pb.Entity {
		e := &pb.Entity{Policy: policy}
		if owner != "" {
			e.Controller = &pb.Controller{Id: proto.String(owner)}
		}
		return e
	}
	for name, tc := range map[string]struct {
		existing *pb.Entity
		actor    string
		info     PluginInfo
		refused  bool
	}{
		"install entity":                       {entity("plugins", nil), "plugins.x", info, false},
		"install entity with the host policy":  {entity("plugins", policy), "plugins.x", info, false},
		"install entity of foreign authority":  {entity("", policy), "plugins.x", info, true},
		"new identity":                         {nil, "x.actor", info, false},
		"identity marked on an earlier start":  {entity("plugins.x", policy), "x.actor", info, false},
		"identity of another plugin":           {entity("plugins.y", policy), "x.actor", info, true},
		"install entity of another plugin":     {entity("plugins", policy), "plugins.y", info, true},
		"host entity without a policy":         {entity("plugins", nil), "plugins.custom", info, true},
		"privileged identity":                  {entity("", policy), "admin.actor", info, true},
		"unowned entity without a policy":      {entity("", nil), "x.actor", info, true},
		"plugin without an install entity":     {entity("", policy), "x.actor", PluginInfo{Name: "x"}, true},
		"new identity, without install entity": {nil, "x.actor", PluginInfo{Name: "x"}, false},
	} {
		err := checkActor(tc.existing, tc.actor, tc.info)
		if tc.refused != errors.Is(err, controller.ErrConflict) {
			t.Errorf("%s: err = %v, want refused = %v", name, err, tc.refused)
		}
	}
}
