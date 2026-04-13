package artifacts

import (
	"bytes"
	"context"
	"io"
	"os"
	"testing"
)

func TestLocalStore_PutGetDeleteExists(t *testing.T) {
	dir := t.TempDir()
	store, err := NewLocalStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// Exists should be false initially.
	ok, err := store.Exists(ctx, "test-blob")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected blob to not exist")
	}

	// Put a blob.
	data := []byte("hello artifact world")
	if err := store.Put(ctx, "test-blob", bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}

	// Exists should be true.
	ok, err = store.Exists(ctx, "test-blob")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected blob to exist")
	}

	// Get it back.
	rc, err := store.Get(ctx, "test-blob")
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(rc)
	rc.Close()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, data) {
		t.Fatalf("got %q, want %q", got, data)
	}

	// Delete it.
	if err := store.Delete(ctx, "test-blob"); err != nil {
		t.Fatal(err)
	}

	// Should no longer exist.
	ok, err = store.Exists(ctx, "test-blob")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected blob to be deleted")
	}

	// Get should fail.
	_, err = store.Get(ctx, "test-blob")
	if err == nil {
		t.Fatal("expected error on Get after delete")
	}
}

func TestLocalStore_DeleteNonexistent(t *testing.T) {
	dir := t.TempDir()
	store, err := NewLocalStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Deleting a non-existent blob should succeed (idempotent).
	if err := store.Delete(context.Background(), "no-such-blob"); err != nil {
		t.Fatal(err)
	}
}

func TestLocalStore_DiskGuard(t *testing.T) {
	// Test that Put fails when disk space cannot be determined (fail closed).
	store := &LocalStore{dataDir: "/nonexistent/path/that/does/not/exist"}
	err := store.Put(context.Background(), "test", bytes.NewReader([]byte("data")))
	if err == nil {
		t.Fatal("expected error for non-existent path")
	}
}

func TestLocalStore_AtomicPut(t *testing.T) {
	dir := t.TempDir()
	store, err := NewLocalStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// Put should be atomic — no partial files on success.
	data := bytes.Repeat([]byte("x"), 1024*1024) // 1MB
	if err := store.Put(ctx, "big-blob", bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}

	// Verify no temp files left.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() != "big-blob" {
			t.Fatalf("unexpected file in store dir: %s", e.Name())
		}
	}
}
