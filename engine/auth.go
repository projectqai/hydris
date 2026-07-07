package engine

import "context"

// Reserved entity IDs for the authorization subsystem.
const (
	// anonymousEntity is the identity authn.policy maps a connection to when it
	// resolves to no trusted identity; policy rules may match it by actor.id.
	anonymousEntity = "auth:anonymous"
	// adminActorEntity is the identity authn.policy maps trusted (local /
	// in-process) connections to. Changes from trusted connections are attributed
	// to it, and authz.policy grants it via its allow-all entity policy.
	adminActorEntity = "admin.actor"
	// authzServiceEntity is the device parent of auth identities.
	authzServiceEntity = "authz.service"
	// authzPolicyEntity carries the global authorization chain (what an actor may
	// do), shipped in builtin/defaults.yaml and editable at runtime.
	authzPolicyEntity = "authz.policy"
	// authnPolicyEntity carries the chain that resolves *who* a connection is.
	authnPolicyEntity = "authn.policy"
)

// actorKey carries the resolved actor entity ID through the request context.
type actorKeyType struct{}

var actorKey actorKeyType

// actorFromContext returns the actor entity ID resolved for this connection,
// falling back to the anonymous identity when none was set.
func actorFromContext(ctx context.Context) string {
	if id, ok := ctx.Value(actorKey).(string); ok && id != "" {
		return id
	}
	return anonymousEntity
}
