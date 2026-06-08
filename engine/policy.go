package engine

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"

	"connectrpc.com/connect"
	"github.com/google/cel-go/cel"
	"github.com/google/cel-go/common/types"
	"github.com/google/cel-go/common/types/ref"
	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/_goconnect"
)

type policyVerdict int

const (
	verdictNone policyVerdict = iota
	verdictAllow
	verdictDeny
)

type compiledRule struct {
	action  pb.PolicyAction
	program cel.Program // nil = unconditional match
	celExpr string
}

type PolicyEvaluator struct {
	mu    sync.RWMutex
	rules []compiledRule // global chain (from node entity)
	env   *cel.Env
	world *WorldServer
}

func DefaultPolicy() *pb.PolicyComponent {
	return &pb.PolicyComponent{
		Rules: []*pb.PolicyRule{
			{Action: pb.PolicyAction_PolicyActionDeny, Cel: celStr(`is.reset && !is.trusted`)},
			{Action: pb.PolicyAction_PolicyActionDeny, Cel: celStr(`is.write && !is.trusted && has(change.policy)`)},
			{Action: pb.PolicyAction_PolicyActionAllow, Cel: celStr(`is.read || is.trusted`)},
			{Action: pb.PolicyAction_PolicyActionDefer},
			{Action: pb.PolicyAction_PolicyActionDeny},
		},
	}
}

func celStr(s string) *string { return &s }

func NewPolicyEvaluator(world *WorldServer) *PolicyEvaluator {
	env, err := newCELEnv(world)
	if err != nil {
		slog.Error("failed to create CEL environment", "error", err)
		return &PolicyEvaluator{world: world}
	}
	return &PolicyEvaluator{env: env, world: world}
}

func newCELEnv(world *WorldServer) (*cel.Env, error) {
	var adapter types.Adapter
	env, err := cel.NewEnv(
		cel.Types(&pb.Entity{}),
		cel.Variable("source", cel.MapType(cel.StringType, cel.DynType)),
		cel.Variable("is", cel.MapType(cel.StringType, cel.BoolType)),
		cel.Variable("method", cel.StringType),
		cel.Variable("path", cel.StringType),
		cel.Variable("change", cel.ObjectType("world.Entity")),
		cel.Function("head",
			cel.Overload("head_string",
				[]*cel.Type{cel.StringType},
				cel.ObjectType("world.Entity"),
				cel.UnaryBinding(func(id ref.Val) ref.Val {
					entityID, ok := id.Value().(string)
					if !ok || entityID == "" {
						return adapter.NativeToValue(&pb.Entity{})
					}
					world.l.RLock()
					es, ok := world.head[entityID]
					world.l.RUnlock()
					if !ok {
						return adapter.NativeToValue(&pb.Entity{})
					}
					return adapter.NativeToValue(es.entity)
				}),
			),
		),
		cel.Function("inCIDR",
			cel.MemberOverload("string_inCIDR_string",
				[]*cel.Type{cel.StringType, cel.StringType},
				cel.BoolType,
				cel.BinaryBinding(celInCIDR),
			),
		),
	)
	if err != nil {
		return nil, err
	}
	adapter = env.CELTypeAdapter()
	return env, nil
}

func celInCIDR(lhs, rhs ref.Val) ref.Val {
	ip, ok1 := lhs.Value().(string)
	cidr, ok2 := rhs.Value().(string)
	if !ok1 || !ok2 {
		return types.Bool(false)
	}
	_, network, err := net.ParseCIDR(cidr)
	if err != nil {
		return types.Bool(false)
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return types.Bool(false)
	}
	return types.Bool(network.Contains(parsed))
}

// Rebuild recompiles the global policy chain from the node entity's PolicyComponent.
// Caller must NOT hold world.l — this method acquires a read lock.
func (pe *PolicyEvaluator) Rebuild() {
	if pe == nil || pe.env == nil {
		return
	}

	pe.world.l.RLock()
	var pc *pb.PolicyComponent
	if pe.world.nodeEntity != nil {
		pc = pe.world.nodeEntity.GetPolicy()
	}
	pe.world.l.RUnlock()

	rules := pe.compileChain(pc)

	pe.mu.Lock()
	pe.rules = rules
	pe.mu.Unlock()

	if len(rules) > 0 {
		slog.Info("policy rebuilt", "rules", len(rules))
	}
}

func (pe *PolicyEvaluator) compileChain(pc *pb.PolicyComponent) []compiledRule {
	if pc == nil {
		return nil
	}
	var rules []compiledRule
	for _, r := range pc.Rules {
		cr := compiledRule{action: r.Action}
		if r.Cel != nil && *r.Cel != "" {
			cr.celExpr = *r.Cel
			ast, issues := pe.env.Compile(*r.Cel)
			if issues != nil && issues.Err() != nil {
				slog.Error("policy CEL compile error", "cel", *r.Cel, "error", issues.Err())
				continue
			}
			prg, err := pe.env.Program(ast)
			if err != nil {
				slog.Error("policy CEL program error", "cel", *r.Cel, "error", err)
				continue
			}
			cr.program = prg
		}
		rules = append(rules, cr)
	}
	return rules
}

