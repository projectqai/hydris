package plugins

import (
	"net/http"
	"strings"
	"testing"
)

type captureRT struct{ req *http.Request }

func (c *captureRT) RoundTrip(r *http.Request) (*http.Response, error) {
	c.req = r
	return &http.Response{StatusCode: 200, Body: http.NoBody}, nil
}

func TestPluginTransportStampsTheActor(t *testing.T) {
	base := &captureRT{}
	tr := &pluginTransport{actor: "p.actor", allowed: map[string]bool{"p.actor": true, "p.air": true}, claimed: []string{"p.air"}, base: base}

	req, _ := http.NewRequest("POST", "http://hydris.builtin/x", strings.NewReader(""))
	req.Header.Set("X-Builtin-Actor", "admin.actor")
	req.Header.Set("X-Federation-Node", "elsewhere")
	req.Header.Set(claimedActorHeader, "admin.actor")
	if _, err := tr.RoundTrip(req); err != nil {
		t.Fatal(err)
	}
	if got := base.req.Header.Get("X-Builtin-Actor"); got != "p.actor" {
		t.Errorf("forged actor survived: %q", got)
	}
	if base.req.Header.Get("X-Federation-Node") != "" || base.req.Header.Get("X-Builtin-Name") != controllerName {
		t.Errorf("trusted headers = %v", base.req.Header)
	}
	if got := base.req.Header.Values(claimedActorHeader); len(got) != 1 || got[0] != "p.air" {
		t.Errorf("claimed actors = %v, want the declared ones and no forged one", got)
	}

	req, _ = http.NewRequest("POST", "http://hydris.builtin/x", strings.NewReader(""))
	req.Header.Set(RequestedActorHeader, "p.air")
	if _, err := tr.RoundTrip(req); err != nil {
		t.Fatal(err)
	}
	if got := base.req.Header.Get("X-Builtin-Actor"); got != "p.air" {
		t.Errorf("declared actor not honored: %q", got)
	}
	if got := base.req.Header.Values(claimedActorHeader); len(got) != 0 {
		t.Errorf("claimed actors = %v, want none: the claim is the plugin's, not the declared actor's", got)
	}
	if base.req.Header.Get(RequestedActorHeader) != "" {
		t.Error("the request header leaked through to the engine")
	}

	req, _ = http.NewRequest("POST", "http://hydris.builtin/x", strings.NewReader(""))
	req.Header.Set(RequestedActorHeader, "admin.actor")
	if _, err := tr.RoundTrip(req); err == nil {
		t.Error("an undeclared actor must fail the request")
	}
}
