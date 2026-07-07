package engine

import (
	"context"
	"net/http"
	"testing"

	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

// defaultPolicy returns the global policy chain shipped in builtin/defaults.yaml,
// the single source of truth for the default authorization rules.
func defaultPolicy(t *testing.T) *pb.PolicyComponent {
	t.Helper()
	pc := defaultEntity(t, authzPolicyEntity).GetPolicy()
	if pc == nil {
		t.Fatalf("%s entity in defaults.yaml has no PolicyComponent", authzPolicyEntity)
	}
	return pc
}

// defaultEntity returns a single entity shipped in builtin/defaults.yaml.
func defaultEntity(t *testing.T, id string) *pb.Entity {
	t.Helper()
	entities, err := ParseEntities(builtin.DefaultWorld())
	if err != nil {
		t.Fatalf("parse defaults.yaml: %v", err)
	}
	for _, e := range entities {
		if e.Id == id {
			return e
		}
	}
	t.Fatalf("no %s entity in defaults.yaml", id)
	return nil
}

func testPolicyEvaluator(entities map[string]*pb.Entity) *PolicyEvaluator {
	w := testWorld(entities)
	return NewPolicyEvaluator(w)
}

// testEvalCtx builds an evalCtx for activation tests with the given peer and
// locality, authenticated as a fixed test identity.
func testEvalCtx(peer peerContext, local bool) evalCtx {
	return evalCtx{peer: peer, local: local, actor: "auth:test"}
}

func TestCELEnv_Compiles(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	if pe.env == nil {
		t.Fatal("CEL env should be created")
	}

	exprs := []string{
		`is.read`,
		`is.write && !is.local`,
		`is.create && has(change.camera)`,
		`is.http && method == "GET"`,
		`source.address.inCIDR("10.0.0.0/8")`,
		`head(change.id).controller.node != ""`,
		`is.write && actor.id != "auth:admin"`,
		`actor.id == "auth:anonymous"`,
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

	activation := buildHTTPActivation(testEvalCtx(peerContext{address: "127.0.0.1", port: "1234", local: true}, true), "GET", "/")
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

	activation := buildHTTPActivation(testEvalCtx(peerContext{address: "127.0.0.1", port: "1234", local: true}, true), "GET", "/")
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
			a := buildHTTPActivation(testEvalCtx(peerContext{address: "1.2.3.4", port: "80"}, false), tt.method, "/foo")
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
			if flags["local"] != false {
				t.Error("non-loopback should not be local")
			}
		})
	}

	a := buildHTTPActivation(testEvalCtx(peerContext{address: "127.0.0.1", local: true}, true), "GET", "/")
	if a["is"].(map[string]bool)["local"] != true {
		t.Error("loopback should be local")
	}
}

func TestBuildGRPCActivation(t *testing.T) {
	change := &pb.Entity{Id: "test.1"}
	flags := map[string]bool{
		"grpc":   true,
		"local":  false,
		"write":  true,
		"push":   true,
		"create": true,
	}
	a := buildGRPCActivation(testEvalCtx(peerContext{address: "10.0.0.1", port: "5000"}, false), flags, change)

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
	actor := a["actor"].(map[string]any)
	if actor["id"] != "auth:test" {
		t.Errorf("actor.id not passed through: %v", actor["id"])
	}
}

func testIsFlags(overrides map[string]bool) map[string]bool {
	f := newIsFlags()
	for k, v := range overrides {
		f[k] = v
	}
	return f
}

// remoteGRPC builds a remote gRPC activation for an anonymous remote caller.
func remoteGRPC(pe *PolicyEvaluator, flags map[string]bool, change *pb.Entity) map[string]any {
	return buildGRPCActivation(testEvalCtx(peerContext{address: "10.0.0.1", port: "5000"}, false), flags, change)
}

// TestDefaultPolicy verifies the shipped default: trust callers for ordinary
// reads/creates, but deny a reset from a remote caller and honor any per-entity
// policy via the head()-guarded Defer rules.
// TestDefaultPolicy exercises the shipped authz.policy: it defers to the acting
// identity's own policy, then (for now) allows by default for backwards compat.
// admin.actor (allow-all) is granted; an identity whose own policy denies is
// denied via the defer; an identity with no policy falls through to the
// insecure default allow.
func TestDefaultPolicy(t *testing.T) {
	pe := testPolicyEvaluator(map[string]*pb.Entity{
		"admin.actor":    defaultEntity(t, "admin.actor"),
		"auth:anonymous": defaultEntity(t, "auth:anonymous"),
		"locked.actor": {Id: "locked.actor", Policy: &pb.PolicyComponent{Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionDeny, Cel: celStr(`is.write`)},
		}}},
	})
	rules := pe.compileChain(defaultPolicy(t))

	asActor := func(actor string, flags map[string]bool) policyVerdict {
		ec := evalCtx{peer: peerContext{address: "10.0.0.1", port: "5000"}, actor: actor}
		return pe.evalChain(rules, buildGRPCActivation(ec, testIsFlags(flags), &pb.Entity{}), 0)
	}

	// admin.actor's allow-all policy grants everything via the defer.
	if v := asActor("admin.actor", map[string]bool{"grpc": true, "write": true, "push": true}); v != verdictAllow {
		t.Errorf("admin.actor should be allowed via defer, got %v", v)
	}
	// An identity whose own policy denies is denied via the defer.
	if v := asActor("locked.actor", map[string]bool{"grpc": true, "write": true, "push": true}); v != verdictDeny {
		t.Errorf("locked.actor should be denied by its own policy via defer, got %v", v)
	}
	// anonymous carries no policy → the defer reaches no verdict and falls
	// through to the insecure backwards-compat allow.
	if v := asActor("auth:anonymous", map[string]bool{"grpc": true, "read": true}); v != verdictAllow {
		t.Errorf("anonymous should be allowed by the insecure default, got %v", v)
	}
}

