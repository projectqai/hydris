package main

import (
	"log/slog"
	"strings"
	"testing"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestRosToken(t *testing.T) {
	for in, want := range map[string]string{
		"demo.ship":    "demo_ship",
		"ais.211234":   "ais_211234",
		"9lives":       "_9lives",
		"a..b--c":      "a_b_c",
		"a__b":         "a_b",
		"_x_":          "_x_",
		"":             "_",
		"ops-blue~1":   "ops_blue_1",
		"Track.ABC.01": "Track_ABC_01",
	} {
		if got := rosToken(in); got != want {
			t.Errorf("rosToken(%q) = %q, want %q", in, got, want)
		}
	}
}

func entityWithConfig(t *testing.T, v map[string]any) *pb.Entity {
	t.Helper()
	s, err := structpb.NewStruct(v)
	if err != nil {
		t.Fatal(err)
	}
	return &pb.Entity{Config: &pb.ConfigurationComponent{Value: s}}
}

func TestParseConfig(t *testing.T) {
	c, err := parseConfig(entityWithConfig(t, map[string]any{}))
	if err != nil {
		t.Fatal(err)
	}
	if c.topic != "/hydris/default" || c.encoding != encodingPB || c.maxTopics != 256 || c.perEntity {
		t.Errorf("defaults: %+v", c)
	}

	c, err = parseConfig(entityWithConfig(t, map[string]any{"channel": "ops.blue", "per_entity": true, "encoding": "json", "domain_id": 7.0}))
	if err != nil {
		t.Fatal(err)
	}
	if c.topic != "/hydris/ops_blue" || !c.perEntity || c.encoding != encodingJSON || c.domain != 7 {
		t.Errorf("channel: %+v", c)
	}

	c, err = parseConfig(entityWithConfig(t, map[string]any{"channel": "x", "topic": "/robots/in"}))
	if err != nil || c.topic != "/robots/in" {
		t.Errorf("topic override: %+v %v", c, err)
	}

	for _, bad := range []map[string]any{
		{"encoding": "xml"},
		{"domain_id": 233.0},
		{"domain_id": 1.5},
		{"max_topics": 0.0},
		{"topic": "relative"},
		{"topic": "/has.dot"},
	} {
		if _, err := parseConfig(entityWithConfig(t, bad)); err == nil {
			t.Errorf("%v: no error", bad)
		}
	}
}

func TestAdmit(t *testing.T) {
	in := &ingress{log: slog.New(slog.DiscardHandler), cfg: config{channel: "c2"}, localNode: "me"}
	own := &pb.Routing{Channels: []*pb.Channel{{Name: "other"}}}
	got := in.admit([]*pb.Entity{
		{Id: "ros.a"}, // from a plain ROS node
		{Id: "mine", Controller: &pb.Controller{Node: proto.String("me")}},
		{Id: "theirs", Controller: &pb.Controller{Node: proto.String("node.b")}},
		{Id: "routed", Routing: own},
	})
	var ids []string
	for _, e := range got {
		ids = append(ids, e.Id)
	}
	if strings.Join(ids, ",") != "ros.a,mine,routed" {
		t.Fatalf("admitted %v", ids)
	}
	if ch := got[0].GetRouting().GetChannels(); len(ch) != 1 || ch[0].GetName() != "c2" {
		t.Errorf("ros.a routing = %v, want channel c2", got[0].GetRouting())
	}
	if got[2].Routing != own {
		t.Errorf("own routing was replaced: %v", got[2].Routing)
	}
}
