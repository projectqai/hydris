package simcam

import (
	"context"
	"image"
	"image/png"
	"io"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin/artifacts"
)

type spriteCache struct {
	mu      sync.Mutex
	images  map[string]*image.RGBA
	pending map[string]bool
	failed  map[string]time.Time
}

var globalSprites = &spriteCache{
	images:  make(map[string]*image.RGBA),
	pending: make(map[string]bool),
	failed:  make(map[string]time.Time),
}

func (sc *spriteCache) get(artifactID string) *image.RGBA {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.images[artifactID]
}

func (sc *spriteCache) fetchAsync(artifactID string) {
	sc.mu.Lock()
	if sc.images[artifactID] != nil || sc.pending[artifactID] {
		sc.mu.Unlock()
		return
	}
	if t, ok := sc.failed[artifactID]; ok && time.Since(t) < 30*time.Second {
		sc.mu.Unlock()
		return
	}
	sc.pending[artifactID] = true
	sc.mu.Unlock()

	go func() {
		img := fetchArtifactImage(artifactID)

		sc.mu.Lock()
		delete(sc.pending, artifactID)
		if img != nil {
			sc.images[artifactID] = img
			delete(sc.failed, artifactID)
		} else {
			sc.failed[artifactID] = time.Now()
		}
		sc.mu.Unlock()
	}()
}

func fetchArtifactImage(artifactID string) *image.RGBA {
	srv := artifacts.Server
	if srv == nil {
		return nil
	}
	rc, err := srv.Local().Get(context.Background(), artifactID)
	if err != nil {
		return nil
	}
	defer rc.Close()

	decoded, err := png.Decode(io.LimitReader(rc, 10<<20))
	if err != nil {
		return nil
	}
	return toRGBA(decoded)
}