// TestFederationPush_IsFederation asserts that a push relayed by the federation
// builtin carries is.federation, so an operator policy can scope federated
// writes distinctly from other callers.
func TestFederationPush_IsFederation(t *testing.T) {
	pe := testPolicyEvaluator(nil)
	probe := &pb.PolicyComponent{
		Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionAllow, Cel: celStr(`is.federation`)},
			{Action: pb.PolicyAction_PolicyActionDeny},
		},
	}
	pe.mu.Lock()
	pe.rules = pe.compileChain(probe)
	pe.mu.Unlock()

	// Federation's bufconn data leg: builtin connection + "federation" name.
	ctx := context.WithValue(context.Background(), builtinConnKey, true)
	ctx = context.WithValue(ctx, builtinNameKey, "federation")
	ctx = context.WithValue(ctx, actorKey, "federation.downstream.remotenode")

	req := peerRequest(&pb.EntityChangeRequest{
		Changes: []*pb.Entity{
			{Id: "sensor.remote.1", Controller: &pb.Controller{Node: proto.String("remotenode")}},
		},
	})
	if err := pe.check(ctx, req); err != nil {
		t.Errorf("federation push should match is.federation, got %v", err)
	}
}

// TestPolicyDefer_ExplicitTarget locks in the Defer contract: the rule's CEL
// names the target entity. A string id jumps to that entity's policy; an empty
// string does not jump; a non-string result or an id that names no entity fails
// closed (never silently falls through).
func TestPolicyDefer_ExplicitTarget(t *testing.T) {
	pe := testPolicyEvaluator(map[string]*pb.Entity{
		"allows": {Id: "allows", Policy: &pb.PolicyComponent{Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionAllow, Cel: celStr(`true`)},
		}}},
		"denies": {Id: "denies", Policy: &pb.PolicyComponent{Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionDeny, Cel: celStr(`true`)},
		}}},
		"nopolicy": {Id: "nopolicy"},
	})

	// A Defer that jumps to <cel>, with a trailing Allow so "continue" (no jump)
	// is observable as verdictAllow and "fail closed" as verdictDeny.
	chain := func(cel string) []compiledRule {
		return pe.compileChain(&pb.PolicyComponent{Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionDefer, Cel: celStr(cel)},
			{Action: pb.PolicyAction_PolicyActionAllow},
		}})
	}
	act := remoteGRPC(pe, testIsFlags(map[string]bool{"grpc": true, "write": true}), &pb.Entity{Id: "x"})

	cases := []struct {
		name string
		cel  string
		want policyVerdict
	}{
		{"jump to allowing entity", `"allows"`, verdictAllow},
		{"jump to denying entity", `"denies"`, verdictDeny},
		{"empty target does not jump", `""`, verdictAllow},
		{"entity without policy returns", `"nopolicy"`, verdictAllow},
		{"missing entity fails closed", `"ghost"`, verdictDeny},
		{"non-string target fails closed", `is.write`, verdictDeny},
	}
	for _, tc := range cases {
		if v := pe.evalChain(chain(tc.cel), act, 0); v != tc.want {
			t.Errorf("%s: cel %q got %v, want %v", tc.name, tc.cel, v, tc.want)
		}
	}
}

