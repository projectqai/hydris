//go:build cyclonedds && cgo

package dds

/*
#cgo CFLAGS: -I${SRCDIR}/gen
#cgo LDFLAGS: -lddsc -lpthread -lm

#include <stdlib.h>
#include <string.h>
#include "dds/dds.h"
#include "std_msgs.c"

static dds_entity_t hy_topic(dds_entity_t pp, int kind, const char *name) {
	const dds_topic_descriptor_t *d = kind == 0
		? &std_msgs_msg_dds__String__desc
		: &std_msgs_msg_dds__UInt8MultiArray__desc;
	return dds_create_topic(pp, d, name, NULL, NULL);
}

static dds_qos_t *hy_qos(int32_t depth, int transient_local, int reader) {
	dds_qos_t *q = dds_create_qos();
	dds_qset_reliability(q, DDS_RELIABILITY_RELIABLE, DDS_SECS(1));
	dds_qset_durability(q, transient_local ? DDS_DURABILITY_TRANSIENT_LOCAL : DDS_DURABILITY_VOLATILE);
	dds_qset_history(q, DDS_HISTORY_KEEP_LAST, depth);
	// A reader never hears writers of this process: a bridge with an
	// egress and an ingress on one topic must not loop.
	if (reader)
		dds_qset_ignorelocal(q, DDS_IGNORELOCAL_PROCESS);
	return q;
}

static dds_entity_t hy_writer(dds_entity_t pp, dds_entity_t tp, int32_t depth, int transient_local) {
	dds_qos_t *q = hy_qos(depth, transient_local, 0);
	dds_entity_t w = dds_create_writer(pp, tp, q, NULL);
	dds_delete_qos(q);
	return w;
}

static dds_entity_t hy_reader(dds_entity_t pp, dds_entity_t tp, int32_t depth) {
	dds_qos_t *q = hy_qos(depth, 0, 1);
	dds_entity_t r = dds_create_reader(pp, tp, q, NULL);
	dds_delete_qos(q);
	return r;
}

static dds_return_t hy_write(dds_entity_t w, int kind, const void *data, uint32_t len) {
	if (kind == 0) {
		std_msgs_msg_dds__String_ s;
		s.data = malloc(len + 1);
		if (s.data == NULL)
			return DDS_RETCODE_OUT_OF_RESOURCES;
		memcpy(s.data, data, len);
		s.data[len] = 0;
		dds_return_t rc = dds_write(w, &s);
		free(s.data);
		return rc;
	}
	std_msgs_msg_dds__UInt8MultiArray_ m;
	memset(&m, 0, sizeof m);
	m.data._maximum = m.data._length = len;
	m.data._buffer = (uint8_t *)data;
	return dds_write(w, &m);
}

// hy_take takes the next valid sample and returns a malloc'd copy of its
// payload: 1 with *out set, 0 when there is none, or a negative retcode.
static dds_return_t hy_take(dds_entity_t r, int kind, void **out, uint32_t *len) {
	for (;;) {
		void *s[1] = {NULL};
		dds_sample_info_t info;
		dds_return_t n = dds_take(r, s, &info, 1, 1);
		if (n <= 0)
			return n;
		int ok = info.valid_data;
		if (ok) {
			const void *src;
			if (kind == 0) {
				const char *d = ((std_msgs_msg_dds__String_ *)s[0])->data;
				src = d;
				*len = d ? strlen(d) : 0;
			} else {
				std_msgs_msg_dds__UInt8MultiArray_ *m = s[0];
				src = m->data._buffer;
				*len = m->data._length;
			}
			*out = malloc(*len ? *len : 1);
			if (*out == NULL) {
				dds_return_loan(r, s, n);
				return DDS_RETCODE_OUT_OF_RESOURCES;
			}
			if (*len)
				memcpy(*out, src, *len);
		}
		dds_return_loan(r, s, n);
		if (ok)
			return 1;
	}
}
*/
import "C"

import (
	"bytes"
	"errors"
	"fmt"
	"time"
	"unsafe"
)

func retErr(what string, rc C.dds_return_t) error {
	return fmt.Errorf("%s: %s", what, C.GoString(C.dds_strretcode(rc)))
}

// Domain is a DDS participant on one domain. Its writers and readers end
// with it.
type Domain struct{ pp C.dds_entity_t }

