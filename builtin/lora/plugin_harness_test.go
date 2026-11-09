package lora_test

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/evanw/esbuild/pkg/api"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/plugins"
	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/pkg/rt"
	pb "github.com/projectqai/proto/go"
)

var (
	sharedOnce  sync.Once
	sharedWorld *world
)

type world struct {
	t         *testing.T
	eng       *engine.WorldServer
	ctx       context.Context
	worldFile string
	dir       string
}

func (w *world) push(entities ...*pb.Entity) {
	w.t.Helper()
	if _, err := w.eng.Push(w.ctx, connect.NewRequest(&pb.EntityChangeRequest{Changes: entities})); err != nil {
		w.t.Fatal(err)
	}
}

func (w *world) get(id string) *pb.Entity {
	resp, err := w.eng.GetEntity(w.ctx, connect.NewRequest(&pb.GetEntityRequest{Id: id}))
	if err != nil {
		return nil
	}
	return resp.Msg.Entity
}

func (w *world) waitFor(what string, cond func() bool) {
	w.t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	w.t.Fatalf("timed out waiting for %s", what)
}

func (w *world) settle() {
	time.Sleep(2500 * time.Millisecond)
}

func (w *world) metric(id, label string) (uint64, bool) {
	e := w.get(id)
	for _, m := range e.GetMetric().GetMetrics() {
		if m.GetLabel() == label {
			return m.GetUint64(), true
		}
	}
	return 0, false
}

func startShared() *world {
	sharedOnce.Do(func() {
		eng := engine.NewWorldServer()
		eng.InitNodeIdentity()
		dir, err := os.MkdirTemp("", "lora-e2e-*")
		if err != nil {
			panic(err)
		}
		worldFile := filepath.Join(dir, "world.yaml")
		eng.SetWorldFile(worldFile)
		if err := eng.LoadDefaults(builtin.DefaultWorld()); err != nil {
			panic(err)
		}
		srv := engine.NewBuiltinServer(engine.NewAPIMux(eng, nil, nil, nil))
		go func() { _ = srv.Serve(builtin.GetBuiltinListener()) }()
		sharedWorld = &world{eng: eng, ctx: context.Background(), worldFile: worldFile, dir: dir}
	})
	return sharedWorld
}

func TestMain(m *testing.M) {
	code := m.Run()
	if sharedWorld != nil {
		os.RemoveAll(sharedWorld.dir)
	}
	os.Exit(code)
}

func pluginDirOrSkip(t *testing.T, name string) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("../../plugins", name))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "node_modules")); err != nil {
		t.Skipf("plugins/%s/node_modules missing; run `bun install` there", name)
	}
	return dir
}

func runPlugin(t *testing.T, pluginDir string) (*world, context.Context) {
	t.Helper()
	shared := startShared()
	w := &world{t: t, eng: shared.eng, ctx: context.Background(), worldFile: shared.worldFile}
	ctx, cancel := context.WithCancel(context.Background())
	bundlePath := bundle(t, filepath.Join(pluginDir, "index.ts"))
	go func() {
		_ = rt.RunPluginEnv(ctx, bundlePath, pluginDir, "http://hydris.builtin", plugins.NewPluginClient(pluginDir, plugins.PluginInfo{EntityID: "plugins.unsafelora"}))
	}()
	t.Cleanup(cancel)
	return w, ctx
}

func bundle(t *testing.T, entry string) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "bundle.js")
	result := api.Build(api.BuildOptions{
		EntryPoints: []string{entry},
		Bundle:      true,
		Format:      api.FormatESModule,
		Target:      api.ES2017,
		Outfile:     out,
		Write:       true,
		Supported:   map[string]bool{"top-level-await": true},
	})
	if len(result.Errors) > 0 {
		e := result.Errors[0]
		if e.Location != nil {
			t.Fatalf("esbuild: %s:%d: %s", e.Location.File, e.Location.Line, e.Text)
		}
		t.Fatalf("esbuild: %s", e.Text)
	}
	return out
}
