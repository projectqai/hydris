package missionpkg

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// Packer writes a mission pack: a zip containing world.yaml, index.json, an
// optional logs.txt, and optional artifacts/<id> entries. Write methods are
// best-effort and silent; the first error is held until Close returns it.
type Packer struct {
	zw      *zip.Writer
	modTime time.Time
	err     error
}

func NewPacker(w io.Writer, modTime time.Time) *Packer {
	return &Packer{zw: zip.NewWriter(w), modTime: modTime}
}

func (p *Packer) WriteWorld(yaml []byte) {
	p.writeFile("world.yaml", yaml)
}

func (p *Packer) WriteIndex(idx Index) {
	if p.err != nil {
		return
	}
	data, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		p.err = fmt.Errorf("marshal index: %w", err)
		return
	}
	p.writeFile("index.json", data)
}

func (p *Packer) WriteLogs(src io.WriterTo) {
	w := p.create("logs.txt")
	if w == nil {
		return
	}
	if _, err := src.WriteTo(w); err != nil {
		p.err = fmt.Errorf("zip body logs.txt: %w", err)
	}
}

func (p *Packer) WriteArtifact(id string, body io.Reader) {
	name := "artifacts/" + id
	w := p.create(name)
	if w == nil {
		return
	}
	if _, err := io.Copy(w, body); err != nil {
		p.err = fmt.Errorf("zip body %s: %w", name, err)
	}
}

func (p *Packer) Close() error {
	if err := p.zw.Close(); err != nil && p.err == nil {
		p.err = err
	}
	return p.err
}

func (p *Packer) writeFile(name string, data []byte) {
	w := p.create(name)
	if w == nil {
		return
	}
	if _, err := w.Write(data); err != nil {
		p.err = fmt.Errorf("zip body %s: %w", name, err)
	}
}

func (p *Packer) create(name string) io.Writer {
	if p.err != nil {
		return nil
	}
	w, err := p.zw.CreateHeader(&zip.FileHeader{
		Name:     name,
		Method:   zip.Deflate,
		Modified: p.modTime,
	})
	if err != nil {
		p.err = fmt.Errorf("zip entry %s: %w", name, err)
		return nil
	}
	return w
}
