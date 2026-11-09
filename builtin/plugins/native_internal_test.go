//go:build !android

package plugins

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func TestNativeEnvKeepsOnlyTheBasics(t *testing.T) {
	got := nativeEnv([]string{
		"PATH=/bin", "HOME=/home/u", "LC_ALL=C", "Path=C:\\Windows", "SystemRoot=C:\\Windows",
		"HYDRIS_DEBUG=1", "AWS_SECRET_ACCESS_KEY=x", "=C:=C:\\", "garbage",
	})
	want := []string{"PATH=/bin", "HOME=/home/u", "LC_ALL=C", "Path=C:\\Windows", "SystemRoot=C:\\Windows"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("env = %q, want %q", got, want)
	}
}

func TestLogWriterKeepsStructure(t *testing.T) {
	var buf bytes.Buffer
	l := &logWriter{logger: slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))}
	_, _ = l.Write([]byte(`{"time":"x","level":"WARN","msg":"hi","addr":"1.2.3.4:5","n":{"a":1}}` + "\nplain "))
	_, _ = l.Write([]byte("line\n"))
	out := buf.String()
	for _, want := range []string{`level=WARN msg=hi addr=1.2.3.4:5 n.a=1`, `level=INFO msg="plain line"`} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "time=x") {
		t.Error("the plugin's timestamp should be dropped for hydris' own")
	}
}
