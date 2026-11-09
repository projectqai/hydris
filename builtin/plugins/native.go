//go:build !android

package plugins

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// A native plugin (hydris.native in package.json) runs as a child process.
// It reaches the engine through a loopback listener of its own, which stamps
// requests carrying the plugin's token with the plugin's identity, as for JS
// plugins, and refuses the rest. The process contract (environment, stdin,
// logs) is documented in proto/go/sdk.

const nativeStopGrace = 5 * time.Second

// runNative runs bin from the plugin directory dir until ctx ends. An exit
// while ctx is live is an error, so the controller restarts it.
func runNative(ctx context.Context, info PluginInfo, dir, bin string) error {
	if err := prepareActors(ctx, info, dir); err != nil {
		return err
	}
	// The process starts in dir, so a relative bin would resolve against it.
	bin, err := filepath.Abs(bin)
	if err != nil {
		return err
	}
	logger := slog.Default().With("module", info.Name)

	gw, err := serveNative(dir, info)
	if err != nil {
		return err
	}
	defer gw.close()

	cmd := exec.Command(bin)
	cmd.Dir = dir
	cmd.Env = append(nativeEnv(os.Environ()),
		"HYDRIS_SERVER=http://"+gw.addr,
		"HYDRIS_TOKEN="+gw.token,
		"HYDRIS_PLUGIN_ID="+info.EntityID,
		"HYDRIS_DATA_DIR="+dir,
	)
	out := &logWriter{logger: logger}
	cmd.Stdout, cmd.Stderr = out, out
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	group := newProcGroup(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start native plugin: %w", err)
	}
	defer group.close()
	if err := group.started(cmd); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return fmt.Errorf("supervise native plugin: %w", err)
	}
	logger.Info("native plugin started", "binary", bin, "pid", cmd.Process.Pid)

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	select {
	case err := <-exited:
		out.flush()
		if err == nil {
			err = errors.New("exited")
		}
		return fmt.Errorf("native plugin: %w", err)
	case <-ctx.Done():
	}

	_ = stdin.Close()
	group.terminate()
	select {
	case <-exited:
	case <-time.After(nativeStopGrace):
		logger.Warn("native plugin did not stop in time, killing it")
		group.kill()
		<-exited
	}
	out.flush()
	return nil
}

// nativeEnvKeys is what a native plugin inherits of hydris' environment: what
// the OS, libc and (on Windows) Winsock need. Keys are upper case.
var nativeEnvKeys = map[string]bool{
	"PATH": true, "HOME": true, "USER": true, "LOGNAME": true,
	"LANG": true, "LANGUAGE": true, "TZ": true,
	"TMPDIR": true, "TMP": true, "TEMP": true,
	"SYSTEMROOT": true, "SYSTEMDRIVE": true, "WINDIR": true, "COMSPEC": true, "PATHEXT": true,
	"USERPROFILE": true, "APPDATA": true, "LOCALAPPDATA": true, "PROGRAMDATA": true,
}

func nativeEnv(environ []string) []string {
	var env []string
	for _, kv := range environ {
		k, _, ok := strings.Cut(kv, "=")
		if !ok || k == "" {
			continue
		}
		if k = strings.ToUpper(k); nativeEnvKeys[k] || strings.HasPrefix(k, "LC_") {
			env = append(env, kv)
		}
	}
	return env
}

// nativeGateway is the loopback listener of one native plugin.
type nativeGateway struct {
	addr  string
	token string
	srv   *http.Server
}

func serveNative(dir string, info PluginInfo) (*nativeGateway, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen for native plugin: %w", err)
	}
	gw := &nativeGateway{addr: ln.Addr().String(), token: rand.Text()}

	var h2c http.Protocols
	h2c.SetUnencryptedHTTP2(true)
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Scheme = "http"
			r.Out.URL.Host = "hydris.builtin"
			r.Out.Host = ""
			r.Out.Header.Del("Authorization")
		},
		// HTTP/2 end to end, so gRPC streams and trailers pass through.
		Transport:     newPluginTransport(dir, info, &http.Transport{Protocols: &h2c, DialContext: dialBuiltin}),
		FlushInterval: -1,
	}
	want := []byte("Bearer " + gw.token)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), want) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		proxy.ServeHTTP(w, r)
	})

	var protos http.Protocols
	protos.SetHTTP1(true)
	protos.SetUnencryptedHTTP2(true)
	gw.srv = &http.Server{Handler: handler, Protocols: &protos, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = gw.srv.Serve(ln) }()
	return gw, nil
}

func (gw *nativeGateway) close() { _ = gw.srv.Close() }

// logWriter logs the plugin's output line by line. JSON lines from slog keep
// their level, message and attributes; other lines are logged as is.
type logWriter struct {
	logger *slog.Logger
	mu     sync.Mutex
	buf    []byte
}

func (l *logWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.buf = append(l.buf, p...)
	for {
		i := bytes.IndexByte(l.buf, '\n')
		if i < 0 {
			break
		}
		l.line(l.buf[:i])
		l.buf = l.buf[i+1:]
	}
	if len(l.buf) > 64<<10 { // a runaway line without newline
		l.line(l.buf)
		l.buf = nil
	}
	return len(p), nil
}

func (l *logWriter) flush() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.buf) > 0 {
		l.line(l.buf)
		l.buf = nil
	}
}

func (l *logWriter) line(b []byte) {
	b = bytes.TrimRight(b, "\r")
	if len(bytes.TrimSpace(b)) == 0 {
		return
	}
	var rec map[string]any
	if b[0] != '{' || json.Unmarshal(b, &rec) != nil {
		l.logger.Info(string(b))
		return
	}
	level := slog.LevelInfo
	if s, ok := rec[slog.LevelKey].(string); ok {
		_ = level.UnmarshalText([]byte(strings.ToUpper(s)))
	}
	msg, _ := rec[slog.MessageKey].(string)
	delete(rec, slog.TimeKey)
	delete(rec, slog.LevelKey)
	delete(rec, slog.MessageKey)
	l.logger.Log(context.Background(), level, msg, logAttrs(rec)...)
}

// logAttrs turns a decoded JSON object into slog attributes in key order.
func logAttrs(m map[string]any) []any {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	attrs := make([]any, 0, len(keys))
	for _, k := range keys {
		if sub, ok := m[k].(map[string]any); ok {
			attrs = append(attrs, slog.Group(k, logAttrs(sub)...))
		} else {
			attrs = append(attrs, slog.Any(k, m[k]))
		}
	}
	return attrs
}
