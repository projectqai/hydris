package engine

import (
	"testing"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func testPolicyEvaluator(entities map[string]*pb.Entity) *PolicyEvaluator {
	w := testWorld(entities)
	return NewPolicyEvaluator(w)
}

func TestCELEnv_Compiles(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	if pe.env == nil {
		t.Fatal("CEL env should be created")
	}

	exprs := []string{
		`is.read`,
		`is.write && !is.trusted`,
		`is.create && has(change.camera)`,
		`is.http && method == "GET"`,
		`source.address.inCIDR("10.0.0.0/8")`,
		`head(change.id).controller.node != ""`,
		`is.reset && !is.trusted`,
		`is.push && is.update`,
	}
	for _, expr := range exprs {
		ast, issues := pe.env.Compile(expr)
		if issues != nil && issues.Err() != nil {
			t.Errorf("failed to compile %q: %v", expr, issues.Err())
			continue
		}
		if _, err := pe.env.Program(ast); err != nil {
			t.Errorf("failed to create program for %q: %v", expr, err)
		}
	}
}

func TestHeadFunction_Lookup(t *testing.T) {
	pe := testPolicyEvaluator(map[string]*pb.Entity{
		"sensor.1": {
			Id: "sensor.1",
			Controller: &pb.Controller{
				Node: proto.String("abc"),
			},
		},
	})

	ast, issues := pe.env.Compile(`head("sensor.1").controller.node == "abc"`)
	if issues != nil && issues.Err() != nil {
		t.Fatal(issues.Err())
	}
	prg, err := pe.env.Program(ast)
	if err != nil {
		t.Fatal(err)
	}

	activation := buildHTTPActivation(peerContext{address: "127.0.0.1", port: "1234", local: true}, "GET", "/")
	out, _, err := prg.Eval(activation)
	if err != nil {
		t.Fatal(err)
	}
	if out.Value() != true {
		t.Error("expected head('sensor.1').controller.node == 'abc' to be true")
	}
}

func TestHeadFunction_Missing(t *testing.T) {
	pe := testPolicyEvaluator(nil)

	ast, issues := pe.env.Compile(`head("nonexistent").id == ""`)
	if issues != nil && issues.Err() != nil {
		t.Fatal(issues.Err())
	}
	prg, err := pe.env.Program(ast)
	if err != nil {
		t.Fatal(err)
	}

	activation := buildHTTPActivation(peerContext{address: "127.0.0.1", port: "1234", local: true}, "GET", "/")
	out, _, err := prg.Eval(activation)
	if err != nil {
		t.Fatal(err)
	}
	if out.Value() != true {
		t.Error("expected head of missing entity to return empty entity with empty id")
	}
}

func TestBuildHTTPActivation(t *testing.T) {
	tests := []struct {
		method    string
		wantRead  bool
		wantWrite bool
		wantGet   bool
	}{
		{"GET", true, false, true},
		{"HEAD", true, false, false},
		{"OPTIONS", true, false, false},
		{"POST", false, true, false},
		{"PUT", false, true, false},
		{"DELETE", false, true, false},
		{"PATCH", false, true, false},
	}

	for _, tt := range tests {
		t.Run(tt.method, func(t *testing.T) {
			a := buildHTTPActivation(peerContext{address: "1.2.3.4", port: "80"}, tt.method, "/foo")
			flags := a["is"].(map[string]bool)
			if flags["http"] != true {
				t.Error("expected is.http = true")
			}
			if flags["read"] != tt.wantRead {
				t.Errorf("is.read: got %v, want %v", flags["read"], tt.wantRead)
			}
			if flags["write"] != tt.wantWrite {
				t.Errorf("is.write: got %v, want %v", flags["write"], tt.wantWrite)
			}
			if flags["get"] != tt.wantGet {
				t.Errorf("is.get: got %v, want %v", flags["get"], tt.wantGet)
			}
			if flags["trusted"] != false {
				t.Error("non-loopback should not be trusted")
			}
		})
	}

	a := buildHTTPActivation(peerContext{address: "127.0.0.1", local: true}, "GET", "/")
	if a["is"].(map[string]bool)["trusted"] != true {
		t.Error("loopback should be trusted")
	}
}

func TestBuildGRPCActivation(t *testing.T) {
	change := &pb.Entity{Id: "test.1"}
	flags := map[string]bool{
		"grpc":    true,
		"trusted": false,
		"write":   true,
		"push":    true,
		"create":  true,
	}
	a := buildGRPCActivation(peerContext{address: "10.0.0.1", port: "5000"}, flags, change, "")

	if a["method"] != "" {
		t.Error("gRPC activation should have empty method")
	}
	if a["path"] != "" {
		t.Error("gRPC activation should have empty path")
	}
	gotFlags := a["is"].(map[string]bool)
	if !gotFlags["grpc"] || !gotFlags["create"] || !gotFlags["push"] {
		t.Error("flags not passed through")
	}
}

func testIsFlags(overrides map[string]bool) map[string]bool {
	f := newIsFlags()
	for k, v := range overrides {
		f[k] = v
	}
	return f
}

func TestDefaultPolicy_RemotePolicyChangeDenied(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	rules := pe.compileChain(DefaultPolicy())

	remotePolicyWrite := buildGRPCActivation(
		peerContext{address: "10.0.0.1", port: "5000"},
		testIsFlags(map[string]bool{"grpc": true, "write": true, "push": true, "update": true}),
		&pb.Entity{Id: "sensor.1", Policy: &pb.PolicyComponent{}}, "",
	)
	if v := pe.evalChain(rules, remotePolicyWrite, ""); v != verdictDeny {
		t.Errorf("remote write containing policy should be denied, got %v", v)
	}
}

func TestDefaultPolicy_TrustedPolicyChangeAllowed(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	rules := pe.compileChain(DefaultPolicy())

	trustedPolicyWrite := buildGRPCActivation(
		peerContext{address: "127.0.0.1", local: true},
		testIsFlags(map[string]bool{"grpc": true, "trusted": true, "write": true, "push": true, "update": true}),
		&pb.Entity{Id: "node.abc", Policy: DefaultPolicy()}, "",
	)
	if v := pe.evalChain(rules, trustedPolicyWrite, ""); v != verdictAllow {
		t.Errorf("trusted write containing policy should be allowed, got %v", v)
	}
}

func TestDefaultPolicy_TrustedAllowed(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	rules := pe.compileChain(DefaultPolicy())
	if len(rules) != 5 {
		t.Fatalf("expected 5 rules, got %d", len(rules))
	}

	trusted := buildGRPCActivation(
		peerContext{address: "127.0.0.1", local: true},
		testIsFlags(map[string]bool{"grpc": true, "trusted": true, "write": true, "push": true, "create": true}),
		&pb.Entity{}, "",
	)
	if v := pe.evalChain(rules, trusted, ""); v != verdictAllow {
		t.Errorf("trusted write should be allowed, got %v", v)
	}
}

func TestDefaultPolicy_RemoteReadAllowed(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	rules := pe.compileChain(DefaultPolicy())

	remoteRead := buildGRPCActivation(
		peerContext{address: "10.0.0.1", port: "5000"},
		testIsFlags(map[string]bool{"grpc": true, "read": true, "list": true}),
		&pb.Entity{}, "",
	)
	if v := pe.evalChain(rules, remoteRead, ""); v != verdictAllow {
		t.Errorf("remote read should be allowed, got %v", v)
	}
}

func TestDefaultPolicy_RemoteResetDenied(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	rules := pe.compileChain(DefaultPolicy())

	remoteReset := buildGRPCActivation(
		peerContext{address: "10.0.0.1", port: "5000"},
		testIsFlags(map[string]bool{"grpc": true, "write": true, "reset": true}),
		&pb.Entity{}, "",
	)
	if v := pe.evalChain(rules, remoteReset, ""); v != verdictDeny {
		t.Errorf("remote reset should be denied, got %v", v)
	}
}

func TestDefaultPolicy_RemoteWriteDenied(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	rules := pe.compileChain(DefaultPolicy())

	remoteWrite := buildGRPCActivation(
		peerContext{address: "10.0.0.1", port: "5000"},
		testIsFlags(map[string]bool{"grpc": true, "write": true, "push": true, "create": true}),
		&pb.Entity{}, "",
	)
	if v := pe.evalChain(rules, remoteWrite, ""); v != verdictDeny {
		t.Errorf("remote write should be denied (no Defer target), got %v", v)
	}
}

// TestDefaultPolicy_RemoteExportDenied guards the default-deny tail: the export
// endpoints disclose world state, args, hostname, and logs, and are POSTs (so
// is.read is false). They match no explicit allow rule, so the trailing catch-all
// Deny must block remote callers. If that tail is ever removed or reordered above
// an allow, these endpoints silently open to the network — this test fails first.
func TestDefaultPolicy_RemoteExportDenied(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	rules := pe.compileChain(DefaultPolicy())

	for _, path := range []string{"/diagnostic/export", "/mission/export"} {
		remote := buildHTTPActivation(
			peerContext{address: "10.0.0.1", port: "5000"},
			"POST", path,
		)
		if v := pe.evalChain(rules, remote, ""); v != verdictDeny {
			t.Errorf("remote POST %s should be denied, got %v", path, v)
		}

		// Local callers (the desktop app, the CLI on the same host) must keep working.
		local := buildHTTPActivation(
			peerContext{address: "127.0.0.1", port: "5000", local: true},
			"POST", path,
		)
		if v := pe.evalChain(rules, local, ""); v == verdictDeny {
			t.Errorf("local POST %s should be allowed, got deny", path)
		}
	}
}

func TestCheckEntityChange_VerbDetection(t *testing.T) {
	pe := testPolicyEvaluator(map[string]*pb.Entity{
		"existing.1": {Id: "existing.1"},
	})

	allowAll := &pb.PolicyComponent{
		Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionAllow},
		},
	}
	rules := pe.compileChain(allowAll)
	pe.mu.Lock()
	pe.rules = rules
	pe.mu.Unlock()

	denyCreate := &pb.PolicyComponent{
		Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionDeny, Cel: celStr(`is.create`)},
			{Action: pb.PolicyAction_PolicyActionAllow},
		},
	}
	rules = pe.compileChain(denyCreate)
	pe.mu.Lock()
	pe.rules = rules
	pe.mu.Unlock()

	peer := peerContext{address: "10.0.0.1", port: "5000"}

	err := pe.checkEntityChange(peer, true, "", "test", rules, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "existing.1"}},
	})
	if err != nil {
		t.Errorf("update of existing entity should be allowed: %v", err)
	}

	err = pe.checkEntityChange(peer, true, "", "test", rules, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "new.1"}},
	})
	if err == nil {
		t.Error("create of new entity should be denied by is.create rule")
	}

	err = pe.checkEntityChange(peer, true, "", "test", rules, &pb.EntityChangeRequest{
		Replacements: []*pb.Entity{{Id: "existing.1"}},
	})
	if err != nil {
		t.Errorf("replace should be allowed (not is.create): %v", err)
	}
}

