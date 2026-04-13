package version

import (
	"testing"
)

func TestParseGitVersion(t *testing.T) {
	tests := []struct {
		name      string
		version   string
		wantMajor uint64
		wantMinor uint64
		wantPatch uint64
		wantErr   bool
	}{
		{"clean tag", "v0.0.20", 0, 0, 20, false},
		{"clean tag no v", "0.0.20", 0, 0, 20, false},
		{"commits ahead", "v0.0.20-12-g69a53ec", 0, 0, 20, false},
		{"commits ahead dirty", "v0.0.20-12-g69a53ec-dirty", 0, 0, 20, false},
		{"major minor", "v1.2.3", 1, 2, 3, false},
		{"major minor ahead", "v1.2.3-5-gabcdef0", 1, 2, 3, false},
		{"invalid", "notaversion", 0, 0, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, err := ParseGitVersion(tt.version)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if v.Major != tt.wantMajor || v.Minor != tt.wantMinor || v.Patch != tt.wantPatch {
				t.Errorf("got %d.%d.%d, want %d.%d.%d", v.Major, v.Minor, v.Patch, tt.wantMajor, tt.wantMinor, tt.wantPatch)
			}
		})
	}
}

func TestIsNewerVersion(t *testing.T) {
	tests := []struct {
		name       string
		local      string
		remote     string
		wantUpdate bool
	}{
		{"same version", "v0.0.20", "0.0.20", false},
		{"remote newer", "v0.0.20", "0.0.21", true},
		{"dev ahead same remote", "v0.0.20-12-g69a53ec-dirty", "0.0.20", false},
		{"dev ahead next release", "v0.0.20-12-g69a53ec-dirty", "0.0.21", true},
		{"remote older", "v0.0.21", "0.0.20", false},
		{"dev version", "dev", "0.0.20", false},
		{"invalid remote", "v0.0.20", "notaversion", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			old := Version
			Version = tt.local
			t.Cleanup(func() { Version = old })

			got := IsNewerVersion(tt.remote)
			if got != tt.wantUpdate {
				t.Errorf("IsNewerVersion(%q) with local %q = %v, want %v", tt.remote, tt.local, got, tt.wantUpdate)
			}
		})
	}
}
