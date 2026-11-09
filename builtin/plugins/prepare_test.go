package plugins_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/builtin/plugins"
	"github.com/projectqai/hydris/engine"
	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/_goconnect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var (
	engineOnce sync.Once
	eng        *engine.WorldServer
)

func startEngine(t *testing.T) *engine.WorldServer {
	t.Helper()
	engineOnce.Do(func() {
		eng = engine.NewWorldServer()
		eng.InitNodeIdentity()
		if err := eng.LoadDefaults(builtin.DefaultWorld()); err != nil {
			panic(err)
		}
		srv := engine.NewBuiltinServer(engine.NewAPIMux(eng, nil, nil, nil))
		go func() { _ = srv.Serve(builtin.GetBuiltinListener()) }()
	})
	return eng
}

func get(t *testing.T, id string) *pb.Entity {
	t.Helper()
	resp, err := startEngine(t).GetEntity(context.Background(), connect.NewRequest(&pb.GetEntityRequest{Id: id}))
	if err != nil {
		return nil
	}
	return resp.Msg.Entity
}

func pluginDir(t *testing.T, manifest, defaults string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range map[string]string{"package.json": manifest, "defaults.yaml": defaults} {
		if content == "" {
			continue
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func actorDefaults(id, label string) string {
	return "id: " + id + "\nlabel: " + label + "\nlifetime:\n  fresh: '1970-01-01T00:00:01Z'\n" +
		"policy:\n  rules:\n    - action: PolicyActionDeny\n      label: " + label + "\n"
}

func TestPrepareActorsTiesAnIdentityToItsPlugin(t *testing.T) {
	startEngine(t)
	ctx := context.Background()
	const manifest = `{"name":"a","hydris":{"actors":["tie.actor"]}}`
	owner := plugins.PluginInfo{Name: "a", EntityID: "plugins.tie-a"}
	dir := pluginDir(t, manifest, actorDefaults("tie.actor", "shipped"))

	for range 2 {
		if err := plugins.PrepareActors(ctx, owner, dir); err != nil {
			t.Fatalf("the owning plugin must start, again after a restart: %v", err)
		}
	}
	actor := get(t, "tie.actor")
	if got := actor.GetController().GetId(); got != "plugins.tie-a" {
		t.Errorf("identity is marked %q, want its plugin", got)
	}
	if rules := actor.GetPolicy().GetRules(); len(rules) != 1 || rules[0].GetLabel() != "shipped" {
		t.Errorf("identity policy = %v, want the one from defaults.yaml", rules)
	}
	if own := get(t, "plugins.tie-a"); own.GetController().GetId() != "plugins" || own.GetPolicy() == nil {
		t.Errorf("install entity = %v, want the host mark and the fallback policy", own)
	}

	other := plugins.PluginInfo{Name: "b", EntityID: "plugins.tie-b"}
	for name, manifest := range map[string]string{
		"declared identity": `{"name":"b","hydris":{"actors":["tie.actor"]}}`,
		"install entity":    `{"name":"b","hydris":{"actors":["plugins.tie-a"]}}`,
		"admin":             `{"name":"b","hydris":{"actors":["admin.actor"]}}`,
		"policy chain":      `{"name":"b","hydris":{"actors":["authz.policy"]}}`,
	} {
		err := plugins.PrepareActors(ctx, other, pluginDir(t, manifest, ""))
		if !errors.Is(err, controller.ErrConflict) {
			t.Errorf("%s of another: err = %v, want a conflict", name, err)
		}
	}
	if get(t, "plugins.tie-b") != nil {
		t.Error("a refused plugin must leave no identity behind")
	}
	if got := get(t, "tie.actor").GetController().GetId(); got != "plugins.tie-a" {
		t.Errorf("identity is marked %q after the refusals, want its plugin", got)
	}
}

// pushAsPlugin pushes the way the plugin's code does, as the identity it asks
// for ("" is the plugin itself).
func pushAsPlugin(info plugins.PluginInfo, dir, as string, msg *pb.EntityChangeRequest) error {
	client := _goconnect.NewWorldServiceClient(plugins.NewPluginClient(dir, info), "http://hydris.builtin")
	req := connect.NewRequest(msg)
	if as != "" {
		req.Header().Set(plugins.RequestedActorHeader, as)
	}
	_, err := client.Push(context.Background(), req)
	return err
}

func TestAPluginWritesThePolicyOfAnIdentityItClaims(t *testing.T) {
	startEngine(t)
	ctx := context.Background()
	info := plugins.PluginInfo{Name: "h", EntityID: "plugins.claim"}
	dir := pluginDir(t, `{"name":"h","hydris":{"actors":["claim.actor"]}}`, actorDefaults("claim.actor", "shipped"))
	if err := plugins.PrepareActors(ctx, info, dir); err != nil {
		t.Fatal(err)
	}
	change := func(id, label string) *pb.EntityChangeRequest {
		return &pb.EntityChangeRequest{Changes: []*pb.Entity{{
			Id:       id,
			Lifetime: &pb.Lifetime{Fresh: timestamppb.New(time.Unix(5, 0))},
			Policy:   &pb.PolicyComponent{Rules: []*pb.PolicyRule{{Action: pb.PolicyAction_PolicyActionAllow, Label: &label}}},
		}}}
	}
	label := func() string { return get(t, "claim.actor").GetPolicy().GetRules()[0].GetLabel() }

	for name, tc := range map[string]struct{ as, id string }{
		"as the claimed identity": {"claim.actor", "claim.actor"},
		"its install entity":      {"", "plugins.claim"},
		"unclaimed identity":      {"", "admin.actor"},
	} {
		err := pushAsPlugin(info, dir, tc.as, change(tc.id, "x"))
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Errorf("%s: err = %v, want it denied", name, err)
		}
	}
	if label() != "shipped" {
		t.Fatalf("the policy of claim.actor is now %q", label())
	}
	if err := pushAsPlugin(info, dir, "", change("claim.actor", "bumped")); err != nil || label() != "bumped" {
		t.Errorf("as the plugin: err = %v, policy %q; want it written", err, label())
	}

	operator := change("claim.actor", "operator")
	operator.Changes[0].Lifetime = nil
	if _, err := startEngine(t).Push(ctx, connect.NewRequest(operator)); err != nil {
		t.Fatal(err)
	}
	if err := plugins.PrepareActors(ctx, info, dir); err != nil {
		t.Errorf("restart after an operator's change: %v", err)
	}
	if label() != "operator" {
		t.Errorf("the policy of claim.actor is %q, want the operator's: defaults lose against it", label())
	}
}

func TestPrepareActorsRefusesBrokenDefaults(t *testing.T) {
	startEngine(t)
	const manifest = `{"name":"c","hydris":{"actors":["broken.actor"]}}`
	info := plugins.PluginInfo{Name: "c", EntityID: "plugins.broken"}

	for name, defaults := range map[string]string{
		"syntax":                         "id: broken.actor\n  label: [",
		"unknown field":                  "id: broken.actor\nnonsense: 1\nlifetime:\n  fresh: '1970-01-01T00:00:01Z'\n",
		"no timestamp":                   "id: broken.actor\nlabel: x\n",
		"no timestamp on another entity": actorDefaults("broken.actor", "x") + "---\nid: broken.thing\nlabel: x\n",
	} {
		err := plugins.PrepareActors(context.Background(), info, pluginDir(t, manifest, defaults))
		if !errors.Is(err, controller.ErrConflict) {
			t.Errorf("%s: err = %v, want a conflict", name, err)
		}
	}
	if get(t, "broken.actor") != nil || get(t, "plugins.broken") != nil {
		t.Error("a plugin with broken defaults must get no fallback policy")
	}
}

func TestPrepareActorsPushesOtherDefaultsAsThePlugin(t *testing.T) {
	startEngine(t)
	ctx := context.Background()
	const manifest = `{"name":"e","hydris":{"actors":["other.actor"]}}`
	const stamp = "\nlifetime:\n  fresh: '1970-01-01T00:00:01Z'\n"
	info := plugins.PluginInfo{Name: "e", EntityID: "plugins.other"}

	dir := pluginDir(t, manifest, actorDefaults("other.actor", "shipped")+
		"---\nid: other.service\nlabel: Shipped"+stamp+"config:\n  value:\n    enabled: true\n")
	for range 2 {
		if err := plugins.PrepareActors(ctx, info, dir); err != nil {
			t.Fatalf("defaults the plugin may write must not stop it, again after a restart: %v", err)
		}
	}
	shipped := get(t, "other.service")
	if shipped.GetLabel() != "Shipped" || shipped.GetConfig().GetValue().GetFields()["enabled"].GetBoolValue() != true {
		t.Errorf("other.service = %v, want the entity from defaults.yaml", shipped)
	}
	if rules := get(t, "other.actor").GetPolicy().GetRules(); len(rules) != 1 || rules[0].GetLabel() != "shipped" {
		t.Errorf("identity policy = %v, want the one from defaults.yaml", rules)
	}

	neighbour := plugins.PluginInfo{Name: "f", EntityID: "plugins.other-f"}
	if err := plugins.PrepareActors(ctx, neighbour, pluginDir(t, `{"name":"f"}`, "")); err != nil {
		t.Fatal(err)
	}
	guarded := []string{"authz.policy", "authn.policy", "admin.actor", "plugins.other-f"}
	before := map[string]*pb.Entity{}
	for _, id := range guarded {
		before[id] = get(t, id)
	}
	for name, defaults := range map[string]string{
		"policy chain":               actorDefaults("authz.policy", "x"),
		"policy chain, relabelled":   "id: authn.policy\nlabel: x" + stamp,
		"privileged identity":        "id: admin.actor\nlabel: x" + stamp,
		"identity of another plugin": "id: plugins.other-f\nlabel: x" + stamp,
		"policy on a new entity":     actorDefaults("other.granted", "x"),
		"policy on its own entity":   actorDefaults("plugins.other", "x"),
		"one refused entity of two":  "id: other.second\nlabel: x" + stamp + "---\n" + actorDefaults("authz.policy", "x"),
	} {
		err := plugins.PrepareActors(ctx, info, pluginDir(t, manifest, defaults))
		if !errors.Is(err, controller.ErrConflict) {
			t.Errorf("%s: err = %v, want a conflict", name, err)
		}
	}
	for _, id := range guarded {
		after := get(t, id)
		if after.GetLabel() != before[id].GetLabel() || len(after.GetPolicy().GetRules()) != len(before[id].GetPolicy().GetRules()) {
			t.Errorf("plugin defaults rewrote %s", id)
		}
	}
	if get(t, "other.granted") != nil || get(t, "other.second") != nil {
		t.Error("refused defaults must leave nothing behind")
	}

	err := plugins.PrepareActors(ctx, plugins.PluginInfo{Name: "g"}, pluginDir(t, "", "id: other.hostpush\nlabel: x"+stamp))
	if !errors.Is(err, controller.ErrConflict) || get(t, "other.hostpush") != nil {
		t.Errorf("without an install entity: err = %v, want a conflict and nothing pushed as the host", err)
	}
}

func TestGetEntityTellsAbsentFromFailed(t *testing.T) {
	startEngine(t)
	if e, err := plugins.GetEntity(context.Background(), "admin.actor"); err != nil || e.GetId() != "admin.actor" {
		t.Errorf("existing entity: got %v, %v", e, err)
	}
	if e, err := plugins.GetEntity(context.Background(), "no.such.entity"); err != nil || e != nil {
		t.Errorf("absent entity: got %v, %v; want neither", e, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e, err := plugins.GetEntity(ctx, "admin.actor"); err == nil || e != nil {
		t.Errorf("failed lookup: got %v, %v; want an error, it must not read as an absent identity", e, err)
	}
}

func TestPrepareActorsRetriesWhenTheLookupFails(t *testing.T) {
	startEngine(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	info := plugins.PluginInfo{Name: "d", EntityID: "plugins.lookup"}
	dir := pluginDir(t, `{"name":"d","hydris":{"actors":["admin.actor"]}}`, "")
	err := plugins.PrepareActors(ctx, info, dir)
	if err == nil || errors.Is(err, controller.ErrConflict) {
		t.Errorf("err = %v, want a transient failure that is retried", err)
	}
	if get(t, "plugins.lookup") != nil {
		t.Error("a refused plugin must leave no identity behind")
	}
}
