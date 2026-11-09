package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ROS is a ROS 2 Jazzy container on the host network, on the run's DDS
// domain, with the test agent (agent.py). The test directory is /work in it.
type ROS struct {
	t    *T
	name string
}

// Result is what agent.py prints.
type Result struct {
	Count       int               `json:"count"`
	IDs         map[string]int    `json:"ids"`
	Last        map[string]string `json:"last"`
	MaxSize     int               `json:"max_size"`
	Subscribers int               `json:"subscribers"`
	Acked       bool              `json:"acked"`
	Topics      []string          `json:"topics"`
}

func (t *T) startROS() *ROS {
	r := &ROS{t: t, name: fmt.Sprintf("hydris-ros2-test-%d-%s", os.Getpid(), t.name)}
	out, err := exec.Command("docker", "run", "-d", "--rm", "--name", r.name, "--net", "host",
		"-e", fmt.Sprintf("ROS_DOMAIN_ID=%d", t.r.domain), "-v", t.dir+":/work",
		testImage, "sleep", "infinity").CombinedOutput()
	if err != nil {
		t.Fatalf("start ROS container: %v: %s", err, out)
	}
	t.Cleanup(func() { _ = exec.Command("docker", "rm", "-f", r.name).Run() })
	return r
}

func (r *ROS) agent(args ...string) Result {
	cmd := append([]string{"exec", r.name, "bash", "-c", `. /opt/ros/jazzy/setup.sh && exec python3 /agent.py "$@"`, "agent"}, args...)
	out, err := exec.Command("docker", cmd...).Output()
	if err != nil {
		stderr := ""
		if ee, ok := err.(*exec.ExitError); ok {
			stderr = string(ee.Stderr)
		}
		r.t.Fatalf("agent %v: %v: %s", args, err, stderr)
	}
	var res Result
	if err := json.Unmarshal(out, &res); err != nil {
		r.t.Fatalf("agent %v: %v: %s", args, err, out)
	}
	return res
}

// listen counts the messages on topic for seconds, in the background. The
// subscription needs a few seconds to be discovered before traffic starts.
func (r *ROS) listen(topic, typ string, seconds int, transient bool) <-chan Result {
	args := []string{"listen", topic, typ, fmt.Sprint(seconds)}
	if transient {
		args = append(args, "transient")
	}
	ch := make(chan Result, 1)
	go func() {
		defer func() {
			if v := recover(); v != nil {
				ch <- Result{}
			}
		}()
		ch <- r.agent(args...)
	}()
	return ch
}

// publish publishes data on topic count times, once a reader matched.
func (r *ROS) publish(topic, typ string, data []byte, count int) Result {
	f, err := os.CreateTemp(r.t.dir, "msg-*")
	if err != nil {
		r.t.Fatalf("%v", err)
	}
	if _, err := f.Write(data); err != nil {
		r.t.Fatalf("%v", err)
	}
	_ = f.Close()
	res := r.agent("publish", topic, typ, "/work/"+filepath.Base(f.Name()), fmt.Sprint(count))
	if res.Subscribers == 0 || !res.Acked {
		r.t.Errorf("publish on %s: %d readers matched, acked %v", topic, res.Subscribers, res.Acked)
	}
	return res
}

// topics lists the topics under prefix after a discovery pause.
func (r *ROS) topics(prefix string) []string {
	return r.agent("topics", prefix, "4").Topics
}

// waitTopics waits until the number of topics under prefix is want.
func (r *ROS) waitTopics(prefix string, want int, timeout time.Duration) {
	r.t.waitFor(fmt.Sprintf("%d topics under %s", want, prefix), timeout, func() (bool, string) {
		ts := r.topics(prefix)
		return len(ts) == want, fmt.Sprintf("%d: %s", len(ts), strings.Join(first(ts, 5), " "))
	})
}

func first(s []string, n int) []string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
