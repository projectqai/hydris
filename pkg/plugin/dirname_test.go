package plugin

import (
	"strings"
	"testing"
)

func TestDirName(t *testing.T) {
	for id, want := range map[string]string{
		"sapient.plugin": "sapient_2Eplugin",
		"plugins.cue":    "plugins_2Ecue",
		"sapient:x/1":    "sapient_3Ax_2F1",
		"my_plugin":      "my__plugin",
		"Sapient":        "_53apient",
		"a%3Ab":          "a_253_41b",
		".hidden":        "_2Ehidden",
		"trailing.":      "trailing_2E",
		"..":             "_2E_2E",
		"con":            "_63on",
		"nul.plugin":     "nul_2Eplugin",
		"com1":           "_63om1",
		"console":        "console",
	} {
		if got := dirName(id); got != want {
			t.Errorf("dirName(%q) = %q, want %q", id, got, want)
		}
	}

	// Distinct ids never share a directory, whatever they look like.
	seen := map[string]string{}
	for _, id := range []string{"a:b", "a/b", "a_b", "A_b", "a_3Ab", "a_3ab", "a__b", "con", "Con", "x.", "x_2E", "x_2e", "_", "__"} {
		name := dirName(id)
		if other, ok := seen[strings.ToLower(name)]; ok {
			t.Errorf("%q and %q share %q", id, other, name)
		}
		seen[strings.ToLower(name)] = id
	}

	long := strings.Repeat("x", 300)
	if a, b := dirName(long), dirName(long+"y"); len(a) > 200 || a == b || !strings.Contains(a, "_-") {
		t.Errorf("long ids: %q, %q", a, b)
	}
}
