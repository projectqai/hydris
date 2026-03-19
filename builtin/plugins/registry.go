// Package plugins implements a builtin controller that fetches a plugin
// registry index and presents each available plugin as a configurable
// entity. Enabled plugins are run as isolated subprocesses.
//
// The index is loaded from index.json next to the executable first,
// falling back to the upstream GitHub copy.
package plugins

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// RegistryURL is the raw GitHub URL used as a fallback when no local
// index.json exists next to the executable.
const RegistryURL = "https://raw.githubusercontent.com/projectqai/hydris/main/index.json"

// PluginIndex is the top-level structure of index.json.
type PluginIndex struct {
	HydrisVersion string       `json:"hydris_version"`
	Plugins       []PluginInfo `json:"plugins"`
}

// PluginInfo describes a single plugin in the registry.
type PluginInfo struct {
	Name        string `json:"name"`
	Ref         string `json:"ref"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Icon        string `json:"icon,omitempty"`
	Compat      string `json:"compat,omitempty"` // semver range for hydris version compatibility
}

// FetchIndex tries to read index.json from the directory containing the
// running executable. If that file does not exist or cannot be parsed,
// it falls back to fetching the index from GitHub.
func FetchIndex(ctx context.Context) (*PluginIndex, error) {
	if idx, err := loadLocalIndex(); err == nil {
		slog.Info("loaded plugin index from local file")
		return idx, nil
	}

	return FetchRemoteIndexFromURL(ctx, RegistryURL, "")
}

func loadLocalIndex() (*PluginIndex, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(filepath.Dir(exe), "index.json")

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var index PluginIndex
	if err := json.Unmarshal(data, &index); err != nil {
		return nil, fmt.Errorf("decode local index: %w", err)
	}
	return &index, nil
}

// FetchRemoteIndexFromURL fetches and parses an index.json from the given URL.
// If token is non-empty it is sent as a Bearer Authorization header.
func FetchRemoteIndexFromURL(ctx context.Context, url, token string) (*PluginIndex, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch registry index: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("registry index returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MB limit
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	var index PluginIndex
	if err := json.Unmarshal(body, &index); err != nil {
		return nil, fmt.Errorf("decode index: %w", err)
	}

	return &index, nil
}
