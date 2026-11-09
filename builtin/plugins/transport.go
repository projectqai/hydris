package plugins

import (
	"context"
	"fmt"
	"net"
	"net/http"

	"github.com/projectqai/hydris/builtin"
)

// RequestedActorHeader is the header a plugin sets to push as one of the extra
// identities its package.json declares (hydris.actors). The host validates it
// against that list and stamps the trusted X-Builtin-Actor from it; anything
// undeclared fails the request.
const RequestedActorHeader = "X-Plugin-Actor"

// claimedActorHeader carries the identities the plugin's package.json declares,
// one value each. The engine exposes them to policy as actor.plugin.actors,
// which is what lets authz.policy grant a plugin the entities of its own
// identities. The claim is the plugin's: a request pushed as one of those
// identities carries none.
const claimedActorHeader = "X-Builtin-Claimed-Actor"

// NewPluginClient routes a plugin's engine traffic over the bufconn, tagged with
// the plugins builtin name and the plugin's actor. The engine authorizes every
// push against that actor's policy and stamps it onto every component the
// plugin writes. Bufconn-only, so a plugin can't forge this from outside.
func NewPluginClient(dir string, info PluginInfo) *http.Client {
	return &http.Client{Transport: newPluginTransport(dir, info, &http.Transport{DialContext: dialBuiltin})}
}

func dialBuiltin(ctx context.Context, _, _ string) (net.Conn, error) {
	return builtin.GetBuiltinListener().DialContext(ctx)
}

// newPluginTransport stamps the plugin's identity on each request and sends it
// to the engine through base.
func newPluginTransport(dir string, info PluginInfo, base http.RoundTripper) *pluginTransport {
	actor, extra := Actors(dir, info)
	allowed := make(map[string]bool, len(extra)+1)
	allowed[actor] = true
	for _, a := range extra {
		allowed[a] = true
	}
	return &pluginTransport{actor: actor, allowed: allowed, claimed: extra, base: base}
}

type pluginTransport struct {
	actor   string
	allowed map[string]bool
	claimed []string
	base    http.RoundTripper
}

func (t *pluginTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	actor := t.actor
	if requested := req.Header.Get(RequestedActorHeader); requested != "" {
		if !t.allowed[requested] {
			return nil, fmt.Errorf("actor %q is not declared in the plugin's package.json", requested)
		}
		actor = requested
		req.Header.Del(RequestedActorHeader)
	}
	// Strip any trusted-identity header the plugin JS set before we stamp ours:
	// the engine trusts these on the bufconn, so the plugin must not forge them.
	for name := range req.Header {
		if builtin.IsTrustedHeader(name) {
			req.Header.Del(name)
		}
	}
	req.Header.Set("X-Builtin-Name", controllerName)
	req.Header.Set("X-Builtin-Actor", actor)
	if actor == t.actor {
		for _, a := range t.claimed {
			req.Header.Add(claimedActorHeader, a)
		}
	}
	return t.base.RoundTrip(req)
}
