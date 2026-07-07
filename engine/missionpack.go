package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/pkg/missionpkg"
	"github.com/projectqai/hydris/pkg/version"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

const exportRequestMaxBytes = 64 * 1024

type exportOpts struct {
	IncludeDiagnostic bool `json:"include_diagnostic,omitempty"`
	IncludeMissionKit bool `json:"include_mission_kit,omitempty"`
	// AllEntities packs the entire world instead of just the persistable
	// subset. Used by the diagnostics dump; a mission pack leaves it false.
	AllEntities bool   `json:"all_entities,omitempty"`
	UserNote    string `json:"user_note,omitempty"`

	WithArtifacts *bool `json:"with_artifacts,omitempty"`
	WithDefaults  *bool `json:"with_defaults,omitempty"`
	WithPolicy    *bool `json:"with_policy,omitempty"`
}

func (o exportOpts) resolveFilter() entityFilter {
	return entityFilter{
		WithArtifacts: o.WithArtifacts == nil || *o.WithArtifacts,
		WithDefaults:  o.WithDefaults != nil && *o.WithDefaults,
		WithPolicy:    o.WithPolicy == nil || *o.WithPolicy,
	}
}

type entityFilter struct {
	WithArtifacts bool
	WithDefaults  bool
	WithPolicy    bool
}

// handleMissionExport streams a mission pack tarball. The POST body is an
// optional JSON exportOpts. Forced options OR with body values.
func handleMissionExport(s *WorldServer, ring *LogRing, forced exportOpts) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := parseExportOpts(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		includeDiagnostic := forced.IncludeDiagnostic || body.IncludeDiagnostic
		includeMissionKit := forced.IncludeMissionKit || body.IncludeMissionKit
		// A diagnostic dump always carries the full world; the persistable
		// stub would hide exactly the transient state support needs to see.
		allEntities := forced.AllEntities || body.AllEntities || includeDiagnostic

		filter := body.resolveFilter()
		entities := s.snapshotForPack(allEntities, filter)
		worldYAML, err := entitiesToYAML(entities)
		if err != nil {
			slog.Warn("mission export: marshal world", "error", err)
			http.Error(w, "marshal world: "+err.Error(), http.StatusInternalServerError)
			return
		}

		now := time.Now().UTC()
		idx := missionpkg.Index{}

		if includeDiagnostic {
			host, _ := os.Hostname()
			idx.Diagnostic = &missionpkg.Diagnostic{
				Timestamp:   now.Format(time.RFC3339),
				Hostname:    host,
				OS:          runtime.GOOS,
				OSVersion:   osVersion(),
				Arch:        runtime.GOARCH,
				Version:     version.Version,
				NodeID:      s.nodeID,
				EntityCount: len(entities),
				Args:        os.Args,
				Uptime:      now.Sub(s.startTime).Round(time.Second).String(),
				Goroutines:  runtime.NumGoroutine(),
				UserNote:    body.UserNote,
			}
		}

		if includeMissionKit {
			localNode, err := s.getLocalNode(r.Context())
			if err == nil && localNode.GetDevice().GetNode().GetMission() != nil {
				mk := localNode.Device.Node.Mission
				idx.MissionKit = &missionpkg.MissionKit{Layouts: mk.Layouts}
			}
		}

		idx.Manifest = ComputeManifest(entities, idx)

		filename := fmt.Sprintf("%s_hydris-%s_%s.zip",
			nodeIDShort(s.nodeID),
			safeForFilename(version.Version),
			now.Format("20060102T150405Z"),
		)

		p := missionpkg.NewPacker(w, now)
		p.WriteWorld(worldYAML)
		p.WriteIndex(idx)
		if includeDiagnostic && ring != nil {
			p.WriteLogs(ring)
		}
		packArtifacts(r.Context(), p, entities)
		if err := p.Close(); err != nil {
			slog.Warn("mission pack: close writer", "error", err)
			return
		}

		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	})
}

func parseExportOpts(r *http.Request) (exportOpts, error) {
	var opts exportOpts
	body := http.MaxBytesReader(nil, r.Body, exportRequestMaxBytes)
	err := json.NewDecoder(body).Decode(&opts)
	if errors.Is(err, io.EOF) {
		return opts, nil
	}
	if err != nil {
		return opts, fmt.Errorf("parse body: %w", err)
	}
	return opts, nil
}

