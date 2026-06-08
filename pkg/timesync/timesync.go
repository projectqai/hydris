package timesync

import (
	"sync/atomic"
	"time"
)

func NTPSample(t1, t2, t3, t4 time.Time) (offset, rtt time.Duration) {
	offset = (t2.Sub(t1) + t3.Sub(t4)) / 2
	rtt = t4.Sub(t1) - t3.Sub(t2)
	return
}

// Tracker accumulates NTP samples and picks the best (minimum-RTT) offset.
// All methods are safe for concurrent use.
type Tracker struct {
	offsetUs atomic.Int64
	rttUs    atomic.Int64
	rttSum   atomic.Int64
	rttCount atomic.Uint64
	minRTT   atomic.Int64
}

func (t *Tracker) Add(offset, rtt time.Duration) {
	rttUs := rtt.Microseconds()
	t.rttUs.Store(rttUs)
	t.rttSum.Add(rttUs)
	t.rttCount.Add(1)

	curMin := t.minRTT.Load()
	if curMin == 0 || rttUs < curMin {
		t.minRTT.Store(rttUs)
		t.offsetUs.Store(offset.Microseconds())
	}
}

func (t *Tracker) Offset() time.Duration {
	return time.Duration(t.offsetUs.Load()) * time.Microsecond
}

func (t *Tracker) RTT() time.Duration {
	return time.Duration(t.rttUs.Load()) * time.Microsecond
}

func (t *Tracker) AvgRTT() time.Duration {
	n := t.rttCount.Load()
	if n == 0 {
		return 0
	}
	return time.Duration(t.rttSum.Load()/int64(n)) * time.Microsecond
}
