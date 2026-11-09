package main

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/projectqai/hydris/plugins/ros2/dds"
	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/sdk"
	"golang.org/x/sync/errgroup"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const controllerName = "ros2"

const (
	encodingPB   = "pb"
	encodingJSON = "json"
)

// Run is the plugin: sdk.Main runs it (see main.go).
func Run(ctx context.Context, logger *slog.Logger) error {
	serviceEntityID := controllerName + ".service"

	if err := sdk.Push(ctx, &pb.Entity{
		Id:         serviceEntityID,
		Label:      proto.String("ROS 2"),
		Controller: &pb.Controller{Id: proto.String(controllerName)},
		Device:     &pb.DeviceComponent{Category: proto.String("Network")},
		Configurable: &pb.ConfigurableComponent{
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{
					Class:       "channel",
					Label:       "Channel",
					Description: "Bridge a hydris routing channel and a ROS 2 topic, both ways. Changes of entities routed to the channel are published as world.EntityChangeEvent; world.EntityChangeRequest messages on the topic are pushed into the world, routed to the channel.",
				},
			},
		},
		Interactivity: &pb.InteractivityComponent{Icon: proto.String("bot")},
	}); err != nil {
		return fmt.Errorf("publish device: %w", err)
	}

	classes := []sdk.DeviceClass{
		{Class: "channel", Label: "ROS 2 Channel", Schema: schema()},
	}

	return sdk.WatchChildren(ctx, serviceEntityID, classes, func(ctx context.Context, entityID string) error {
		return sdk.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			if class := entity.Device.GetClass(); class != "channel" {
				return fmt.Errorf("unknown device class: %s", class)
			}
			cfg, err := parseConfig(entity)
			if err != nil {
				return fmt.Errorf("%w: %w", sdk.ErrConflict, err)
			}
			return runChannel(ctx, logger.With("entity", entityID, "channel", cfg.channel, "topic", cfg.topic), entity, cfg, ready)
		})
	})
}

