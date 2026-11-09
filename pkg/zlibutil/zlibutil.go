package zlibutil

import (
	"bytes"
	"compress/zlib"
	"io"
)

// MaxDecompressedSize caps Decompress's output against a zlib bomb.
const MaxDecompressedSize = 1 << 20 // 1 MiB

func Compress(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	w := zlib.NewWriter(&buf)
	if _, err := w.Write(data); err != nil {
		_ = w.Close()
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func Decompress(data []byte) ([]byte, error) {
	r, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer func() { _ = r.Close() }()
	return io.ReadAll(io.LimitReader(r, MaxDecompressedSize))
}
