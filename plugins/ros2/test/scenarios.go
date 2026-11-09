package main

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

var scenarios = []scenario{
	{"basic", testBasic},
	{"loop", testLoop},
	{"scale", testScale},
	{"rate", testRate},
	{"large", testLarge},
	{"restart", testRestart},
	{"arm64", testArm64},
}

// testBasic bridges one channel: an entity routed to it reaches ROS, and an
// EntityChangeRequest from ROS reaches the world, routed to it.
func testBasic(t *T) {
	h := t.startHydris("h")
	ros := t.startROS()
	h.installPlugin()
	h.channel("ros2.ch.basic", map[string]any{"channel": "basic", "encoding": "json", "domain_id": t.r.domain})

	heard := ros.listen("/hydris/basic", "string", 12, false)
	time.Sleep(5 * time.Second)
	h.push(routed("basic.out", "basic"))
	if res := <-heard; res.IDs["basic.out"] == 0 {
		t.Errorf("basic.out not heard on /hydris/basic: %v", res.IDs)
	}

	ros.publish("/hydris/basic", "string", []byte(`{"changes":[{"id":"basic.in","label":"from ros"}]}`), 1)
	t.waitFor("basic.in from ROS", 20*time.Second, func() (bool, string) {
		ch := h.get("ros2.ch.basic")
		return h.get("basic.in") != nil, fmt.Sprintf("missing; channel received %d, dropped %d",
			metric(ch, "messages received"), metric(ch, "messages dropped"))
	})
}

// testLoop bridges one channel in both directions on two hydris nodes on
// the same domain. An entity of one node must not enter the other, and an
// entity from ROS enters both and then goes quiet instead of bouncing.
func testLoop(t *T) {
	a, b := t.startHydris("a"), t.startHydris("b")
	ros := t.startROS()
	for _, h := range []*Hydris{a, b} {
		h.installPlugin()
		h.channel("ros2.ch.loop", map[string]any{"channel": "loop", "encoding": "json", "domain_id": t.r.domain})
	}

	heard := ros.listen("/hydris/loop", "string", 25, false)
	time.Sleep(5 * time.Second)
	a1 := routed("loop.a1", "loop")
	a1.Label = proto.String("from a")
	a.push(a1)
	ros.publish("/hydris/loop", "string", []byte(`{"changes":[{"id":"loop.r1","label":"from ros"}]}`), 1)

	t.waitFor("loop.r1 in a and b", 15*time.Second, func() (bool, string) {
		return a.get("loop.r1") != nil && b.get("loop.r1") != nil, "missing"
	})
	fresh := a.get("loop.r1").GetLifetime().GetFresh().AsTime()
	res := <-heard

	if b.get("loop.a1") != nil {
		t.Errorf("b took a's entity loop.a1 from ROS")
	}
	for _, h := range []*Hydris{a, b} {
		e := h.get("loop.r1")
		if ch := e.GetRouting().GetChannels(); len(ch) != 1 || ch[0].GetName() != "loop" {
			t.Errorf("loop.r1 routing = %v, want channel loop", e.GetRouting())
		}
		if n := e.GetController().GetNode(); n != h.node() {
			t.Errorf("loop.r1 controller node %q, want the local %q", n, h.node())
		}
	}
	// a publishes loop.a1 once; loop.r1 is published once by each node. A
	// loop shows as many more.
	t.Logf("heard on /hydris/loop: %v", res.IDs)
	if n := res.IDs["loop.a1"]; n < 1 || n > 2 {
		t.Errorf("loop.a1 published %d times, want 1-2", n)
	}
	if n := res.IDs["loop.r1"]; n < 2 || n > 4 {
		t.Errorf("loop.r1 published %d times, want 2-4", n)
	}
	if now := a.get("loop.r1").GetLifetime().GetFresh().AsTime(); !now.Equal(fresh) {
		t.Errorf("loop.r1 still changing on a: fresh %v, then %v", fresh, now)
	}
}