// TestPolicyDefer_TargetsCurrentNotChange asserts that a defer resolving the
// node target via head(change.id) uses the STORED entity, so an incoming change
// cannot point the defer at a node policy of its choosing. The stored node
// denies; the forged node would allow.
func TestPolicyDefer_TargetsCurrentNotChange(t *testing.T) {
	pe := testPolicyEvaluator(map[string]*pb.Entity{
		"sensor.s": {Id: "sensor.s", Controller: &pb.Controller{Node: proto.String("realnode")}},
		"node.realnode": {Id: "node.realnode", Policy: &pb.PolicyComponent{Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionDeny, Cel: celStr(`true`)},
		}}},
		"node.evil": {Id: "node.evil", Policy: &pb.PolicyComponent{Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionAllow, Cel: celStr(`true`)},
		}}},
	})
	chain := pe.compileChain(&pb.PolicyComponent{Rules: []*pb.PolicyRule{
		{Action: pb.PolicyAction_PolicyActionDefer, Cel: celStr(`head(change.id).controller.node != "" ? "node." + head(change.id).controller.node : ""`)},
		{Action: pb.PolicyAction_PolicyActionAllow},
	}})
	// The incoming change forges controller.node = evil (would allow).
	forged := &pb.Entity{Id: "sensor.s", Controller: &pb.Controller{Node: proto.String("evil")}}
	act := remoteGRPC(pe, testIsFlags(map[string]bool{"grpc": true, "write": true}), forged)
	if v := pe.evalChain(chain, act, 0); v != verdictDeny {
		t.Errorf("defer must resolve via the stored node (realnode→deny), not the forged change.controller.node (evil→allow); got %v", v)
	}
}

// TestAuthContext_ResolvesIdentity asserts authn.policy assigns identity by
// connection nature: in-process (bufconn) connections become admin.actor, while
// a plain remote connection (no client cert) becomes anonymous. With no
// authn.policy entity loaded, the built-in fallback applies.
func TestAuthContext_ResolvesIdentity(t *testing.T) {
	i := &policyInterceptor{pe: testPolicyEvaluator(nil)}

	bufCtx := context.WithValue(context.Background(), builtinConnKey, true)
	ctx, err := i.authContext(bufCtx, http.Header{}, "bufconn")
	if err != nil {
		t.Fatal(err)
	}
	if got := actorFromContext(ctx); got != adminActorEntity {
		t.Errorf("bufconn: actor = %q, want %q", got, adminActorEntity)
	}

	// An in-process caller (bufconn) may declare the identity it acts as via
	// X-Builtin-Actor (e.g. federation's link entity); it is honored verbatim.
	hdr := http.Header{}
	hdr.Set("X-Builtin-Actor", "federation.downstream.remotenode")
	ctx, err = i.authContext(bufCtx, hdr, "bufconn")
	if err != nil {
		t.Fatal(err)
	}
	if got := actorFromContext(ctx); got != "federation.downstream.remotenode" {
		t.Errorf("bufconn declared actor = %q, want the declared identity", got)
	}
	// The same header on a non-bufconn connection is ignored.
	ctx, err = i.authContext(context.Background(), hdr, "10.0.0.1:5000")
	if err != nil {
		t.Fatal(err)
	}
	if got := actorFromContext(ctx); got != anonymousEntity {
		t.Errorf("remote X-Builtin-Actor must be ignored: actor = %q, want %q", got, anonymousEntity)
	}

	ctx, err = i.authContext(context.Background(), http.Header{}, "10.0.0.1:5000")
	if err != nil {
		t.Fatal(err)
	}
	if got := actorFromContext(ctx); got != anonymousEntity {
		t.Errorf("remote: actor = %q, want %q", got, anonymousEntity)
	}
}

func TestCheckEntityChange_VerbDetection(t *testing.T) {
	pe := testPolicyEvaluator(map[string]*pb.Entity{
		"existing.1": {Id: "existing.1"},
	})

	denyCreate := &pb.PolicyComponent{
		Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionDeny, Cel: celStr(`is.create`)},
			{Action: pb.PolicyAction_PolicyActionAllow},
		},
	}
	rules := pe.compileChain(denyCreate)
	pe.mu.Lock()
	pe.rules = rules
	pe.mu.Unlock()

	ec := testEvalCtx(peerContext{address: "10.0.0.1", port: "5000"}, true)

	err := pe.checkEntityChange(ec, "test", rules, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "existing.1"}},
	})
	if err != nil {
		t.Errorf("update of existing entity should be allowed: %v", err)
	}

	err = pe.checkEntityChange(ec, "test", rules, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{Id: "new.1"}},
	})
	if err == nil {
		t.Error("create of new entity should be denied by is.create rule")
	}

	err = pe.checkEntityChange(ec, "test", rules, &pb.EntityChangeRequest{
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
		testEvalCtx(peerContext{address: "10.0.0.1"}, false),
		map[string]bool{"grpc": true, "write": true, "push": true, "create": true},
		&pb.Entity{Id: "cam.1", Camera: &pb.CameraComponent{}},
	)
	out, _, err := prg.Eval(withCamera)
	if err != nil {
		t.Fatal(err)
	}
	if out.Value() != true {
		t.Error("expected has(change.camera) to be true for entity with camera")
	}

	withoutCamera := buildGRPCActivation(
		testEvalCtx(peerContext{address: "10.0.0.1"}, false),
		map[string]bool{"grpc": true, "write": true, "push": true, "create": true},
		&pb.Entity{Id: "sensor.1"},
	)
	out, _, err = prg.Eval(withoutCamera)
	if err != nil {
		t.Fatal(err)
	}
	if out.Value() != false {
		t.Error("expected has(change.camera) to be false for entity without camera")
	}
}
