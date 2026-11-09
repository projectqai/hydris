package main

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// Hydris is a throwaway hydris instance: its own directory and a free port.
type Hydris struct {
	t    *T
	bin  string
	dir  string
	port int
	base string
	cmd  *exec.Cmd

	version uint64 // of the last config channel pushed
}

// freePort is a free TCP port, odd: hydris binds RTP to an even port, so it
// takes only odd ones for its API.
func freePort() int {
	for {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			panic(err)
		}
		port := l.Addr().(*net.TCPAddr).Port
		_ = l.Close()
		if port%2 == 1 {
			return port
		}
	}
}

// startHydris starts an instance in a new directory under the test's.
func (t *T) startHydris(name string) *Hydris {
	dir := filepath.Join(t.dir, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("%v", err)
	}
	port := freePort()
	h := &Hydris{t: t, bin: t.r.hydris, dir: dir, port: port, base: fmt.Sprintf("http://127.0.0.1:%d", port)}
	h.start()
	t.Cleanup(h.stop)
	return h
}

func (h *Hydris) start() {
	log, err := os.OpenFile(filepath.Join(h.dir, "hydris.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		h.t.Fatalf("%v", err)
	}
	h.cmd = exec.Command(h.bin, "--no-defaults", "-w", filepath.Join(h.dir, "world.yaml"))
	h.cmd.Dir = h.dir
	h.cmd.Env = append(os.Environ(), "PORT="+strconv.Itoa(h.port))
	h.cmd.Stdout, h.cmd.Stderr = log, log
	if err := h.cmd.Start(); err != nil {
		h.t.Fatalf("start hydris: %v", err)
	}
	h.t.waitFor("hydris up", 30*time.Second, func() (bool, string) {
		err := h.call("GetLocalNode", &pb.GetLocalNodeRequest{}, &pb.GetLocalNodeResponse{})
		return err == nil, fmt.Sprint(err)
	})
}

func (h *Hydris) stop() {
	if h.cmd == nil || h.cmd.Process == nil {
		return
	}
	_ = h.cmd.Process.Signal(syscall.SIGTERM)
	done := make(chan struct{})
	go func() { _ = h.cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		_ = h.cmd.Process.Kill()
		<-done
	}
	h.cmd = nil
}

func (h *Hydris) restart() {
	h.stop()
	h.start()
}

func (h *Hydris) log() string {
	b, _ := os.ReadFile(filepath.Join(h.dir, "hydris.log"))
	return string(b)
}

// call calls a WorldService method with the Connect protocol's JSON.
func (h *Hydris) call(method string, req, resp proto.Message) error {
	body, err := protojson.Marshal(req)
	if err != nil {
		return err
	}
	r, err := http.Post(h.base+"/world.WorldService/"+method, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer func() { _ = r.Body.Close() }()
	b, _ := io.ReadAll(r.Body)
	if r.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s: %s", method, r.Status, b)
	}
	return protojson.UnmarshalOptions{DiscardUnknown: true}.Unmarshal(b, resp)
}

func (h *Hydris) push(es ...*pb.Entity) {
	if err := h.call("Push", &pb.EntityChangeRequest{Changes: es}, &pb.EntityChangeResponse{}); err != nil {
		h.t.Fatalf("push: %v", err)
	}
}

func (h *Hydris) list(f *pb.EntityFilter) []*pb.Entity {
	var resp pb.ListEntitiesResponse
	if err := h.call("ListEntities", &pb.ListEntitiesRequest{Filter: f}, &resp); err != nil {
		h.t.Fatalf("list: %v", err)
	}
	return resp.Entities
}

// get is the entity id, or nil.
func (h *Hydris) get(id string) *pb.Entity {
	for _, e := range h.list(&pb.EntityFilter{Id: &id}) {
		if e.Id == id {
			return e
		}
	}
	return nil
}

func (h *Hydris) expire(id string) {
	if err := h.call("ExpireEntity", &pb.ExpireEntityRequest{Id: id}, &pb.ExpireEntityResponse{}); err != nil {
		h.t.Fatalf("expire %s: %v", id, err)
	}
}

func (h *Hydris) node() string {
	var resp pb.GetLocalNodeResponse
	if err := h.call("GetLocalNode", &pb.GetLocalNodeRequest{}, &resp); err != nil {
		h.t.Fatalf("local node: %v", err)
	}
	return resp.Entity.Controller.GetNode()
}

const pluginID = "ros2.plugin"

// installPlugin uploads the plugin image and runs it, as plugin/Makefile's
// install does.
func (h *Hydris) installPlugin() {
	h.setPluginEnabled(false)
	f, err := os.Open(h.t.r.tarball)
	if err != nil {
		h.t.Fatalf("%v", err)
	}
	defer func() { _ = f.Close() }()
	r, err := http.Post(h.base+"/artifacts/"+pluginID, "application/octet-stream", f)
	if err != nil {
		h.t.Fatalf("upload plugin: %v", err)
	}
	_ = r.Body.Close()
	if r.StatusCode/100 != 2 {
		h.t.Fatalf("upload plugin: %s", r.Status)
	}
	h.setPluginEnabled(true)
	h.waitService()
}

func (h *Hydris) setPluginEnabled(on bool) {
	cfg, _ := structpb.NewStruct(map[string]any{"ref": "artifact://" + pluginID, "enabled": on})
	h.push(&pb.Entity{
		Id:       pluginID,
		Device:   &pb.DeviceComponent{Parent: proto.String("plugins.custom"), Class: proto.String("plugin")},
		Artifact: &pb.ArtifactComponent{Id: pluginID},
		Config:   &pb.ConfigurationComponent{Value: cfg},
	})
}

// waitService waits for the plugin to announce ros2.service.
func (h *Hydris) waitService() {
	h.t.waitFor("ros2.service", 60*time.Second, func() (bool, string) {
		return h.get("ros2.service") != nil, "not announced"
	})
}

// channel creates or reconfigures a channel child and waits until the
// plugin runs this config: the version is bumped, so an earlier run being
// active does not count.
func (h *Hydris) channel(id string, cfg map[string]any) {
	v, err := structpb.NewStruct(cfg)
	if err != nil {
		h.t.Fatalf("%v", err)
	}
	h.push(&pb.Entity{
		Id:     id,
		Device: &pb.DeviceComponent{Parent: proto.String("ros2.service"), Class: proto.String("channel")},
		Config: &pb.ConfigurationComponent{Value: v, Version: h.version + 1},
	})
	h.version++
	h.waitActive(id)
}

func (h *Hydris) waitActive(id string) {
	h.t.waitFor(id+" active", 30*time.Second, func() (bool, string) {
		e := h.get(id)
		c := e.GetConfigurable()
		if c.GetState() == pb.ConfigurableState_ConfigurableStateActive &&
			c.GetAppliedVersion() == e.GetConfig().GetVersion() {
			return true, ""
		}
		return false, fmt.Sprintf("%v %s", c.GetState(), c.GetError())
	})
}

// pluginPIDs are the processes of this instance's plugin binary.
func (h *Hydris) pluginPIDs() []int {
	var pids []int
	procs, _ := filepath.Glob("/proc/[0-9]*/cmdline")
	for _, p := range procs {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		if cmd := string(b); strings.HasPrefix(cmd, h.dir+"/") && strings.Contains(cmd, "ros2-linux-") {
			pid, _ := strconv.Atoi(strings.Split(p, "/")[2])
			pids = append(pids, pid)
		}
	}
	return pids
}

// rssKB is the resident memory of process pid.
func rssKB(pid int) int {
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0
	}
	for _, l := range strings.Split(string(b), "\n") {
		if f := strings.Fields(l); len(f) >= 2 && f[0] == "VmRSS:" {
			n, _ := strconv.Atoi(f[1])
			return n
		}
	}
	return 0
}

func routed(id, channel string) *pb.Entity {
	return &pb.Entity{Id: id, Routing: &pb.Routing{Channels: []*pb.Channel{{Name: channel}}}}
}

// metric is the value of the channel metric labelled label.
func metric(e *pb.Entity, label string) uint64 {
	for _, m := range e.GetMetric().GetMetrics() {
		if m.GetLabel() == label {
			return m.GetUint64()
		}
	}
	return 0
}

// metricFloat is the value of the channel's floating point metric
// labelled label: data sizes and rates.
func metricFloat(e *pb.Entity, label string) float64 {
	for _, m := range e.GetMetric().GetMetrics() {
		if m.GetLabel() == label {
			return m.GetDouble()
		}
	}
	return 0
}

// waitDevice waits for the device state of entity id.
func (h *Hydris) waitDevice(id string, want pb.DeviceState, errorContains string) {
	h.t.waitFor(fmt.Sprintf("%s device %v", id, want), 30*time.Second, func() (bool, string) {
		d := h.get(id).GetDevice()
		return d.GetState() == want && strings.Contains(d.GetError(), errorContains),
			fmt.Sprintf("%v %q", d.GetState(), d.GetError())
	})
}
