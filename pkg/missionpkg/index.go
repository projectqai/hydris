// Package missionpkg defines the mission pack archive format: a zip containing
// world.yaml, index.json, optional logs.txt, and optional artifacts/<id>
// entries. Index fields are all optional. Consumers branch on presence or
// absence.
package missionpkg

import "encoding/json"

type Index struct {
	MissionKit *MissionKit     `json:"missionkit,omitempty"`
	ViewState  json.RawMessage `json:"view_state,omitempty"`
	Diagnostic *Diagnostic     `json:"diagnostic,omitempty"`
	Manifest   *Manifest       `json:"manifest,omitempty"`
}

// Manifest records what the packer packed. Receivers compare against
// observed state after apply to verify the import landed completely.
type Manifest struct {
	EntityCount       int      `json:"entity_count"`
	EntityIDs         []string `json:"entity_ids,omitempty"`
	LayoutNames       []string `json:"layout_names,omitempty"`
	MissionKitPresent bool     `json:"mission_kit_present"`
	ViewStatePresent  bool     `json:"view_state_present"`
	HydrisVersion     string   `json:"hydris_version,omitempty"`
}

type MissionKit struct {
	Layouts map[string]string `json:"layouts,omitempty"`
}

type Diagnostic struct {
	Timestamp   string   `json:"timestamp"`
	Hostname    string   `json:"hostname"`
	OS          string   `json:"os"`
	OSVersion   string   `json:"os_version,omitempty"`
	Arch        string   `json:"arch"`
	Version     string   `json:"version"`
	NodeID      string   `json:"node_id,omitempty"`
	EntityCount int      `json:"entity_count"`
	Args        []string `json:"args"`
	Uptime      string   `json:"uptime"`
	Goroutines  int      `json:"goroutines"`
	UserNote    string   `json:"user_note,omitempty"`
}
