package engine

import (
	"bytes"
	"fmt"
	"net/http"
	"regexp"
	"sync/atomic"
)

const logRingSize = 4096

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// LogRing is a lock-free ring buffer that implements io.Writer.
// Each Write call is stored as one log line with ANSI escapes stripped.
type LogRing struct {
	buf [logRingSize]atomic.Value // each slot holds a string
	pos atomic.Uint64
}

func (r *LogRing) Write(p []byte) (n int, err error) {
	line := ansiRe.ReplaceAllString(string(bytes.TrimRight(p, "\n")), "")
	i := r.pos.Add(1) - 1
	r.buf[i%logRingSize].Store(line)
	return len(p), nil
}

// ServeHTTP renders the log buffer as plain text.
func (r *LogRing) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	pos := r.pos.Load()
	var start uint64
	if pos > logRingSize {
		start = pos - logRingSize
	}

	for i := start; i < pos; i++ {
		v := r.buf[i%logRingSize].Load()
		if v != nil {
			fmt.Fprintln(w, v.(string))
		}
	}
}