// packArtifacts copies each entity's referenced artifact blob into the pack.
// Entries with no Artifact component or whose blob isn't in the local store
// are skipped — a snapshot may reference artifacts that live on a peer.
func packArtifacts(ctx context.Context, p *missionpkg.Packer, entities []*pb.Entity) {
	if artifacts.Server == nil {
		return
	}
	store := artifacts.Server.Local()
	if store == nil {
		return
	}
	seen := make(map[string]bool)
	for _, e := range entities {
		if e.Artifact == nil {
			continue
		}
		id := e.Artifact.Id //nolint:staticcheck // SA1019: Artifact.Id migration pending
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		rc, err := store.Get(ctx, id)
		if err != nil {
			slog.Warn("mission export: skip artifact", "id", id, "error", err)
			continue
		}
		p.WriteArtifact(id, rc)
		rc.Close()
	}
}

// ComputeManifest records what's about to be packed so receivers can compare
// against observed state after apply. Pure function over the snapshotted
// entities and the already-populated Index. Exported so the CLI's mission
// build can write the same metadata into offline packs.
func ComputeManifest(entities []*pb.Entity, idx missionpkg.Index) *missionpkg.Manifest {
	m := &missionpkg.Manifest{
		EntityCount:      len(entities),
		EntityIDs:        make([]string, 0, len(entities)),
		HydrisVersion:    version.Version,
		ViewStatePresent: len(idx.ViewState) > 0,
	}
	for _, e := range entities {
		m.EntityIDs = append(m.EntityIDs, e.Id)
	}
	if idx.MissionKit != nil {
		m.MissionKitPresent = true
		m.LayoutNames = make([]string, 0, len(idx.MissionKit.Layouts))
		for name := range idx.MissionKit.Layouts {
			m.LayoutNames = append(m.LayoutNames, name)
		}
		slices.Sort(m.LayoutNames)
	}
	return m
}

// isUnmodifiedDefault reports whether e was loaded by LoadDefaults and never
// changed. LoadDefaults stamps Fresh to Unix epoch; any real update moves it
// forward.
func isUnmodifiedDefault(e *pb.Entity) bool {
	fresh := e.GetLifetime().GetFresh()
	return fresh != nil && fresh.AsTime().Equal(time.Unix(0, 0))
}

// snapshotForPack returns the entities to write into a mission pack, sorted by
// ID for stable output.
//
// With all=false (a mission pack) it returns only the durable, redeployable
// subset of head, selected by the same isPersisted rule FlushToFile uses and
// reduced to the same persistableStub. This keeps short-lived entities —
// tracks, detections, connections — out of the pack and its manifest, so a
// re-opened import doesn't report them as missing once they have expired from
// the live world.
//
// With all=true (a diagnostics dump) it returns the entire world so support can
// see transient and remote state.
func (s *WorldServer) snapshotForPack(all bool, f entityFilter) []*pb.Entity {
	s.l.RLock()
	entities := make([]*pb.Entity, 0, len(s.head))
	for _, es := range s.head {
		if all {
			entities = append(entities, proto.Clone(es.entity).(*pb.Entity))
			continue
		}
		if !s.isPersisted(es) {
			continue
		}
		if !f.WithDefaults && isUnmodifiedDefault(es.entity) {
			continue
		}
		stub := es.persistableStub()
		if !f.WithArtifacts {
			stub.Artifact = nil
		}
		if !f.WithPolicy {
			stub.Policy = nil
		}
		entities = append(entities, stub)
	}
	s.l.RUnlock()

	slices.SortFunc(entities, func(a, b *pb.Entity) int {
		return strings.Compare(a.Id, b.Id)
	})
	return entities
}

// safeForFilename keeps [A-Za-z0-9._-] and replaces everything else with '-'.
// Returns "unknown" when input is empty.
func safeForFilename(s string) string {
	if s == "" {
		return "unknown"
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	if b.Len() == 0 {
		return "unknown"
	}
	return b.String()
}

func adoptEntities(entities []*pb.Entity, nodeID string) []*pb.Entity {
	out := make([]*pb.Entity, 0, len(entities))
	for _, e := range entities {
		// do not adopt node entities at all
		if e.Device != nil && e.Device.Node != nil {
			continue
		}

		if e.Controller != nil {
			// now owned by our own node
			e.Controller.Origin = proto.String("node." + nodeID)
			e.Controller.Node = proto.String(nodeID)
		}

		out = append(out, e)
	}
	return out
}

func nodeIDShort(id string) string {
	if id == "" {
		return "unknown"
	}
	out := safeForFilename(id)
	if len(out) > 8 {
		return out[:8]
	}
	return out
}