func TestProtoFieldAccess_InCEL(t *testing.T) {
	pe := testPolicyEvaluator(nil)

	ast, issues := pe.env.Compile(`has(change.camera)`)
	if issues != nil && issues.Err() != nil {
		t.Fatal(issues.Err())
	}
	prg, err := pe.env.Program(ast)
	if err != nil {
		t.Fatal(err)
	}

	withCamera := buildGRPCActivation(
		peerContext{address: "10.0.0.1"},
		map[string]bool{"grpc": true, "write": true, "push": true, "create": true},
		&pb.Entity{Id: "cam.1", Camera: &pb.CameraComponent{}}, "",
	)
	out, _, err := prg.Eval(withCamera)
	if err != nil {
		t.Fatal(err)
	}
	if out.Value() != true {
		t.Error("expected has(change.camera) to be true for entity with camera")
	}

	withoutCamera := buildGRPCActivation(
		peerContext{address: "10.0.0.1"},
		map[string]bool{"grpc": true, "write": true, "push": true, "create": true},
		&pb.Entity{Id: "sensor.1"}, "",
	)
	out, _, err = prg.Eval(withoutCamera)
	if err != nil {
		t.Fatal(err)
	}
	if out.Value() != false {
		t.Error("expected has(change.camera) to be false for entity without camera")
	}
}