// Open joins DDS domain id, as ROS_DOMAIN_ID.
func Open(id uint32) (*Domain, error) {
	if id > 232 {
		return nil, fmt.Errorf("domain %d: want 0-232", id)
	}
	pp := C.dds_create_participant(C.dds_domainid_t(id), nil, nil)
	if pp < 0 {
		return nil, retErr("create participant", C.dds_return_t(pp))
	}
	return &Domain{pp: pp}, nil
}

// Close leaves the domain and deletes its writers and readers.
func (d *Domain) Close() error {
	if rc := C.dds_delete(d.pp); rc < 0 {
		return retErr("delete participant", rc)
	}
	return nil
}

func (d *Domain) topic(name string, t Type) (C.dds_entity_t, error) {
	dt, err := ddsTopic(name)
	if err != nil {
		return 0, err
	}
	cs := C.CString(dt)
	defer C.free(unsafe.Pointer(cs))
	tp := C.hy_topic(d.pp, C.int(t), cs)
	if tp < 0 {
		return 0, retErr("create topic "+name, C.dds_return_t(tp))
	}
	return tp, nil
}

// Writer publishes on one topic.
type Writer struct {
	w, tp C.dds_entity_t
	t     Type
}

// Writer creates a reliable writer on the ROS topic name.
func (d *Domain) Writer(name string, t Type, qos QoS) (*Writer, error) {
	if qos.Depth < 1 {
		return nil, fmt.Errorf("depth %d: want at least 1", qos.Depth)
	}
	tp, err := d.topic(name, t)
	if err != nil {
		return nil, err
	}
	tl := 0
	if qos.TransientLocal {
		tl = 1
	}
	w := C.hy_writer(d.pp, tp, C.int32_t(qos.Depth), C.int(tl))
	if w < 0 {
		C.dds_delete(tp)
		return nil, retErr("create writer "+name, C.dds_return_t(w))
	}
	return &Writer{w: w, tp: tp, t: t}, nil
}

// Close deletes the writer and its topic handle. Cyclone keeps a deleted
// writer around until its last messages are acknowledged, for a while.
func (w *Writer) Close() error {
	if rc := C.dds_delete(w.w); rc < 0 {
		return retErr("delete writer", rc)
	}
	if rc := C.dds_delete(w.tp); rc < 0 {
		return retErr("delete topic", rc)
	}
	return nil
}

// Write publishes one message with payload p.
func (w *Writer) Write(p []byte) error {
	if w.t == String && bytes.IndexByte(p, 0) >= 0 {
		return errors.New("string payload contains NUL")
	}
	var ptr unsafe.Pointer
	if len(p) > 0 {
		ptr = unsafe.Pointer(&p[0])
	}
	if rc := C.hy_write(w.w, C.int(w.t), ptr, C.uint32_t(len(p))); rc < 0 {
		return retErr("write", rc)
	}
	return nil
}

// Reader subscribes to one topic.
type Reader struct {
	r  C.dds_entity_t
	ws C.dds_entity_t
	t  Type
}

// Reader creates a reliable, volatile reader on the ROS topic name. It
// does not hear writers of this process.
func (d *Domain) Reader(name string, t Type) (*Reader, error) {
	tp, err := d.topic(name, t)
	if err != nil {
		return nil, err
	}
	r := C.hy_reader(d.pp, tp, ReaderDepth)
	if r < 0 {
		return nil, retErr("create reader "+name, C.dds_return_t(r))
	}
	ws := C.dds_create_waitset(d.pp)
	if ws < 0 {
		return nil, retErr("create waitset", C.dds_return_t(ws))
	}
	rc := C.dds_create_readcondition(r, C.DDS_ANY_STATE)
	if rc < 0 {
		return nil, retErr("create readcondition", C.dds_return_t(rc))
	}
	if e := C.dds_waitset_attach(ws, rc, 0); e < 0 {
		return nil, retErr("attach readcondition", e)
	}
	return &Reader{r: r, ws: ws, t: t}, nil
}

// Take waits up to timeout for messages and returns the payloads of all
// that arrived, or none when the time is up.
func (r *Reader) Take(timeout time.Duration) ([][]byte, error) {
	if rc := C.dds_waitset_wait(r.ws, nil, 0, C.dds_duration_t(timeout.Nanoseconds())); rc < 0 {
		return nil, retErr("wait", rc)
	}
	var out [][]byte
	for {
		var p unsafe.Pointer
		var n C.uint32_t
		rc := C.hy_take(r.r, C.int(r.t), &p, &n)
		if rc < 0 {
			return out, retErr("take", rc)
		}
		if rc == 0 {
			return out, nil
		}
		out = append(out, C.GoBytes(p, C.int(n)))
		C.free(p)
	}
}
