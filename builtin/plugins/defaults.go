package plugins

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"connectrpc.com/connect"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/pkg/plugin"
	"github.com/projectqai/hydris/pkg/rt"
	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/_goconnect"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// A plugin pushes as an actor of its own (X-Builtin-Actor, stamped by
// pluginTransport), and authz.policy defers to the policy on that actor's
// entity. The plugin's own code runs as its install entity. Data it trusts less
// it may push as one of the identities its package.json lists under
// hydris.actors; those ids are fixed by the plugin, so its defaults.yaml can
// carry their policies. Without a policy the defer reaches no verdict and falls
// through to the default allow, so the host seeds one if nobody else did.
// The host pushes defaults.yaml as the plugin, so the file may ship any entity
// the plugin itself would be allowed to write; authz.policy lets a plugin write
// the policy of an identity it claims.

// Actors returns the plugin's own identity (its install entity) and the further
// identities it may push as (hydris.actors).
func Actors(dir string, info PluginInfo) (string, []string) {
	var extra []string
	if dir != "" {
		if pkg, err := plugin.ReadPackageJSON(dir); err == nil && pkg.Hydris != nil {
			extra = pkg.Hydris.Actors
		}
	}
	return info.EntityID, extra
}

// PluginDefaults reads the default entities shipped in dir (see
// plugin.DefaultsFile) and checks them the way the engine checks builtin
// defaults: every entity must carry a lifetime near the Unix epoch, so it loses
// the merge against anything an operator changed, and a bumped lifetime.fresh
// in the file is what ships a changed default. A missing file yields nil.
func PluginDefaults(dir string) ([]*pb.Entity, error) {
	if dir == "" {
		return nil, nil
	}
	b, err := os.ReadFile(filepath.Join(dir, plugin.DefaultsFile))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	entities, err := builtin.ParseEntities(b)
	if err != nil {
		return nil, err
	}
	year2000 := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, e := range entities {
		fresh := e.GetLifetime().GetFresh()
		if !fresh.IsValid() {
			fresh = e.GetLifetime().GetFrom()
		}
		if !fresh.IsValid() {
			return nil, fmt.Errorf("default entity %q has no lifetime.fresh; defaults carry an epoch+N timestamp so operator edits win and a bump ships an upgrade", e.Id)
		}
		if fresh.AsTime().After(year2000) {
			return nil, fmt.Errorf("default entity %q carries a real timestamp (%s); defaults must use small epoch+N offsets", e.Id, fresh.AsTime().Format(time.RFC3339))
		}
	}
	return entities, nil
}

// DefaultPluginPolicy is the actor policy of a plugin whose defaults declare
// none: read and write ordinary state. What no plugin may do regardless of its
// policy (grant authority, touch policy-bearing entities, reset the node) is
// enforced by authz.policy in builtin/defaults.yaml, ahead of the defer.
func DefaultPluginPolicy() *pb.PolicyComponent {
	return &pb.PolicyComponent{Rules: []*pb.PolicyRule{
		{Action: pb.PolicyAction_PolicyActionAllow, Cel: celStr(`is.read || is.write`), Label: celStr("ordinary state")},
		{Action: pb.PolicyAction_PolicyActionDeny, Label: celStr("fail closed")},
	}}
}

func celStr(s string) *string { return &s }

// getEntity returns nil for an entity that does not exist. Any other failure is
// an error: the callers decide on authority and must not read one as absence.
func getEntity(ctx context.Context, id string) (*pb.Entity, error) {
	conn, err := builtin.BuiltinClientConn(controllerName)
	if err != nil {
		return nil, err
	}
	defer func() { _ = conn.Close() }()
	resp, err := pb.NewWorldServiceClient(conn).GetEntity(ctx, &pb.GetEntityRequest{Id: id})
	if status.Code(err) == codes.NotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("look up identity %q: %w", id, err)
	}
	return resp.GetEntity(), nil
}

// actorMark is the controller the host stamps on a plugin identity: its own
// name on the install entity, and the install entity on an identity the plugin
// declared (hydris.actors), which ties that identity to the plugin owning it.
func actorMark(actor string, info PluginInfo) *pb.Controller {
	if actor == info.EntityID {
		return &pb.Controller{Id: proto.String(controllerName)}
	}
	return &pb.Controller{Id: proto.String(info.EntityID)}
}

