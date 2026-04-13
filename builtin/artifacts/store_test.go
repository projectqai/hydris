package artifacts

import (
	"testing"
)

func TestPluginStoreRegistry(t *testing.T) {
	// Clean up any existing registrations.
	pluginStoresMu.Lock()
	pluginStores = nil
	pluginStoresMu.Unlock()

	// Initially empty.
	if _, ok := LastPluginStore(); ok {
		t.Fatal("expected no plugin stores")
	}
	if stores := PluginStores(); len(stores) != 0 {
		t.Fatalf("expected 0 stores, got %d", len(stores))
	}

	// Register a store.
	dummy := &LocalStore{dataDir: "/tmp/dummy1"}
	RegisterPluginStore("test-s3", dummy)

	ns, ok := LastPluginStore()
	if !ok || ns.Name != "test-s3" {
		t.Fatalf("expected test-s3, got %v", ns.Name)
	}

	// Register another — last one wins.
	dummy2 := &LocalStore{dataDir: "/tmp/dummy2"}
	RegisterPluginStore("test-minio", dummy2)

	ns, ok = LastPluginStore()
	if !ok || ns.Name != "test-minio" {
		t.Fatalf("expected test-minio, got %v", ns.Name)
	}

	if stores := PluginStores(); len(stores) != 2 {
		t.Fatalf("expected 2 stores, got %d", len(stores))
	}

	// Lookup by name.
	s, ok := GetPluginStore("test-s3")
	if !ok || s != dummy {
		t.Fatal("expected to find test-s3")
	}
	_, ok = GetPluginStore("nonexistent")
	if ok {
		t.Fatal("expected not to find nonexistent")
	}

	// Re-register replaces existing.
	dummy3 := &LocalStore{dataDir: "/tmp/dummy3"}
	RegisterPluginStore("test-s3", dummy3)
	if stores := PluginStores(); len(stores) != 2 {
		t.Fatalf("expected 2 stores after replace, got %d", len(stores))
	}
	s, _ = GetPluginStore("test-s3")
	if s != dummy3 {
		t.Fatal("expected replaced store")
	}

	// Unregister.
	UnregisterPluginStore("test-s3")
	if stores := PluginStores(); len(stores) != 1 {
		t.Fatalf("expected 1 store after unregister, got %d", len(stores))
	}

	UnregisterPluginStore("test-minio")
	if stores := PluginStores(); len(stores) != 0 {
		t.Fatalf("expected 0 stores, got %d", len(stores))
	}

	// Unregister nonexistent is a no-op.
	UnregisterPluginStore("nonexistent")
}
