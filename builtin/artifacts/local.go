package artifacts

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// LocalStore stores artifact blobs as flat files on the local filesystem.
type LocalStore struct {
	dataDir string
}

// NewLocalStore creates a LocalStore, creating dataDir if needed.
func NewLocalStore(dataDir string) (*LocalStore, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("create artifact data dir: %w", err)
	}
	return &LocalStore{dataDir: dataDir}, nil
}

func (s *LocalStore) path(id string) string {
	return filepath.Join(s.dataDir, id)
}

func (s *LocalStore) Get(_ context.Context, id string) (io.ReadCloser, error) {
	f, err := os.Open(s.path(id))
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (s *LocalStore) Put(_ context.Context, id string, r io.Reader) error {
	if err := s.checkDiskSpace(); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(s.dataDir, ".upload-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmp.Name()

	if _, err := io.Copy(tmp, r); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("write artifact: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("sync artifact: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("close artifact: %w", err)
	}

	if err := os.Rename(tmpPath, s.path(id)); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename artifact: %w", err)
	}
	return nil
}

func (s *LocalStore) Delete(_ context.Context, id string) error {
	err := os.Remove(s.path(id))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *LocalStore) Exists(_ context.Context, id string) (bool, error) {
	_, err := os.Stat(s.path(id))
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}
