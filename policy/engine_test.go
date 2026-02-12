package policy

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
)

func TestPresentFields(t *testing.T) {
	tests := []struct {
		name     string
		entity   *pb.Entity
		expected []int
	}{
		{
			name:     "empty entity",
			entity:   &pb.Entity{},
			expected: nil,
		},
		{
			name:     "entity with id only",
			entity:   &pb.Entity{Id: "test-id"},
			expected: []int{1}, // id is field 1
		},
		{
			name: "entity with geo",
			entity: &pb.Entity{
				Id:  "test-id",
				Geo: &pb.GeoSpatialComponent{Latitude: 1.0, Longitude: 2.0},
			},
			expected: []int{1, 11}, // id=1, geo=11
		},
		{
			name: "entity with multiple components",
			entity: &pb.Entity{
				Id:     "test-id",
				Label:  strPtr("test-label"),
				Geo:    &pb.GeoSpatialComponent{Latitude: 1.0, Longitude: 2.0},
				Symbol: &pb.SymbolComponent{},
			},
			expected: []int{1, 2, 11, 12}, // id=1, label=2, geo=11, symbol=12
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fields := presentFields(tt.entity)

			if len(fields) != len(tt.expected) {
				t.Errorf("expected %d fields, got %d: %v", len(tt.expected), len(fields), fields)
				return
			}

			fieldSet := make(map[int]bool)
			for _, f := range fields {
				fieldSet[f] = true
			}

			for _, exp := range tt.expected {
				if !fieldSet[exp] {
					t.Errorf("expected field %d to be present, got %v", exp, fields)
				}
			}
		})
	}
}

func TestAbilityFor(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		wantIP     string
	}{
		{
			name:       "with port",
			remoteAddr: "192.168.1.1:12345",
			wantIP:     "192.168.1.1",
		},
		{
			name:       "without port",
			remoteAddr: "192.168.1.1",
			wantIP:     "192.168.1.1",
		},
		{
			name:       "ipv6 with port",
			remoteAddr: "[::1]:12345",
			wantIP:     "::1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ability := For(nil, tt.remoteAddr)

			if ability.sourceIP != tt.wantIP {
				t.Errorf("expected source_ip %q, got %q", tt.wantIP, ability.sourceIP)
			}
		})
	}
}

func TestAbilityCanRead(t *testing.T) {
	tmpDir := t.TempDir()
	policyFile := filepath.Join(tmpDir, "policy.rego")

	// Policy that allows read only from specific IPs
	policy := `
package hydris.authz

default allow = false

allow if {
	input.action == "read"
	input.connection.source_ip == "192.168.1.1"
}
`
	if err := os.WriteFile(policyFile, []byte(policy), 0644); err != nil {
		t.Fatalf("failed to write policy file: %v", err)
	}

	engine, err := NewEngine(policyFile)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	defer func() { _ = engine.Close() }()

	entity := &pb.Entity{Id: "e1"}

	// Allowed
	if !For(engine, "192.168.1.1:12345").CanRead(context.Background(), entity) {
		t.Error("expected read to be allowed from 192.168.1.1")
	}

	// Denied
	if For(engine, "10.0.0.1:12345").CanRead(context.Background(), entity) {
		t.Error("expected read to be denied from 10.0.0.1")
	}
}

func TestAbilityAuthorizeWrite(t *testing.T) {
	tmpDir := t.TempDir()
	policyFile := filepath.Join(tmpDir, "policy.rego")

	// Policy that allows write only from specific IPs
	policy := `
package hydris.authz

default allow = false

allow if {
	input.action == "write"
	input.connection.source_ip == "192.168.1.1"
}
`
	if err := os.WriteFile(policyFile, []byte(policy), 0644); err != nil {
		t.Fatalf("failed to write policy file: %v", err)
	}

	engine, err := NewEngine(policyFile)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	defer func() { _ = engine.Close() }()

	entity := &pb.Entity{Id: "e1"}

	// Allowed
	err = For(engine, "192.168.1.1:12345").AuthorizeWrite(context.Background(), entity)
	if err != nil {
		t.Errorf("expected no error for allowed IP, got %v", err)
	}

	// Denied
	err = For(engine, "10.0.0.1:12345").AuthorizeWrite(context.Background(), entity)
	if err == nil {
		t.Error("expected error for denied IP")
	}
}

func TestAbilityAuthorizeTimeline(t *testing.T) {
	tmpDir := t.TempDir()
	policyFile := filepath.Join(tmpDir, "policy.rego")

	// Policy that allows timeline only from specific IPs
	policy := `
package hydris.authz

default allow = false

allow if {
	input.action == "timeline"
	input.connection.source_ip == "192.168.1.1"
}
`
	if err := os.WriteFile(policyFile, []byte(policy), 0644); err != nil {
		t.Fatalf("failed to write policy file: %v", err)
	}

	engine, err := NewEngine(policyFile)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	defer func() { _ = engine.Close() }()

	// Allowed
	err = For(engine, "192.168.1.1:12345").AuthorizeTimeline(context.Background())
	if err != nil {
		t.Errorf("expected no error for allowed IP, got %v", err)
	}

	// Denied
	err = For(engine, "10.0.0.1:12345").AuthorizeTimeline(context.Background())
	if err == nil {
		t.Error("expected error for denied IP")
	}
}