func schema() *structpb.Struct {
	s, err := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"channel": map[string]any{
				"type":        "string",
				"title":       "Channel",
				"description": "Hydris routing channel to bridge. Empty is the default channel.",
				"default":     "",
			},
			"topic": map[string]any{
				"type":           "string",
				"title":          "Topic",
				"description":    "ROS 2 topic. Default /hydris/<channel>, /hydris/default for the default channel.",
				"ui:placeholder": "/hydris/<channel>",
			},
			"per_entity": map[string]any{
				"type":        "boolean",
				"title":       "Topic per Entity",
				"description": "Publish each entity on <topic>/<id>, keeping its last state for late subscribers. Incoming messages are still read from <topic>.",
				"default":     false,
			},
			"max_topics": map[string]any{
				"type":        "integer",
				"title":       "Max Topics",
				"description": "With a topic per entity: how many topics at most. Entities beyond are not published.",
				"minimum":     1,
				"default":     256,
			},
			"encoding": map[string]any{
				"type":        "string",
				"title":       "Encoding",
				"description": "pb: protobuf bytes in std_msgs/msg/UInt8MultiArray. json: protobuf JSON in std_msgs/msg/String, readable with ros2 topic echo.",
				"enum":        []any{encodingPB, encodingJSON},
				"default":     encodingPB,
			},
			"domain_id": map[string]any{
				"type":        "integer",
				"title":       "Domain ID",
				"description": "ROS_DOMAIN_ID of the ROS 2 nodes to talk to",
				"minimum":     0,
				"maximum":     232,
				"default":     0,
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return s
}

type config struct {
	channel   string
	topic     string
	perEntity bool
	maxTopics int
	encoding  string
	domain    uint32
}

func parseConfig(e *pb.Entity) (config, error) {
	c := config{maxTopics: 256, encoding: encodingPB}
	f := e.GetConfig().GetValue().GetFields()
	str := func(k string, dst *string) {
		if v, ok := f[k]; ok && v.GetStringValue() != "" {
			*dst = v.GetStringValue()
		}
	}
	str("channel", &c.channel)
	str("topic", &c.topic)
	str("encoding", &c.encoding)
	if v, ok := f["per_entity"]; ok {
		c.perEntity = v.GetBoolValue()
	}
	if v, ok := f["max_topics"]; ok {
		n := v.GetNumberValue()
		if n < 1 || n != float64(int(n)) {
			return c, fmt.Errorf("max_topics %v: want a positive integer", n)
		}
		c.maxTopics = int(n)
	}
	if v, ok := f["domain_id"]; ok {
		n := v.GetNumberValue()
		if n < 0 || n > 232 || n != float64(uint32(n)) {
			return c, fmt.Errorf("domain_id %v: want an integer 0-232", n)
		}
		c.domain = uint32(n)
	}
	if c.encoding != encodingPB && c.encoding != encodingJSON {
		return c, fmt.Errorf("encoding %q: want %q or %q", c.encoding, encodingPB, encodingJSON)
	}
	if c.topic == "" {
		name := "default"
		if c.channel != "" {
			name = rosToken(c.channel)
		}
		c.topic = "/hydris/" + name
	}
	if err := dds.CheckTopic(c.topic); err != nil {
		return c, err
	}
	return c, nil
}

// rosToken turns s into one legal ROS name token: letters, digits and
// single underscores, not starting with a digit. demo.ship is demo_ship.
func rosToken(s string) string {
	var b strings.Builder
	under := false
	for _, r := range s {
		if r == '_' || !alnum(r) {
			if !under {
				b.WriteByte('_')
			}
			under = true
			continue
		}
		if b.Len() == 0 && r >= '0' && r <= '9' {
			b.WriteByte('_')
		}
		b.WriteRune(r)
		under = false
	}
	if b.Len() == 0 {
		return "_"
	}
	return b.String()
}

func alnum(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
}

func (c config) rosType() dds.Type {
	if c.encoding == encodingJSON {
		return dds.String
	}
	return dds.Bytes
}

func (c config) marshal(m proto.Message) ([]byte, error) {
	if c.encoding == encodingJSON {
		return protojson.MarshalOptions{UseProtoNames: true}.Marshal(m)
	}
	return proto.Marshal(m)
}

// unmarshal decodes a message sent by any version of hydris: fields this
// version does not know are dropped.
func (c config) unmarshal(b []byte, m proto.Message) error {
	if c.encoding == encodingJSON {
		return protojson.UnmarshalOptions{DiscardUnknown: true}.Unmarshal(b, m)
	}
	return proto.Unmarshal(b, m)
}

func runChannel(ctx context.Context, log *slog.Logger, entity *pb.Entity, cfg config, ready func()) (err error) {
	st := newStatus(entity)
	defer func() {
		if err != nil && ctx.Err() == nil {
			st.failed(err)
		}
	}()

	d, err := dds.Open(cfg.domain)
	if err != nil {
		return err
	}
	defer func() { _ = d.Close() }()

	conn, err := sdk.Dial()
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	world := pb.NewWorldServiceClient(conn)

	g, gctx := errgroup.WithContext(ctx)
	out, err := newEgress(gctx, log, cfg, st, d, world)
	if err != nil {
		return err
	}
	in, err := newIngress(gctx, log, cfg, st, d, world)
	if err != nil {
		return err
	}
	g.Go(out.run)
	g.Go(in.run)
	g.Go(func() error { return st.report(gctx, world) })
	ready()
	return g.Wait()
}

// egress publishes the entities routed to the channel.
type egress struct {
	log    *slog.Logger
	cfg    config
	st     *status
	d      *dds.Domain
	stream pb.WorldService_WatchEntitiesClient

	shared *dds.Writer // without per_entity

	// per_entity: the writer of each topic, the entities on it, and the
	// topic of each entity. Two ids that sanitize alike share a topic.
	topics map[string]*fanout
	byID   map[string]string
	full   bool // max_topics reached; logged once until a topic frees
}

type fanout struct {
	w   *dds.Writer
	ids map[string]struct{}
}

func newEgress(ctx context.Context, log *slog.Logger, cfg config, st *status, d *dds.Domain, world pb.WorldServiceClient) (*egress, error) {
	e := &egress{log: log, cfg: cfg, st: st, d: d, topics: map[string]*fanout{}, byID: map[string]string{}}
	if !cfg.perEntity {
		w, err := d.Writer(cfg.topic, cfg.rosType(), dds.QoS{Depth: 1000})
		if err != nil {
			return nil, err
		}
		e.shared = w
		st.topics.Store(1)
	}
	stream, err := sdk.WatchEntitiesWithRetry(ctx, world, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{Channel: &pb.ChannelFilter{Name: cfg.channel}},
	})
	if err != nil {
		return nil, err
	}
	e.stream = stream
	return e, nil
}

func (e *egress) run() error {
	for {
		ev, err := e.stream.Recv()
		if err != nil {
			return err
		}
		id := ev.Entity.GetId()
		if id == "" {
			continue
		}
		// After an expired or unobserved event, the last on an entity's
		// topic, the topic goes.
		gone := ev.T == pb.EntityChange_EntityChangeExpired || ev.T == pb.EntityChange_EntityChangeUnobserved
		b, err := e.cfg.marshal(ev)
		if err != nil {
			e.log.Warn("encode event", "id", id, "error", err)
			e.st.dropped.Add(1)
			continue
		}
		if err := e.publish(id, b, gone); err != nil {
			return fmt.Errorf("publish %s: %w", id, err)
		}
		e.st.topics.Store(int64(max(len(e.topics), boolInt(e.shared != nil))))
	}
}

