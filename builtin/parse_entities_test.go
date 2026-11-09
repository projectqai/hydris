package builtin

import (
	"strings"
	"testing"
)

const unknownFieldDoc = `
id: node-a
device:
  node:
    hostname: a
    futureField: x
---
id: plain
`

func TestParseEntitiesStrictRejectsUnknown(t *testing.T) {
	if _, err := ParseEntities([]byte(unknownFieldDoc)); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected unknown field error, got %v", err)
	}
}

func TestParseEntitiesLenientDiscardsUnknown(t *testing.T) {
	entities, discarded, err := ParseEntitiesLenient([]byte(unknownFieldDoc))
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 2 {
		t.Fatalf("want 2 entities, got %d", len(entities))
	}
	if got := entities[0].GetDevice().GetNode().GetHostname(); got != "a" {
		t.Fatalf("known field lost: hostname=%q", got)
	}
	if len(discarded) != 1 || !strings.Contains(discarded[0].Error(), `"node-a"`) {
		t.Fatalf("want one discard report for node-a, got %v", discarded)
	}
}

func TestParseEntitiesLenientStillRejectsBadTypes(t *testing.T) {
	if _, _, err := ParseEntitiesLenient([]byte("id: x\ndevice:\n  node:\n    numCpu: notanumber\n")); err == nil {
		t.Fatal("expected type error to stay fatal")
	}
}
