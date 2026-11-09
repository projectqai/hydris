package engine

import (
	"testing"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// TestDefaultPolicy_PluginsAdminOnly: installing or changing a plugin runs code
// on the host, so the shipped authz.policy leaves it to admin, whoever else the
// rest of the policy lets write.
func TestDefaultPolicy_PluginsAdminOnly(t *testing.T) {
	child := func(id, parent string) *pb.Entity {
		return &pb.Entity{Id: id, Device: &pb.DeviceComponent{Parent: proto.String(parent)}}
	}
	pe := testPolicyEvaluator(map[string]*pb.Entity{
		"admin.actor":    defaultEntity(t, "admin.actor"),
		"auth:anonymous": defaultEntity(t, "auth:anonymous"),
		"plugins.cue":    child("plugins.cue", "plugins.service"),
		"my.plugin":      child("my.plugin", "plugins.custom"),
		"my.feed":        child("my.feed", "plugins.custom"),
		"my.feed.p":      child("my.feed.p", "my.feed"),
		"ordinary":       {Id: "ordinary"},
	})
	rules := pe.compileChain(defaultPolicy(t))

	verdict := func(actor string, claimed []string, change *pb.Entity) policyVerdict {
		ec := evalCtx{peer: peerContext{address: "10.0.0.1", port: "5000"}, actor: actor, builtinName: "plugins", claimedActors: claimed}
		return pe.evalChain(rules, buildGRPCActivation(ec, testIsFlags(map[string]bool{"grpc": true, "write": true, "push": true}), change), 0)
	}

	for name, change := range map[string]*pb.Entity{
		"create a custom plugin":       child("new.plugin", "plugins.custom"),
		"create a feed plugin":         child("my.feed.q", "my.feed"),
		"re-enable a custom plugin":    {Id: "my.plugin", Config: &pb.ConfigurationComponent{}},
		"replace a plugin's artifact":  {Id: "my.plugin"}, // POST /artifacts/my.plugin binds only the id
		"enable a registry plugin":     {Id: "plugins.cue", Config: &pb.ConfigurationComponent{}},
		"enable a feed's plugin":       {Id: "my.feed.p", Config: &pb.ConfigurationComponent{}},
		"move a plugin under a parent": {Id: "my.plugin", Device: &pb.DeviceComponent{Parent: proto.String("ordinary")}},
	} {
		if v := verdict("auth:anonymous", nil, change); v != verdictDeny {
			t.Errorf("anonymous may %s: verdict %v", name, v)
		}
		if v := verdict("admin.actor", nil, change); v != verdictAllow {
			t.Errorf("admin may not %s: verdict %v", name, v)
		}
	}

	// A plugin may write the identities it claims, but not claim its way into
	// installing a plugin.
	if v := verdict("plugins.p", []string{"evil.plugin"}, child("evil.plugin", "plugins.custom")); v != verdictDeny {
		t.Errorf("a plugin installed a plugin through a claimed identity: verdict %v", v)
	}
	if v := verdict("auth:anonymous", nil, &pb.Entity{Id: "ordinary"}); v != verdictAllow {
		t.Errorf("an ordinary write must stay allowed: verdict %v", v)
	}
}
