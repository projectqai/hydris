package engine

import (
	"os/exec"
	"strings"
)

func osVersion() string {
	out, err := exec.Command("sw_vers", "-productVersion").Output()
	if err == nil {
		return "macOS " + strings.TrimSpace(string(out))
	}
	return "macOS"
}
