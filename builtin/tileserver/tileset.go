package tileserver

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type tileset struct {
	name   string
	format string
	layers []string
	db     *sql.DB
}

type mbtilesMetadata struct {
	VectorLayers []mbtilesVectorLayer `json:"vector_layers"`
}

type mbtilesVectorLayer struct {
	ID string `json:"id"`
}

func openTileset(path string) (*tileset, error) {
	u := &url.URL{
		Scheme:   "file",
		Opaque:   filepath.ToSlash(path),
		RawQuery: "mode=ro&immutable=1",
	}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping %s: %w", path, err)
	}
	ts := &tileset{db: db, format: "png"}
	_ = db.QueryRow(`SELECT value FROM metadata WHERE name='name' AND value != ''`).Scan(&ts.name)
	_ = db.QueryRow(`SELECT value FROM metadata WHERE name='format' AND value != ''`).Scan(&ts.format)

	// vector mbtiles list source layers in json row
	var rawJSON string
	_ = db.QueryRow(`SELECT value FROM metadata WHERE name='json'`).Scan(&rawJSON)
	var meta mbtilesMetadata
	_ = json.Unmarshal([]byte(rawJSON), &meta)
	for _, layer := range meta.VectorLayers {
		if layer.ID != "" {
			ts.layers = append(ts.layers, layer.ID)
		}
	}
	return ts, nil
}

func (t *tileset) tile(ctx context.Context, z, x, y int) ([]byte, error) {
	tmsY := (1 << z) - 1 - y // mbtiles stores rows flipped from XYZ (TMS)
	var data []byte
	err := t.db.QueryRowContext(ctx,
		`SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?`,
		z, x, tmsY,
	).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return data, err
}
