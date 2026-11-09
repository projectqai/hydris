package engine

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/projectqai/hydris/builtin/artifacts"
	pb "github.com/projectqai/proto/go"
)

func TestHandleArtifactGet_RangeAndETag(t *testing.T) {
	store, err := artifacts.NewLocalStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	artifacts.Server = artifacts.NewArtifactServer(store, nil)
	t.Cleanup(func() { artifacts.Server = nil })

	body := []byte("0123456789")
	if err := store.Put(context.Background(), "e1", bytes.NewReader(body)); err != nil {
		t.Fatal(err)
	}

	sha := "deadbeef"
	w := testWorld(map[string]*pb.Entity{
		"e1": {Id: "e1", Artifact: &pb.ArtifactComponent{Id: "e1", ContentType: "audio/mpeg", Sha256: &sha}}, //nolint:staticcheck // SA1019
	})
	handler := handleArtifactGet(w)

	req := httptest.NewRequest("GET", "/artifacts/e1", nil)
	req.SetPathValue("id", "e1")
	req.Header.Set("Range", "bytes=0-3")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != 206 {
		t.Fatalf("expected 206 Partial Content, got %d", rec.Code)
	}
	if got := rec.Body.String(); got != "0123" {
		t.Errorf("expected partial body %q, got %q", "0123", got)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Errorf("expected Content-Type audio/mpeg, got %q", ct)
	}
	etag := rec.Header().Get("ETag")
	if etag != `"deadbeef"` {
		t.Errorf("expected ETag %q, got %q", `"deadbeef"`, etag)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("expected Cache-Control no-cache, got %q", cc)
	}

	// Conditional GET with matching If-None-Match should short-circuit to 304.
	req2 := httptest.NewRequest("GET", "/artifacts/e1", nil)
	req2.SetPathValue("id", "e1")
	req2.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)

	if rec2.Code != 304 {
		t.Fatalf("expected 304 Not Modified, got %d", rec2.Code)
	}
}

type remoteOnlyStore struct{ data map[string][]byte }

func (s *remoteOnlyStore) Get(_ context.Context, id string) (io.ReadCloser, error) {
	b, ok := s.data[id]
	if !ok {
		return nil, os.ErrNotExist
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}
func (s *remoteOnlyStore) Put(context.Context, string, io.Reader) error { return errors.New("unused") }
func (s *remoteOnlyStore) Delete(context.Context, string) error         { return nil }
func (s *remoteOnlyStore) Exists(context.Context, string) (bool, error) { return false, nil }

func TestHandleArtifactGet_RemoteBackendFallsBackWithoutRange(t *testing.T) {
	local, err := artifacts.NewLocalStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	artifacts.Server = artifacts.NewArtifactServer(local, nil)
	t.Cleanup(func() { artifacts.Server = nil })

	body := []byte("remote-bytes-not-on-disk")
	artifacts.Server.SetStore(&remoteOnlyStore{data: map[string][]byte{"e2": body}})

	sha := "cafef00d"
	w := testWorld(map[string]*pb.Entity{
		"e2": {Id: "e2", Artifact: &pb.ArtifactComponent{Id: "e2", ContentType: "application/octet-stream", Sha256: &sha}}, //nolint:staticcheck // SA1019
	})
	handler := handleArtifactGet(w)

	req := httptest.NewRequest("GET", "/artifacts/e2", nil)
	req.SetPathValue("id", "e2")
	req.Header.Set("Range", "bytes=0-3")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("expected 200 (no Range support for remote store), got %d", rec.Code)
	}
	if got := rec.Body.Bytes(); !bytes.Equal(got, body) {
		t.Errorf("expected body %q, got %q", body, got)
	}
	if etag := rec.Header().Get("ETag"); etag != `"cafef00d"` {
		t.Errorf("expected ETag %q, got %q", `"cafef00d"`, etag)
	}
}