func (pe *PolicyEvaluator) Interceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		if pe == nil {
			return next
		}
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if isBufconn, _ := ctx.Value(builtinConnKey).(bool); isBufconn {
				if name := req.Header().Get("X-Builtin-Name"); name != "" {
					ctx = context.WithValue(ctx, builtinNameKey, name)
				}
			}
			if err := pe.check(ctx, req); err != nil {
				return nil, err
			}
			return next(ctx, req)
		}
	}
}

// Middleware wraps an http.Handler with policy evaluation for non-Connect
// HTTP endpoints (media, artifacts, plugins, etc.). Connect RPC paths are
// skipped here because the Connect interceptor handles them with richer
// request context.
func (pe *PolicyEvaluator) Middleware(next http.Handler) http.Handler {
	if pe == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pe.mu.RLock()
		rules := pe.rules
		pe.mu.RUnlock()

		if len(rules) == 0 {
			next.ServeHTTP(w, r)
			return
		}

		// Skip Connect/gRPC service paths — handled by the Connect interceptor.
		if strings.Contains(r.URL.Path, ".") && strings.HasPrefix(r.URL.Path, "/") {
			parts := strings.SplitN(r.URL.Path[1:], "/", 2)
			if len(parts) == 2 && strings.Contains(parts[0], ".") {
				next.ServeHTTP(w, r)
				return
			}
		}

		peer := parsePeer(r.RemoteAddr)
		activation := buildHTTPActivation(peer, r.Method, r.URL.Path)
		v := pe.evalChain(rules, activation, "")
		if v == verdictDeny {
			slog.Warn("policy denied", "source", peer.address, "path", r.URL.Path, "method", r.Method)
			http.Error(w, "policy denied", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (pe *PolicyEvaluator) check(ctx context.Context, req connect.AnyRequest) error {
	pe.mu.RLock()
	rules := pe.rules
	pe.mu.RUnlock()

	if len(rules) == 0 {
		return nil
	}

	peerInfo := parsePeer(req.Peer().Addr)
	_, remote := ctx.Value(peerEntityKey).(*peerConn)
	trusted := !remote

	builtinName, _ := ctx.Value(builtinNameKey).(string)

	proc := req.Spec().Procedure

	switch m := req.Any().(type) {
	case *pb.EntityChangeRequest:
		return pe.checkEntityChange(peerInfo, trusted, builtinName, proc, rules, m)

	case *pb.ExpireEntityRequest:
		return pe.checkSingleEntity(peerInfo, trusted, builtinName, proc, rules, m.Id, isFlags(trusted, "expire"))

	case *pb.RunTaskRequest:
		return pe.checkSingleEntity(peerInfo, trusted, builtinName, proc, rules, m.EntityId, isFlags(trusted, "task"))

	default:
		flags := isReadFlags(trusted, proc)
		activation := buildGRPCActivation(peerInfo, flags, &pb.Entity{}, builtinName)
		v := pe.evalChain(rules, activation, "")
		return verdictToError(v, proc, peerInfo)
	}
}

func (pe *PolicyEvaluator) checkEntityChange(peerInfo peerContext, trusted bool, builtinName string, proc string, rules []compiledRule, m *pb.EntityChangeRequest) error {
	type evalItem struct {
		flags    map[string]bool
		entityID string
		change   *pb.Entity
	}
	var items []evalItem

	pe.world.l.RLock()
	for _, e := range m.Changes {
		f := newIsFlags()
		f["grpc"] = true
		f["trusted"] = trusted
		f["write"] = true
		f["push"] = true
		if _, ok := pe.world.head[e.Id]; ok {
			f["update"] = true
		} else {
			f["create"] = true
		}
		items = append(items, evalItem{flags: f, entityID: e.Id, change: e})
	}
	for _, e := range m.Replacements {
		f := newIsFlags()
		f["grpc"] = true
		f["trusted"] = trusted
		f["write"] = true
		f["push"] = true
		f["replace"] = true
		items = append(items, evalItem{flags: f, entityID: e.Id, change: e})
	}
	pe.world.l.RUnlock()

	for _, item := range items {
		activation := buildGRPCActivation(peerInfo, item.flags, item.change, builtinName)
		v := pe.evalChain(rules, activation, item.entityID)
		if v == verdictDeny {
			slog.Warn("policy denied", "source", peerInfo.address, "procedure", proc, "entity", item.entityID)
			return connect.NewError(connect.CodePermissionDenied,
				fmt.Errorf("policy denied %s on entity %s", proc, item.entityID))
		}
	}
	return nil
}

func (pe *PolicyEvaluator) checkSingleEntity(peerInfo peerContext, trusted bool, builtinName string, proc string, rules []compiledRule, entityID string, flags map[string]bool) error {
	change := &pb.Entity{}
	if entityID != "" {
		change.Id = entityID
	}
	activation := buildGRPCActivation(peerInfo, flags, change, builtinName)
	v := pe.evalChain(rules, activation, entityID)
	return verdictToError(v, proc, peerInfo)
}

func newIsFlags() map[string]bool {
	return map[string]bool{
		"http": false, "grpc": false, "trusted": false,
		"read": false, "write": false,
		"get": false, "list": false, "watch": false,
		"push": false, "create": false, "update": false, "replace": false,
		"expire": false, "task": false, "reset": false, "upload": false,
	}
}

func isFlags(trusted bool, op string) map[string]bool {
	f := newIsFlags()
	f["grpc"] = true
	f["trusted"] = trusted
	f["write"] = true
	f[op] = true
	return f
}

func isReadFlags(trusted bool, proc string) map[string]bool {
	f := newIsFlags()
	f["grpc"] = true
	f["trusted"] = trusted
	f["read"] = true
	switch proc {
	case _goconnect.WorldServiceListEntitiesProcedure:
		f["list"] = true
	case _goconnect.WorldServiceWatchEntitiesProcedure:
		f["watch"] = true
	case _goconnect.WorldServiceGetEntityProcedure,
		_goconnect.WorldServiceGetLocalNodeProcedure:
		f["get"] = true
	case _goconnect.WorldServiceHardResetProcedure,
		_goconnect.WorldServiceLoadMissionProcedure:
		f["read"] = false
		f["write"] = true
		f["reset"] = true
	case _goconnect.ArtifactServiceUploadArtifactProcedure:
		f["read"] = false
		f["write"] = true
		f["upload"] = true
	}
	return f
}

func buildHTTPActivation(peer peerContext, method, path string) map[string]any {
	isRead := method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
	f := newIsFlags()
	f["http"] = true
	f["trusted"] = peer.local
	f["read"] = isRead
	f["write"] = !isRead
	f["get"] = method == http.MethodGet
	return map[string]any{
		"source": map[string]any{
			"address": peer.address,
			"port":    peer.port,
		},
		"is":     f,
		"method": method,
		"path":   path,
		"change": &pb.Entity{},
	}
}

func buildGRPCActivation(peer peerContext, flags map[string]bool, change *pb.Entity, builtinName string) map[string]any {
	if change == nil {
		change = &pb.Entity{}
	}
	return map[string]any{
		"source": map[string]any{
			"address": peer.address,
			"port":    peer.port,
			"builtin": builtinName,
		},
		"is":     flags,
		"method": "",
		"path":   "",
		"change": change,
	}
}

func (pe *PolicyEvaluator) evalChain(rules []compiledRule, activation map[string]any, entityID string) policyVerdict {
	for _, rule := range rules {
		if !ruleMatches(rule, activation) {
			continue
		}
		switch rule.action {
		case pb.PolicyAction_PolicyActionAllow:
			return verdictAllow
		case pb.PolicyAction_PolicyActionDeny:
			return verdictDeny
		case pb.PolicyAction_PolicyActionLog:
			slog.Info("policy log",
				"source", activation["source"],
				"is", activation["is"],
			)
			continue
		case pb.PolicyAction_PolicyActionDefer:
			if entityID == "" {
				continue
			}
			entityRules := pe.entityChain(entityID)
			if len(entityRules) == 0 {
				if change, ok := activation["change"].(*pb.Entity); ok {
					if change.Controller != nil && change.Controller.Node != nil {
						entityRules = pe.entityChain("node." + *change.Controller.Node)
					}
				}
			}
			if len(entityRules) == 0 {
				continue
			}
			v := pe.evalChain(entityRules, activation, "")
			if v != verdictNone {
				return v
			}
			continue
		}
	}
	return verdictNone
}

func (pe *PolicyEvaluator) entityChain(entityID string) []compiledRule {
	pe.world.l.RLock()
	defer pe.world.l.RUnlock()

	es, ok := pe.world.head[entityID]
	if !ok {
		return nil
	}
	pc := es.entity.GetPolicy()
	if pc == nil {
		return nil
	}
	return pe.compileChain(pc)
}

func ruleMatches(rule compiledRule, activation map[string]any) bool {
	if rule.program == nil {
		return true
	}
	out, _, err := rule.program.Eval(activation)
	if err != nil {
		slog.Warn("policy CEL eval error", "cel", rule.celExpr, "error", err)
		return rule.action == pb.PolicyAction_PolicyActionDeny
	}
	v, ok := out.Value().(bool)
	return ok && v
}

func verdictToError(v policyVerdict, proc string, peer peerContext) error {
	if v == verdictDeny {
		slog.Warn("policy denied", "source", peer.address, "procedure", proc)
		return connect.NewError(connect.CodePermissionDenied,
			fmt.Errorf("policy denied %s", proc))
	}
	return nil
}
