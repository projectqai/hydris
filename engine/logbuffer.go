package engine

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sync/atomic"
)

var _ io.WriterTo = (*LogRing)(nil)

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

// WriteTo streams the current ring contents to w as plain text, one line per Write.
func (r *LogRing) WriteTo(w io.Writer) (int64, error) {
	pos := r.pos.Load()
	var start uint64
	if pos > logRingSize {
		start = pos - logRingSize
	}

	var total int64
	for i := start; i < pos; i++ {
		v := r.buf[i%logRingSize].Load()
		if v == nil {
			continue
		}
		n, err := fmt.Fprintln(w, v.(string))
		total += int64(n)
		if err != nil {
			return total, err
		}
	}
	return total, nil
}

// ServeHTTP renders the log buffer as plain text.
func (r *LogRing) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = r.WriteTo(w)
}
