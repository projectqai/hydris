package lora_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/projectqai/hydris/builtin/lora"
	"github.com/projectqai/hydris/builtin/plugins"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestUnsafeLoraEndToEnd(t *testing.T) {
	pluginDir := pluginDirOrSkip(t, "unsafelora")
	shared := startShared()
	// The plugins builtin loads the plugin's defaults.yaml and seeds the fallback
	// policy on any identity left without one before it starts a plugin. The
	// harness runs the bundle directly, so do the same here.
	defaults, err := plugins.PluginDefaults(pluginDir)
	if err != nil {
		t.Fatal(err)
	}
	actor, _ := plugins.Actors(pluginDir, plugins.PluginInfo{EntityID: "plugins.unsafelora"})
	defaults = append(defaults, &pb.Entity{Id: actor, Policy: plugins.DefaultPluginPolicy()})
	if _, err := shared.eng.Push(shared.ctx, connect.NewRequest(&pb.EntityChangeRequest{Changes: defaults})); err != nil {
		t.Fatal(err)
	}
	w, _ := runPlugin(t, pluginDir)
	w.waitFor("plugin active", func() bool {
		return w.get("unsafelora.service").GetConfigurable().GetState() == pb.ConfigurableState_ConfigurableStateActive
	})

	const gateway = "lora.gw-bench"
	frame := func(e *pb.Entity) []byte {
		raw, err := proto.Marshal(e)
		if err != nil {
			t.Fatal(err)
		}
		return append([]byte{0}, raw...)
	}
	send := func(port byte, e *pb.Entity) {
		w.push(lora.CaptureEntity(gateway, port, frame(e), proto.Float64(-80), proto.Float64(5), time.Now()))
	}

	send(0x4E, &pb.Entity{Id: "node-bench-1", Geo: &pb.GeoSpatialComponent{Latitude: 1, Longitude: 2}})
	w.waitFor("heartbeat decoded", func() bool { return w.get("node-bench-1").GetGeo().GetLatitude() == 1 })
	if got := w.get("node-bench-1"); got.GetLink().GetVia() != gateway {
		t.Errorf("heartbeat = %v, want link from the gateway", got)
	}

	send(0x4E, &pb.Entity{
		Id:        "node-bench-1.det",
		Detection: &pb.DetectionComponent{DetectorEntityId: proto.String("node-bench-1"), Confidence: proto.Float32(0.7)},
	})
	w.waitFor("detection decoded", func() bool { return w.get("node-bench-1.det") != nil })

	w.settle()
	seen0, _ := w.metric("unsafelora.service", "frames seen")
	if seen0 != 2 {
		t.Fatalf("frames seen = %d before the sealed frame, want the 2 decoded above", seen0)
	}
	send(0x4F, &pb.Entity{Id: "node-bench-2"})
	w.settle()
	if w.get("node-bench-2") != nil {
		t.Error("unsafelora decoded a sealed frame")
	}
	if seen, _ := w.metric("unsafelora.service", "frames seen"); seen != seen0 {
		t.Errorf("frames seen went %d -> %d: the sealed frame reached the plugin despite the port filter", seen0, seen)
	}

	// Frames are forwarded as-is; the plugin's actor policy is what contains them.
	w.push(&pb.Entity{Id: "cam-1", Controller: &pb.Controller{Id: proto.String("onvif")}, Geo: &pb.GeoSpatialComponent{Latitude: 9}})
	authzRules := len(w.get("authz.policy").GetPolicy().GetRules())
	rejected0, _ := w.metric("unsafelora.service", "frames rejected")
	rogue, _ := structpb.NewStruct(map[string]any{"ref": "evil.example/plugin:latest", "enabled": true})
	hostile := []*pb.Entity{
		{Id: "authz.policy", Policy: &pb.PolicyComponent{Rules: []*pb.PolicyRule{{Action: pb.PolicyAction_PolicyActionAllow}}}},
		{Id: "authz.policy", Geo: &pb.GeoSpatialComponent{Latitude: 3}},
		{Id: "node-bench-evil", Authorization: &pb.AuthorizationComponent{Entitlements: []*pb.Entitlement{{Kind: &pb.Entitlement_Policy{Policy: &pb.EntitlementPolicy{}}}}}},
		{Id: "node-bench-evil", Policy: &pb.PolicyComponent{Rules: []*pb.PolicyRule{{Action: pb.PolicyAction_PolicyActionAllow}}}},
		{Id: "node-bench-evil", Device: &pb.DeviceComponent{Parent: proto.String("plugins.custom"), Class: proto.String("plugin")}, Config: &pb.ConfigurationComponent{Value: rogue}},
		{Id: "node-bench-evil", Config: &pb.ConfigurationComponent{Value: rogue}},
		{Id: "cam-1", Geo: &pb.GeoSpatialComponent{Latitude: 1}},
		{Id: "unsafelora.service", Geo: &pb.GeoSpatialComponent{Latitude: 1}},
		{Id: "unsafelora.service", Config: &pb.ConfigurationComponent{Value: rogue}},
		{Id: "node-bench-evil", Geo: &pb.GeoSpatialComponent{Latitude: 1}, Interactivity: &pb.InteractivityComponent{Icon: proto.String("skull")}},
	}
	for _, h := range hostile {
		send(0x4E, h)
	}
	w.waitFor("hostile frames rejected", func() bool {
		rejected, _ := w.metric("unsafelora.service", "frames rejected")
		return rejected == rejected0+uint64(len(hostile))
	})
	if got := len(w.get("authz.policy").GetPolicy().GetRules()); got != authzRules {
		t.Errorf("authz.policy rules went %d -> %d: a frame rewrote the policy chain", authzRules, got)
	}
	if w.get("authz.policy").GetGeo() != nil {
		t.Error("a frame wrote into a policy-bearing entity")
	}
	if w.get("node-bench-evil") != nil {
		t.Error("a frame carrying authority, a child device or configuration was accepted")
	}
	if w.get("cam-1").GetGeo().GetLatitude() != 9 {
		t.Error("a frame moved an entity owned by another controller")
	}
	if svc := w.get("unsafelora.service"); svc.GetGeo() != nil || svc.GetConfig().GetValue().GetFields()["ref"] != nil {
		t.Error("a frame wrote into the plugin's own service entity")
	}

	// The plugin keeps decoding after rejected frames, and may take over an
	// entity nobody owns.
	send(0x4E, &pb.Entity{Id: "node-bench-1", Geo: &pb.GeoSpatialComponent{Latitude: 4, Longitude: 2}})
	w.waitFor("heartbeat after rejection", func() bool { return w.get("node-bench-1").GetGeo().GetLatitude() == 4 })
	// Frames stamp whole-second freshness, so the pre-existing entity must be
	// older than the frame for its geo to lose the merge on age, not on policy.
	w.push(&pb.Entity{Id: "unowned-1", Geo: &pb.GeoSpatialComponent{Latitude: 7}, Lifetime: &pb.Lifetime{Fresh: timestamppb.New(time.Now().Add(-time.Minute))}})
	send(0x4E, &pb.Entity{Id: "unowned-1", Geo: &pb.GeoSpatialComponent{Latitude: 8}})
	w.waitFor("unowned entity taken over", func() bool { return w.get("unowned-1").GetGeo().GetLatitude() == 8 })
	if w.get("unowned-1").GetController().GetId() != "unsafelora.actor" {
		t.Error("an entity written from the air must end up owned by unsafelora.actor")
	}
}
