package missionpkg

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"
)

type Unpacked struct {
	World     []byte
	Index     Index
	Logs      []byte
	Artifacts []Artifact
}

type Artifact struct {
	ID   string
	Data []byte
}

var maxDecompressedBytes int64 = 512 << 20 // 512 MB total inflated

func Unpack(ctx context.Context, r io.ReaderAt, size int64) (Unpacked, error) {
	var out Unpacked

	zr, err := zip.NewReader(r, size)
	if err != nil {
		return out, fmt.Errorf("missionpkg: not a zip mission pack: %w", err)
	}
	var inflated int64
	for _, f := range zr.File {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if f.FileInfo().IsDir() {
			continue
		}
		name := path.Clean(f.Name)
		if strings.Contains(name, "..") || path.IsAbs(name) {
			return out, fmt.Errorf("missionpkg: unsafe entry %q", f.Name)
		}
		data, err := readEntry(f, &inflated)
		if err != nil {
			return out, err
		}
		switch {
		case name == "world.yaml":
			out.World = data
		case name == "index.json":
			data = bytes.TrimSpace(data)
			if len(data) == 0 {
				continue
			}
			if err := json.Unmarshal(data, &out.Index); err != nil {
				return out, fmt.Errorf("parse index.json: %w", err)
			}
		case name == "logs.txt":
			out.Logs = data
		case strings.HasPrefix(name, "artifacts/"):
			id := strings.TrimPrefix(name, "artifacts/")
			if id == "" {
				continue
			}
			out.Artifacts = append(out.Artifacts, Artifact{ID: id, Data: data})
		}
	}
	return out, nil
}

func readEntry(f *zip.File, inflated *int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", f.Name, err)
	}
	defer rc.Close()
	remaining := maxDecompressedBytes - *inflated
	data, err := io.ReadAll(io.LimitReader(rc, remaining+1))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", f.Name, err)
	}
	if int64(len(data)) > remaining {
		return nil, fmt.Errorf("missionpkg: decompressed contents exceed %d byte limit", maxDecompressedBytes)
	}
	*inflated += int64(len(data))
	return data, nil
}