// testScale fans a channel out to a topic per entity: max_topics holds,
// expired entities take their topics with them, and churn does not leak.
func testScale(t *T) {
	h := t.startHydris("h")
	ros := t.startROS()
	h.installPlugin()
	h.channel("ros2.ch.scale", map[string]any{"channel": "scale", "per_entity": true,
		"max_topics": 100, "encoding": "json", "domain_id": t.r.domain})

	ids := make([]string, 150)
	var es []*pb.Entity
	for i := range ids {
		ids[i] = fmt.Sprintf("scale.e%03d", i)
		es = append(es, routed(ids[i], "scale"))
	}
	h.push(es...)
	ros.waitTopics("/hydris/scale/", 100, 60*time.Second)
	if !strings.Contains(h.log(), "max_topics reached") {
		t.Errorf("no max_topics warning in the hydris log")
	}
	h.waitDevice("ros2.ch.scale", pb.DeviceState_DeviceStateDegraded, "max_topics 100 reached")
	if n := metric(h.get("ros2.ch.scale"), "topics"); n != 100 {
		t.Errorf("topics metric %d, want 100", n)
	}
	for _, id := range ids {
		h.expire(id)
	}
	ros.waitTopics("/hydris/scale/", 0, 60*time.Second)
	h.waitDevice("ros2.ch.scale", pb.DeviceState_DeviceStateActive, "")

	pids := h.pluginPIDs()
	if len(pids) != 1 {
		t.Fatalf("plugin processes: %v, want one", pids)
	}
	before := rssKB(pids[0])
	const cycles, n = 10, 100
	for c := range cycles {
		es = es[:0]
		for i := range n {
			es = append(es, routed(fmt.Sprintf("churn.c%d.e%03d", c, i), "scale"))
		}
		h.push(es...)
		time.Sleep(time.Second)
		for _, e := range es {
			h.expire(e.Id)
		}
		time.Sleep(time.Second)
	}
	ros.waitTopics("/hydris/scale/", 0, 60*time.Second)
	after := rssKB(pids[0])
	if now := h.pluginPIDs(); len(now) != 1 || now[0] != pids[0] {
		t.Errorf("plugin restarted during churn: %v, then %v", pids, now)
	}
	t.Logf("plugin RSS %d MB before %d topics of churn, %d MB after", before/1024, cycles*n, after/1024)
	if after > 2*before && after-before > 50*1024 {
		t.Errorf("plugin RSS grew from %d to %d MB", before/1024, after/1024)
	}
}