func TestAbilityWithEntityComponents(t *testing.T) {
	tmpDir := t.TempDir()
	policyFile := filepath.Join(tmpDir, "policy.rego")

	// Policy that denies write for entities with geo component from untrusted IPs
	policy := `
package hydris.authz

default allow = true

# Deny write if entity has geo (field 11) and IP is not trusted
allow := false if {
	input.action == "write"
	11 in input.entity.components
	input.connection.source_ip != "192.168.1.1"
}
`
	if err := os.WriteFile(policyFile, []byte(policy), 0644); err != nil {
		t.Fatalf("failed to write policy file: %v", err)
	}

	engine, err := NewEngine(policyFile)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	defer func() { _ = engine.Close() }()

	entityWithGeo := &pb.Entity{Id: "e1", Geo: &pb.GeoSpatialComponent{}}
	entityWithoutGeo := &pb.Entity{Id: "e1", Label: strPtr("test")}

	tests := []struct {
		name       string
		remoteAddr string
		entity     *pb.Entity
		wantErr    bool
	}{
		{
			name:       "trusted IP with geo",
			remoteAddr: "192.168.1.1:12345",
			entity:     entityWithGeo,
			wantErr:    false,
		},
		{
			name:       "untrusted IP with geo",
			remoteAddr: "10.0.0.1:12345",
			entity:     entityWithGeo,
			wantErr:    true,
		},
		{
			name:       "untrusted IP without geo",
			remoteAddr: "10.0.0.1:12345",
			entity:     entityWithoutGeo,
			wantErr:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := For(engine, tt.remoteAddr).AuthorizeWrite(context.Background(), tt.entity)
			if (err != nil) != tt.wantErr {
				t.Errorf("AuthorizeWrite() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestEngineReload(t *testing.T) {
	tmpDir := t.TempDir()
	policyFile := filepath.Join(tmpDir, "policy.rego")

	// Initial policy: allow all
	policy1 := `
package hydris.authz
default allow = true
`
	if err := os.WriteFile(policyFile, []byte(policy1), 0644); err != nil {
		t.Fatalf("failed to write policy file: %v", err)
	}

	engine, err := NewEngine(policyFile)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	defer func() { _ = engine.Close() }()

	entity := &pb.Entity{Id: "e1"}

	// Verify initial policy allows (use external IP to skip localhost bypass)
	ability := For(engine, "10.0.0.1:12345")
	if !ability.CanRead(context.Background(), entity) {
		t.Error("expected allowed=true with initial policy")
	}

	// Update policy: deny all
	policy2 := `
package hydris.authz
default allow = false
`
	if err := os.WriteFile(policyFile, []byte(policy2), 0644); err != nil {
		t.Fatalf("failed to write updated policy: %v", err)
	}

	// Wait for file watcher to pick up the change
	time.Sleep(100 * time.Millisecond)

	// Verify updated policy denies
	if ability.CanRead(context.Background(), entity) {
		t.Error("expected allowed=false with updated policy")
	}
}

func TestEngineReloadInvalidPolicy(t *testing.T) {
	tmpDir := t.TempDir()
	policyFile := filepath.Join(tmpDir, "policy.rego")

	// Initial valid policy
	validPolicy := `
package hydris.authz
default allow = true
`
	if err := os.WriteFile(policyFile, []byte(validPolicy), 0644); err != nil {
		t.Fatalf("failed to write policy file: %v", err)
	}

	engine, err := NewEngine(policyFile)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	defer func() { _ = engine.Close() }()

	// Write invalid policy
	invalidPolicy := `
package hydris.authz
this is not valid rego syntax!!!
`
	if err := os.WriteFile(policyFile, []byte(invalidPolicy), 0644); err != nil {
		t.Fatalf("failed to write invalid policy: %v", err)
	}

	// Wait for file watcher
	time.Sleep(100 * time.Millisecond)

	// Should still work with the previous valid policy (use external IP)
	entity := &pb.Entity{Id: "e1"}
	ability := For(engine, "10.0.0.1:12345")
	if !ability.CanRead(context.Background(), entity) {
		t.Error("expected allowed=true (previous policy should be preserved)")
	}
}

func TestAbilityNilEngine(t *testing.T) {
	// When engine is nil, everything should be allowed
	ability := For(nil, "10.0.0.1:12345")
	entity := &pb.Entity{Id: "e1"}

	if !ability.CanRead(context.Background(), entity) {
		t.Error("expected allowed=true when engine is nil")
	}

	if err := ability.AuthorizeWrite(context.Background(), entity); err != nil {
		t.Errorf("expected no error when engine is nil, got %v", err)
	}

	if err := ability.AuthorizeTimeline(context.Background()); err != nil {
		t.Errorf("expected no error when engine is nil, got %v", err)
	}
}

func strPtr(s string) *string {
	return &s
}
