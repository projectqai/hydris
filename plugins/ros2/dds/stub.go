//go:build !cyclonedds || !cgo

package dds

import "time"

type Domain struct{}

func Open(id uint32) (*Domain, error) { return nil, ErrUnavailable }

func (d *Domain) Close() error { return nil }

type Writer struct{}

func (d *Domain) Writer(name string, t Type, qos QoS) (*Writer, error) { return nil, ErrUnavailable }

func (w *Writer) Write(p []byte) error { return ErrUnavailable }

func (w *Writer) Close() error { return nil }

type Reader struct{}

func (d *Domain) Reader(name string, t Type) (*Reader, error) { return nil, ErrUnavailable }

func (r *Reader) Take(timeout time.Duration) ([][]byte, error) { return nil, ErrUnavailable }
