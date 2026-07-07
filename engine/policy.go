package engine

import (
	"context"
	"crypto/tls"
	"crypto/x509"
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
	mu         sync.RWMutex
	rules      []compiledRule // global authorization chain (authz.policy)
	authnRules []compiledRule // connection-identity chain (authn.policy)
	env        *cel.Env
	world      *WorldServer
}

// failClosedPolicy is the minimal safety net used only when no policy entity is
// present (e.g. defaults disabled or the entity was wiped). It allows local and
// builtin callers so the node can still administer itself and an operator can
// restore a policy, and denies everything else. The real default policy ships in
// builtin/defaults.yaml.
func failClosedPolicy() *pb.PolicyComponent {
	return &pb.PolicyComponent{Rules: []*pb.PolicyRule{
		{Action: pb.PolicyAction_PolicyActionAllow, Cel: celStr(`is.local || is.builtin`), Label: celStr("local or builtin")},
		{Action: pb.PolicyAction_PolicyActionDeny, Label: celStr("fail closed")},
	}}
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
		cel.Variable("actor", cel.MapType(cel.StringType, cel.DynType)),
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

// Rebuild recompiles the authorization chain (authz.policy) and the
// connection-identity chain (authn.policy) from their singleton entities
// (shipped in defaults.yaml, editable at runtime). If authz.policy carries no
// PolicyComponent — e.g. defaults were disabled — it falls back to a fail-closed
// chain so a node is never left wide open. Caller must NOT hold world.l.
func (pe *PolicyEvaluator) Rebuild() {
	if pe == nil || pe.env == nil {
		return
	}

	pe.world.l.RLock()
	var pc, ac *pb.PolicyComponent
	if es, ok := pe.world.head[authzPolicyEntity]; ok {
		pc = es.entity.GetPolicy()
	}
	if es, ok := pe.world.head[authnPolicyEntity]; ok {
		ac = es.entity.GetPolicy()
	}
	pe.world.l.RUnlock()
	if pc == nil {
		pc = failClosedPolicy()
	}

	rules := pe.compileChain(pc)
	authnRules := pe.compileChain(ac) // nil ac → nil rules → built-in authn fallback

	pe.mu.Lock()
	pe.rules = rules
	pe.authnRules = authnRules
	pe.mu.Unlock()

	if len(rules) > 0 {
		slog.Info("policy rebuilt", "rules", len(rules), "authn", len(authnRules))
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

// Interceptor returns the policy interceptor. It implements connect.Interceptor
// (not just the unary func) so that client-streaming handlers — notably
// ArtifactService.UploadArtifact — are also authenticated and authorized;
// a unary-only interceptor would leave streaming uploads completely open.
func (pe *PolicyEvaluator) Interceptor() connect.Interceptor {
	return &policyInterceptor{pe: pe}
}

type policyInterceptor struct{ pe *PolicyEvaluator }

// authContext records the builtin name / federation node for in-process callers,
// resolves the connection's actor identity via authn.policy (once per
// connection), and attaches it to the context.
func (i *policyInterceptor) authContext(ctx context.Context, header http.Header, peerAddr string) (context.Context, error) {
	isBufconn, _ := ctx.Value(builtinConnKey).(bool)
	if isBufconn {
		// Builtins are in-process and trusted: they declare the role they relay
		// for (name, federation node) and, optionally, the identity they act as.
		// These headers are gated on the bufconn — a remote peer reaches a
		// different listener and can never set them.
		if name := header.Get("X-Builtin-Name"); name != "" {
			ctx = context.WithValue(ctx, builtinNameKey, name)
		}
		if node := header.Get("X-Federation-Node"); node != "" {
			ctx = context.WithValue(ctx, federationNodeKey, node)
		}
		// A declared actor (e.g. federation's link entity) is honored verbatim;
		// only authn.policy resolution is skipped, not authorization.
		if actor := header.Get("X-Builtin-Actor"); actor != "" {
			return context.WithValue(ctx, actorKey, actor), nil
		}
	}

	pc, _ := ctx.Value(peerEntityKey).(*peerConn)
	actor, err := i.pe.resolveActor(pc, parsePeer(peerAddr), isBufconn)
	if err != nil {
		return ctx, err
	}
	return context.WithValue(ctx, actorKey, actor), nil
}

// resolveActor resolves who a connection is via authn.policy, exactly once per
// connection (cached on the peerConn). An empty result denies the connection.
// Connections with no peerConn (in-process bufconn, loopback) are resolved per
// call — cheap, and they have no cert to cache anyway.
func (pe *PolicyEvaluator) resolveActor(pc *peerConn, peer peerContext, isBufconn bool) (string, error) {
	// resolve validates any presented mTLS chain (denying if it fails) and then
	// runs authn.policy. Returns "" to deny.
	resolve := func() string {
		var certs []*x509.Certificate
		if pc != nil {
			certs = connPeerCerts(pc)
		}
		verified, err := pe.world.verifyMTLS(certs)
		if err != nil {
			// A certificate was presented but did not validate against our CA.
			slog.Warn("authn rejected unverifiable mTLS certificate", "source", peer.address, "error", err)
			return ""
		}
		return pe.evalAuthn(peer, isBufconn, verified)
	}

	var actor string
	if pc != nil {
		pc.idOnce.Do(func() { pc.actor = resolve() })
		actor = pc.actor
	} else {
		actor = resolve()
	}
	if actor == "" {
		slog.Warn("authn denied connection", "source", peer.address)
		return "", connect.NewError(connect.CodePermissionDenied, fmt.Errorf("connection identity denied"))
	}
	return actor, nil
}

// connPeerCerts returns the mTLS peer certificates a connection presented (leaf
// first), or nil when there is no client certificate. The accepted connection is
// wrapped (trackedConn → peekedConn → *tls.Conn after the mux terminates TLS), so
// it walks the Unwrap chain until it reaches the *tls.Conn.
func connPeerCerts(pc *peerConn) []*x509.Certificate {
	if pc == nil {
		return nil
	}
	c := pc.conn
	for c != nil {
		if tlsConn, ok := c.(*tls.Conn); ok {
			return tlsConn.ConnectionState().PeerCertificates
		}
		u, ok := c.(interface{ Unwrap() net.Conn })
		if !ok {
			return nil
		}
		c = u.Unwrap()
	}
	return nil
}

// evalAuthn runs the authn.policy chain to resolve a connection's actor identity.
// Each rule's CEL returns a string; the first non-empty result wins ("" = deny).
// When authn.policy is absent it falls back to: trusted → trusted.actor, else
// anonymous, so a node is never left unreachable.
func (pe *PolicyEvaluator) evalAuthn(peer peerContext, isBufconn bool, verified *verifiedCert) string {
	pe.mu.RLock()
	rules := pe.authnRules
	pe.mu.RUnlock()

	// source.mtls.verified carries only cryptographically validated identity (the
	// connection is denied before we get here if a presented cert failed to
	// validate); fields are empty when no client certificate was presented.
	mtls := map[string]any{"cn": "", "fingerprint": "", "ca": "", "self": false}
	if verified != nil {
		mtls["cn"] = verified.cn
		mtls["fingerprint"] = verified.fingerprint
		mtls["ca"] = verified.ca
		mtls["self"] = verified.self
	}

	flags := newIsFlags()
	flags["local"] = peer.local
	flags["builtin"] = isBufconn
	act := map[string]any{
		"is": flags,
		"source": map[string]any{
			"address": peer.address,
			"port":    peer.port,
			"mtls":    map[string]any{"verified": mtls},
		},
		// Keep the shared CEL env satisfied; unused by authn rules.
		"actor":  map[string]any{"id": ""},
		"method": "",
		"path":   "",
		"change": &pb.Entity{},
	}

	if len(rules) == 0 {
		// Mirror the shipped authn.policy default so the node stays governable even
		// with no policy entity loaded: loopback/in-process and a peer presenting
		// this node's own cert are admin; everyone else is anonymous.
		if peer.local || isBufconn || (verified != nil && verified.self) {
			return adminActorEntity
		}
		return anonymousEntity
	}
	for _, r := range rules {
		if r.program == nil {
			continue
		}
		out, _, err := r.program.Eval(act)
		if err != nil {
			slog.Warn("authn CEL eval error", "cel", r.celExpr, "error", err)
			continue
		}
		if s, ok := out.Value().(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func (i *policyInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	if i.pe == nil {
		return next
	}
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		ctx, err := i.authContext(ctx, req.Header(), req.Peer().Addr)
		if err != nil {
			return nil, err
		}
		if err := i.pe.check(ctx, req); err != nil {
			return nil, err
		}
		return next(ctx, req)
	}
}

// WrapStreamingClient is a no-op: this interceptor only guards the server side.
func (i *policyInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

// WrapStreamingHandler authenticates the stream and, for uploads, authorizes the
// target entity on the first received message (before any blob is stored).
func (i *policyInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	if i.pe == nil {
		return next
	}
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		ctx, err := i.authContext(ctx, conn.RequestHeader(), conn.Peer().Addr)
		if err != nil {
			return err
		}
		return next(ctx, &policyStreamConn{StreamingHandlerConn: conn, pe: i.pe, ctx: ctx})
	}
}

// policyStreamConn wraps a streaming handler connection to run a policy check on
// the first message of an upload, keyed by the target entity ID.
type policyStreamConn struct {
	connect.StreamingHandlerConn
	pe      *PolicyEvaluator
	ctx     context.Context
	checked bool
}

func (c *policyStreamConn) Receive(m any) error {
	if err := c.StreamingHandlerConn.Receive(m); err != nil {
		return err
	}
	if c.checked {
		return nil
	}
	c.checked = true
	switch req := m.(type) {
	case *pb.UploadArtifactRequest:
		entityID, _, _ := strings.Cut(req.GetId(), "/")
		return c.pe.checkArtifactStream(c.ctx, c.Spec().Procedure, c.Peer().Addr, entityID, true)
	case *pb.DownloadArtifactRequest:
		if idRef := req.GetId(); idRef != "" {
			entityID, _, _ := strings.Cut(idRef, "/")
			return c.pe.checkArtifactStream(c.ctx, c.Spec().Procedure, c.Peer().Addr, entityID, false)
		}
	}
	return nil
}

// checkArtifactStream authorizes a streaming artifact transfer for entityID
// before any bytes are read or written. write distinguishes upload from
// download so the credential/identity gates (which differ for read vs write)
// apply correctly.
func (pe *PolicyEvaluator) checkArtifactStream(ctx context.Context, proc, peerAddr, entityID string, write bool) error {
	pe.mu.RLock()
	rules := pe.rules
	pe.mu.RUnlock()
	if len(rules) == 0 {
		return nil
	}
	isBuiltin, _ := ctx.Value(builtinConnKey).(bool)
	builtinName, _ := ctx.Value(builtinNameKey).(string)
	federationNode, _ := ctx.Value(federationNodeKey).(string)
	peer := parsePeer(peerAddr)
	ec := pe.evalCtxFor(peer, peer.local, isBuiltin, builtinName, federationNode, actorFromContext(ctx))
	f := newIsFlags()
	f["grpc"] = true
	if write {
		f["write"] = true
		f["upload"] = true
	} else {
		f["read"] = true
	}
	activation := buildGRPCActivation(ec, f, &pb.Entity{Id: entityID})
	v := pe.evalChain(rules, activation, 0)
	return verdictToError(v, proc, ec.peer)
}

// AllowMedia reports whether a media client from remoteAddr may access camera
// streams. Media is gated by the ordinary read entitlement: it evaluates the
// global policy as an anonymous read of a /media/ path (RTSP carries no
// per-request credentials, so the caller is anonymous). Localhost remains
// allowed via is.local.
func (pe *PolicyEvaluator) AllowMedia(remoteAddr string) bool {
	if pe == nil {
		return true
	}
	pe.mu.RLock()
	rules := pe.rules
	pe.mu.RUnlock()
	if len(rules) == 0 {
		return true
	}
	peer := parsePeer(remoteAddr)
	ec := pe.evalCtxFor(peer, peer.local, false, "", "", "")
	activation := buildHTTPActivation(ec, "GET", "/media/rtsp")
	return pe.evalChain(rules, activation, 0) != verdictDeny
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
		pc, _ := r.Context().Value(peerEntityKey).(*peerConn)
		actor, err := pe.resolveActor(pc, peer, false)
		if err != nil {
			slog.Warn("authn denied", "source", peer.address, "path", r.URL.Path)
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		ec := pe.evalCtxFor(peer, peer.local, false, "", "", actor)
		activation := buildHTTPActivation(ec, r.Method, r.URL.Path)
		// WHEP negotiates over POST but only consumes a stream, so gate it on
		// the read entitlement rather than cop_write. Other media routes (e.g.
		// /media/webcam/) keep method-based semantics: a POST there is a write.
		if strings.HasPrefix(r.URL.Path, "/media/whep/") {
			if f, ok := activation["is"].(map[string]bool); ok {
				f["read"] = true
				f["write"] = false
			}
		}
		// Bind the target entity for artifact routes so entity-scoped gates
		// (e.g. credential/identity protection on auth:* and secrets:*) and
		// Defer can evaluate against the real target rather than an empty one.
		entityID := artifactEntityFromPath(r.URL.Path)
		if entityID != "" {
			if ch, ok := activation["change"].(*pb.Entity); ok {
				ch.Id = entityID
			}
			if f, ok := activation["is"].(map[string]bool); ok && f["write"] {
				f["upload"] = true
			}
		}
		v := pe.evalChain(rules, activation, 0)
		if v == verdictDeny {
			slog.Warn("policy denied", "source", ec.peer.address, "actor", ec.actor, "path", r.URL.Path, "method", r.Method)
			http.Error(w, "policy denied", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// artifactEntityFromPath returns the entity ID addressed by an /artifacts/{id}
// or /artifacts/{id}/{key} request path, or "" for other paths. Entity IDs
// never contain '/', so the first path segment after the prefix is the id.
func artifactEntityFromPath(path string) string {
	const prefix = "/artifacts/"
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	rest := path[len(prefix):]
	if i := strings.IndexByte(rest, '/'); i >= 0 {
		return rest[:i]
	}
	return rest
}

// evalCtx bundles the per-request authorization inputs shared by every
// activation: the network peer, whether it is a loopback peer (local) and/or an
// in-process builtin caller (builtin), the originating builtin name (if any),
// and the authenticated actor identity.
type evalCtx struct {
	peer           peerContext
	local          bool
	builtin        bool
	federation     bool
	builtinName    string
	federationNode string
	actor          string
}

// evalCtxFor resolves the actor (defaulting to anonymous) and derives the scope
// flags. Identity now comes from authn.policy, so the scope flags simply report
// the connection's nature: is.local for loopback, is.builtin for in-process
// callers, and is.federation when the federation builtin relays a remote node.
func (pe *PolicyEvaluator) evalCtxFor(peer peerContext, local, builtin bool, builtinName, federationNode, actor string) evalCtx {
	if actor == "" {
		actor = anonymousEntity
	}
	federation := builtin && builtinName == "federation"
	if !federation {
		federationNode = ""
	}
	return evalCtx{peer: peer, local: local, builtin: builtin, federation: federation, builtinName: builtinName, federationNode: federationNode, actor: actor}
}

func (pe *PolicyEvaluator) check(ctx context.Context, req connect.AnyRequest) error {
	pe.mu.RLock()
	rules := pe.rules
	pe.mu.RUnlock()

	if len(rules) == 0 {
		return nil
	}

	peerInfo := parsePeer(req.Peer().Addr)
	isBuiltin, _ := ctx.Value(builtinConnKey).(bool)
	builtinName, _ := ctx.Value(builtinNameKey).(string)
	federationNode, _ := ctx.Value(federationNodeKey).(string)
	ec := pe.evalCtxFor(peerInfo, peerInfo.local, isBuiltin, builtinName, federationNode, actorFromContext(ctx))

	proc := req.Spec().Procedure

	switch m := req.Any().(type) {
	case *pb.EntityChangeRequest:
		return pe.checkEntityChange(ec, proc, rules, m)

	case *pb.ExpireEntityRequest:
		return pe.checkSingleEntity(ec, proc, rules, m.Id, isFlags("expire"))

	case *pb.RunTaskRequest:
		return pe.checkSingleEntity(ec, proc, rules, m.EntityId, isFlags("task"))

	default:
		flags := isReadFlags(proc)
		activation := buildGRPCActivation(ec, flags, &pb.Entity{})
		v := pe.evalChain(rules, activation, 0)
		return verdictToError(v, proc, ec.peer)
	}
}

func (pe *PolicyEvaluator) checkEntityChange(ec evalCtx, proc string, rules []compiledRule, m *pb.EntityChangeRequest) error {
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
		f["write"] = true
		f["push"] = true
		f["replace"] = true
		items = append(items, evalItem{flags: f, entityID: e.Id, change: e})
	}
	pe.world.l.RUnlock()

	for _, item := range items {
		activation := buildGRPCActivation(ec, item.flags, item.change)
		v := pe.evalChain(rules, activation, 0)
		if v == verdictDeny {
			slog.Warn("policy denied", "source", ec.peer.address, "actor", ec.actor, "procedure", proc, "entity", item.entityID)
			return connect.NewError(connect.CodePermissionDenied,
				fmt.Errorf("policy denied %s on entity %s", proc, item.entityID))
		}
	}
	return nil
}

func (pe *PolicyEvaluator) checkSingleEntity(ec evalCtx, proc string, rules []compiledRule, entityID string, flags map[string]bool) error {
	change := &pb.Entity{}
	if entityID != "" {
		change.Id = entityID
	}
	activation := buildGRPCActivation(ec, flags, change)
	v := pe.evalChain(rules, activation, 0)
	return verdictToError(v, proc, ec.peer)
}

func newIsFlags() map[string]bool {
	return map[string]bool{
		"http": false, "grpc": false, "local": false, "builtin": false, "federation": false,
		"read": false, "write": false,
		"get": false, "list": false, "watch": false,
		"push": false, "create": false, "update": false, "replace": false,
		"expire": false, "task": false, "reset": false, "upload": false,
	}
}

// isFlags and isReadFlags set only operation flags; scope (local/builtin/
// federation) is stamped centrally in buildActivation from the eval context.
func isFlags(op string) map[string]bool {
	f := newIsFlags()
	f["grpc"] = true
	f["write"] = true
	f[op] = true
	return f
}

func isReadFlags(proc string) map[string]bool {
	f := newIsFlags()
	f["grpc"] = true
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

func buildHTTPActivation(ec evalCtx, method, path string) map[string]any {
	isRead := method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
	f := newIsFlags()
	f["http"] = true
	f["read"] = isRead
	f["write"] = !isRead
	f["get"] = method == http.MethodGet
	a := buildActivation(ec, f, &pb.Entity{})
	a["method"] = method
	a["path"] = path
	return a
}

func buildGRPCActivation(ec evalCtx, flags map[string]bool, change *pb.Entity) map[string]any {
	if change == nil {
		change = &pb.Entity{}
	}
	return buildActivation(ec, flags, change)
}

// buildActivation assembles the CEL activation shared by HTTP and gRPC checks.
func buildActivation(ec evalCtx, flags map[string]bool, change *pb.Entity) map[string]any {
	// Scope flags are authoritative from the eval context, so every caller
	// agrees on locality/builtin/federation regardless of how it built `flags`.
	flags["local"] = ec.local
	flags["builtin"] = ec.builtin
	flags["federation"] = ec.federation
	return map[string]any{
		"source": map[string]any{
			"address": ec.peer.address,
			"port":    ec.peer.port,
			"builtin": ec.builtinName,
			"node":    ec.federationNode,
		},
		"actor": map[string]any{
			"id": ec.actor,
		},
		"is":     flags,
		"method": "",
		"path":   "",
		"change": change,
	}
}

// maxDeferDepth bounds nested Defer jumps before failing closed (cycle guard).
const maxDeferDepth = 5

func (pe *PolicyEvaluator) evalChain(rules []compiledRule, activation map[string]any, depth int) policyVerdict {
	for _, rule := range rules {
		if rule.action == pb.PolicyAction_PolicyActionDefer {
			if v := pe.evalDefer(rule, activation, depth); v != verdictNone {
				return v
			}
			continue
		}
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
		}
	}
	return verdictNone
}

// evalDefer resolves a Defer: its CEL names the target entity whose policy chain
// to jump to (empty = no jump). A non-string result, an eval error, or an id
// naming no entity fails closed. An existing entity with no policy, or whose
// chain reaches no verdict, returns to the calling chain.
func (pe *PolicyEvaluator) evalDefer(rule compiledRule, activation map[string]any, depth int) policyVerdict {
	if depth >= maxDeferDepth {
		slog.Warn("policy defer depth exceeded", "cel", rule.celExpr, "depth", depth)
		return verdictDeny
	}
	if rule.program == nil {
		return verdictNone
	}
	out, _, err := rule.program.Eval(activation)
	if err != nil {
		slog.Warn("policy defer CEL eval error", "cel", rule.celExpr, "error", err)
		return verdictDeny
	}
	target, ok := out.Value().(string)
	if !ok {
		slog.Warn("policy defer target is not an entity id", "cel", rule.celExpr)
		return verdictDeny
	}
	if target == "" {
		return verdictNone
	}
	entityRules, exists := pe.entityPolicy(target)
	if !exists {
		slog.Warn("policy defer target names no entity", "cel", rule.celExpr, "target", target)
		return verdictDeny
	}
	if len(entityRules) == 0 {
		return verdictNone
	}
	return pe.evalChain(entityRules, activation, depth+1)
}

// entityPolicy returns the compiled policy chain of an entity and whether the
// entity exists at all. An existing entity with no PolicyComponent returns
// (nil, true); a missing entity returns (nil, false).
func (pe *PolicyEvaluator) entityPolicy(entityID string) ([]compiledRule, bool) {
	pe.world.l.RLock()
	defer pe.world.l.RUnlock()

	es, ok := pe.world.head[entityID]
	if !ok {
		return nil, false
	}
	pc := es.entity.GetPolicy()
	if pc == nil {
		return nil, true
	}
	return pe.compileChain(pc), true
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