// testRate pushes 50 entities at 20 Hz into a shared topic. Every entity's
// last state must arrive; how many intermediate states do is reported.
func testRate(t *T) {
	h := t.startHydris("h")
	ros := t.startROS()
	h.installPlugin()
	h.channel("ros2.ch.rate", map[string]any{"channel": "rate", "encoding": "json", "domain_id": t.r.domain})

	heard := ros.listen("/hydris/rate", "string", 30, false)
	time.Sleep(5 * time.Second)
	const n, rounds = 50, 160
	start := time.Now()
	for r := range rounds {
		es := make([]*pb.Entity, n)
		for i := range es {
			es[i] = routed(fmt.Sprintf("rate.e%02d", i), "rate")
			es[i].Label = proto.String(fmt.Sprintf("r%d", r))
		}
		h.push(es...)
		if r == rounds*3/4 {
			// Traffic has been flowing for longer than a report interval.
			if kbps := metricFloat(h.get("ros2.ch.rate"), "published rate"); kbps <= 0 {
				t.Errorf("published rate %v KB/s while publishing", kbps)
			} else {
				t.Logf("published rate %.0f KB/s", kbps)
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	took := time.Since(start)
	res := <-heard

	last := fmt.Sprintf("r%d", rounds-1)
	for i := range n {
		id := fmt.Sprintf("rate.e%02d", i)
		if got := res.Last[id]; got != last {
			t.Errorf("%s: last state heard %q, want %q", id, got, last)
		}
	}
	t.Logf("%d of %d updates arrived in ROS; pushed at %.0f/s", res.Count, n*rounds, float64(n*rounds)/took.Seconds())
	t.waitFor("published metric", 10*time.Second, func() (bool, string) {
		got := metric(h.get("ros2.ch.rate"), "messages published")
		return got >= uint64(res.Count), fmt.Sprintf("%d published, ROS heard %d", got, res.Count)
	})
}

// testLarge sends a 1 MB payload each way: out as protobuf bytes, in as
// JSON, both above the size of one UDP datagram.
func testLarge(t *T) {
	h := t.startHydris("h")
	ros := t.startROS()
	h.installPlugin()
	h.channel("ros2.ch.big", map[string]any{"channel": "big", "encoding": "pb", "domain_id": t.r.domain})
	h.channel("ros2.ch.bigin", map[string]any{"channel": "bigin", "encoding": "json", "domain_id": t.r.domain})

	out := make([]byte, 1<<20)
	_, _ = rand.Read(out)
	heard := ros.listen("/hydris/big", "bytes", 25, false)
	time.Sleep(5 * time.Second)
	e := routed("big.out", "big")
	e.Capture = &pb.CaptureComponent{Payload: out}
	h.push(e)
	res := <-heard
	// The event is the entity, the payload plus what hydris adds (id,
	// controller, lifetime, routing), and the change.
	if res.MaxSize < len(out) || res.MaxSize > len(out)+4096 {
		t.Errorf("largest message on /hydris/big: %d bytes, want the 1 MB entity", res.MaxSize)
	}

	in := make([]byte, 1<<20)
	_, _ = rand.Read(in)
	msg, err := protojson.Marshal(&pb.EntityChangeRequest{Changes: []*pb.Entity{{Id: "big.in", Capture: &pb.CaptureComponent{Payload: in}}}})
	if err != nil {
		t.Fatalf("%v", err)
	}
	// Twice: Cyclone DDS skips everything a writer it newly matched sent
	// before its first heartbeat, and a fragmented message is still in
	// flight when that comes. A ROS node publishing a stream loses its first
	// large message the same way.
	ros.publish("/hydris/bigin", "string", msg, 2)
	t.waitFor("big.in with the 1 MB payload", 30*time.Second, func() (bool, string) {
		got := h.get("big.in").GetCapture().GetPayload()
		ch := h.get("ros2.ch.bigin")
		return bytes.Equal(got, in), fmt.Sprintf("%d bytes; channel received %d, dropped %d, %v %s", len(got),
			metric(ch, "messages received"), metric(ch, "messages dropped"), ch.GetDevice().GetState(), ch.GetDevice().GetError())
	})
	t.waitFor("received metric", 10*time.Second, func() (bool, string) {
		e := h.get("ros2.ch.bigin")
		kb, pushed := metricFloat(e, "data received"), metric(e, "entities pushed")
		return kb >= float64(len(msg))/1000 && pushed >= 1, fmt.Sprintf("%.0f KB received, %d pushed", kb, pushed)
	})
}

// testRestart: per-entity topics keep the state for late subscribers
// across a hydris restart and a plugin restart, follow a config change,
// and go away with the channel.
func testRestart(t *T) {
	h := t.startHydris("h")
	ros := t.startROS()
	h.installPlugin()
	cfg := map[string]any{"channel": "rs", "per_entity": true, "encoding": "json", "domain_id": t.r.domain}
	h.channel("ros2.ch.rs", cfg)
	e := routed("rs.e1", "rs")
	e.Label = proto.String("one")
	h.push(e)

	lateJoin := func(topic string) {
		t.waitFor("rs.e1 for a late subscriber on "+topic, 60*time.Second, func() (bool, string) {
			res := ros.agent("listen", topic, "string", "5", "transient")
			return res.IDs["rs.e1"] > 0, fmt.Sprintf("heard %d messages", res.Count)
		})
	}
	lateJoin("/hydris/rs/rs_e1")

	t.Logf("restarting hydris")
	old := h.pluginPIDs()
	h.restart()
	for _, pid := range old {
		if _, err := os.Stat(fmt.Sprintf("/proc/%d", pid)); err == nil {
			t.Errorf("plugin process %d outlived hydris", pid)
		}
	}
	h.waitService()
	h.waitActive("ros2.ch.rs")
	lateJoin("/hydris/rs/rs_e1")

	t.Logf("restarting the plugin")
	h.setPluginEnabled(false)
	ros.waitTopics("/hydris/rs/", 0, 60*time.Second)
	h.setPluginEnabled(true)
	lateJoin("/hydris/rs/rs_e1")

	t.Logf("moving the topic")
	cfg["topic"] = "/hydris/rs_moved"
	h.channel("ros2.ch.rs", cfg)
	ros.waitTopics("/hydris/rs/", 0, 60*time.Second)
	lateJoin("/hydris/rs_moved/rs_e1")

	t.Logf("deleting the channel")
	h.expire("ros2.ch.rs")
	ros.waitTopics("/hydris/rs_moved/", 0, 60*time.Second)
}

// testArm64 runs the arm64 binary under qemu as the plugin of a hydris and
// bridges a channel both ways.
func testArm64(t *T) {
	qemu, err := exec.LookPath("qemu-aarch64")
	if err != nil {
		t.Skipf("no qemu-aarch64")
	}
	h := t.startHydris("h")
	ros := t.startROS()

	// Started by hand the way hydris starts a plugin: the server in the
	// environment, stdin open while it should run.
	log, err := os.Create(filepath.Join(t.dir, "plugin-arm64.log"))
	if err != nil {
		t.Fatalf("%v", err)
	}
	cmd := exec.Command(qemu, filepath.Join(t.r.plugin, "bin", "ros2-linux-arm64"))
	cmd.Env = append(os.Environ(), "HYDRIS_SERVER="+h.base, "HYDRIS_PLUGIN_ID="+pluginID)
	cmd.Stdout, cmd.Stderr = log, log
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("%v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start arm64 plugin: %v", err)
	}
	t.Cleanup(func() {
		_ = stdin.Close()
		done := make(chan struct{})
		go func() { _ = cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			_ = cmd.Process.Kill()
			<-done
		}
	})

	h.waitService()
	h.channel("ros2.ch.arm", map[string]any{"channel": "arm", "encoding": "json", "domain_id": t.r.domain})

	heard := ros.listen("/hydris/arm", "string", 15, false)
	time.Sleep(5 * time.Second)
	h.push(routed("arm.e1", "arm"))
	if res := <-heard; res.IDs["arm.e1"] == 0 {
		t.Errorf("arm.e1 not heard on /hydris/arm: %v", res.IDs)
	}

	ros.publish("/hydris/arm", "string", []byte(`{"changes":[{"id":"arm.r1","label":"from ros"}]}`), 1)
	t.waitFor("arm.r1 from ROS", 20*time.Second, func() (bool, string) {
		ch := h.get("ros2.ch.arm")
		return h.get("arm.r1") != nil, fmt.Sprintf("missing; channel received %d, dropped %d, %v %s",
			metric(ch, "messages received"), metric(ch, "messages dropped"), ch.GetDevice().GetState(), ch.GetDevice().GetError())
	})
}