// publish writes one message, counting it when it went out.
func (e *egress) publish(id string, b []byte, gone bool) error {
	if e.shared != nil {
		return e.count(e.shared.Write(b), b)
	}
	topic, known := e.byID[id]
	if !known {
		if gone {
			return nil
		}
		topic = e.cfg.topic + "/" + rosToken(id)
	}
	f := e.topics[topic]
	if f == nil {
		if len(e.topics) >= e.cfg.maxTopics {
			if !e.full {
				e.log.Warn("max_topics reached, not publishing new entities", "max_topics", e.cfg.maxTopics)
				e.st.setDegraded(fmt.Sprintf("max_topics %d reached: new entities are not published", e.cfg.maxTopics))
				e.full = true
			}
			return nil
		}
		// Transient local with depth 1: a late subscriber gets the
		// entity's current state.
		w, err := e.d.Writer(topic, e.cfg.rosType(), dds.QoS{TransientLocal: true, Depth: 1})
		if err != nil {
			return err
		}
		f = &fanout{w: w, ids: map[string]struct{}{}}
		e.topics[topic] = f
	}
	f.ids[id] = struct{}{}
	e.byID[id] = topic
	if err := e.count(f.w.Write(b), b); err != nil {
		return err
	}
	if gone {
		delete(e.byID, id)
		delete(f.ids, id)
		if len(f.ids) == 0 {
			delete(e.topics, topic)
			if e.full {
				e.full = false
				e.st.setDegraded("")
			}
			return f.w.Close()
		}
	}
	return nil
}

func (e *egress) count(err error, b []byte) error {
	if err == nil {
		e.st.published.Add(1)
		e.st.publishedBytes.Add(uint64(len(b)))
	}
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ingress pushes EntityChangeRequests from the topic into the world.
type ingress struct {
	ctx       context.Context
	log       *slog.Logger
	cfg       config
	st        *status
	r         *dds.Reader
	world     pb.WorldServiceClient
	localNode string
}

func newIngress(ctx context.Context, log *slog.Logger, cfg config, st *status, d *dds.Domain, world pb.WorldServiceClient) (*ingress, error) {
	r, err := d.Reader(cfg.topic, cfg.rosType())
	if err != nil {
		return nil, err
	}
	local, err := world.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return nil, fmt.Errorf("get local node: %w", err)
	}
	return &ingress{ctx: ctx, log: log, cfg: cfg, st: st, r: r, world: world, localNode: local.Entity.Controller.GetNode()}, nil
}

func (in *ingress) run() error {
	for in.ctx.Err() == nil {
		msgs, err := in.r.Take(200 * time.Millisecond)
		if err != nil {
			return err
		}
		for _, b := range msgs {
			in.st.received.Add(1)
			in.st.receivedBytes.Add(uint64(len(b)))
			req := &pb.EntityChangeRequest{}
			if err := in.cfg.unmarshal(b, req); err != nil {
				in.log.Warn("dropped message: not a world.EntityChangeRequest", "error", err, "bytes", len(b))
				in.st.dropped.Add(1)
				continue
			}
			req.Changes = in.admit(req.Changes)
			req.Replacements = in.admit(req.Replacements)
			if len(req.Changes) == 0 && len(req.Replacements) == 0 {
				continue
			}
			// One bad message from ROS must not stop the others: a
			// rejected push is logged, not returned.
			if _, err := in.world.Push(in.ctx, req); err != nil {
				if in.ctx.Err() != nil {
					return nil
				}
				in.log.Warn("push rejected", "error", err)
				in.st.dropped.Add(1)
				continue
			}
			in.st.pushed.Add(uint64(len(req.Changes) + len(req.Replacements)))
		}
	}
	return nil
}

// admit drops entities another hydris node controls, which Push would
// reject; that is what keeps two bridged nodes from looping. The rest are
// routed to the channel unless they carry their own routing.
func (in *ingress) admit(es []*pb.Entity) []*pb.Entity {
	kept := es[:0]
	for _, e := range es {
		if n := e.GetController().GetNode(); n != "" && n != in.localNode {
			in.log.Debug("dropped entity of another node", "id", e.Id, "node", n)
			continue
		}
		if e.Routing == nil {
			e.Routing = &pb.Routing{Channels: []*pb.Channel{{Name: in.cfg.channel}}}
		}
		kept = append(kept, e)
	}
	return kept
}