// checkActor refuses an identity the plugin may not run as. Running as an
// existing identity inherits its authority, so the install entity may only
// carry a policy the host knows of (admin.actor, say, is refused), and a
// declared identity must be new or marked as this plugin's on an earlier start.
func checkActor(existing *pb.Entity, actor string, info PluginInfo) error {
	if existing == nil {
		return nil
	}
	owner := existing.GetController().GetId()
	if actor == info.EntityID {
		if existing.GetPolicy() != nil && owner != controllerName {
			return fmt.Errorf("%w: plugin %q would run as existing identity %q", controller.ErrConflict, info.Name, actor)
		}
		return nil
	}
	if info.EntityID == "" || owner != info.EntityID {
		return fmt.Errorf("%w: plugin %q declares identity %q, which exists and belongs to %q", controller.ErrConflict, info.Name, actor, owner)
	}
	return nil
}

// pushDefaults pushes through the plugin's client, the way the plugin's own
// code does: as the plugin, claiming its identities. authz.policy and the
// plugin's policy decide what is written.
func pushDefaults(ctx context.Context, info PluginInfo, dir string, entities []*pb.Entity) error {
	httpClient := NewPluginClient(dir, info)
	defer httpClient.CloseIdleConnections()
	client := _goconnect.NewWorldServiceClient(httpClient, "http://hydris.builtin")
	_, err := client.Push(ctx, connect.NewRequest(&pb.EntityChangeRequest{Changes: entities}))
	return err
}

// prepareActors makes sure every identity the plugin may push as is its own
// and carries a policy, then pushes the plugin's defaults as the plugin.
// Anything that leaves the identities in doubt, and any default that policy
// denies, stops the plugin from starting.
func prepareActors(ctx context.Context, info PluginInfo, dir string) error {
	actor, extra := Actors(dir, info)
	actors := append([]string{actor}, extra...)
	for _, a := range actors {
		existing, err := getEntity(ctx, a)
		if err != nil {
			return err
		}
		if err := checkActor(existing, a, info); err != nil {
			return err
		}
	}

	defaults, err := PluginDefaults(dir)
	if err != nil {
		return fmt.Errorf("%w: plugin %q defaults: %w", controller.ErrConflict, info.Name, err)
	}
	// Without an actor the push would count as the host's own.
	if len(defaults) > 0 && actor == "" {
		return fmt.Errorf("%w: plugin %q has no install entity to push its defaults as", controller.ErrConflict, info.Name)
	}

	for _, a := range actors {
		if err := markActor(ctx, a, info); err != nil {
			return err
		}
	}

	if len(defaults) > 0 {
		err := pushDefaults(ctx, info, dir, defaults)
		if connect.CodeOf(err) == connect.CodePermissionDenied {
			return fmt.Errorf("%w: plugin %q defaults: %w", controller.ErrConflict, info.Name, err)
		}
		if err != nil {
			return fmt.Errorf("push plugin defaults: %w", err)
		}
	}
	return nil
}

// markActor stamps the host's controller on an actor entity, seeding the
// fallback policy first when nobody else gave it one. The fallback carries the
// epoch itself, so a policy from the plugin's defaults replaces it.
func markActor(ctx context.Context, actor string, info PluginInfo) error {
	existing, err := getEntity(ctx, actor)
	if err != nil {
		return err
	}
	// The host marks the actor entity as its own; that mark is what the check
	// above trusts on the next start.
	mark := &pb.Entity{Id: actor, Controller: actorMark(actor, info)}
	if existing.GetPolicy() == nil {
		epoch := timestamppb.New(time.Unix(0, 0))
		mark.Policy = DefaultPluginPolicy()
		mark.Lifetime = &pb.Lifetime{From: epoch, Fresh: epoch}
		if err := controller.Push(ctx, controllerName, mark); err != nil {
			return fmt.Errorf("seed plugin policy: %w", err)
		}
		mark = &pb.Entity{Id: actor, Controller: actorMark(actor, info)}
	}
	if err := controller.Push(ctx, controllerName, mark); err != nil {
		return fmt.Errorf("mark plugin actor: %w", err)
	}
	return nil
}

// runNativeDir runs the plugin in dir if it is native; ok is false for a JS
// plugin, which the caller runs instead.
func runNativeDir(ctx context.Context, info PluginInfo, dir string) (ok bool, err error) {
	bin, err := plugin.NativeBinary(dir)
	if err != nil {
		return true, err
	}
	if bin == "" {
		return false, nil
	}
	return true, runNative(ctx, info, dir, bin)
}

// runBundle prepares the plugin's identities, then runs the bundle as them.
// Every plugin source (local file, OCI image, artifact) ends here.
func runBundle(ctx context.Context, info PluginInfo, bundlePath, dataDir, serverURL string) error {
	if err := prepareActors(ctx, info, dataDir); err != nil {
		return err
	}
	return rt.RunPluginEnv(ctx, bundlePath, dataDir, serverURL, NewPluginClient(dataDir, info))
}
