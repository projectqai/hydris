package transform

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"

	pb "github.com/projectqai/proto/go"
)

// MediaTransformer rewrites CameraComponent stream URLs to point through
// the engine's media proxy endpoints. Raw source URLs pushed by builtins
// are stored internally and replaced with proxy URLs in the entity.
//
// This ensures consumers (frontend, federation) only see proxy URLs,
// while the proxy handlers can look up the original source URL.
type MediaTransformer struct {
	mu sync.RWMutex
	// sourceURLs maps "entityID/streamIndex" → original source URL.
	sourceURLs map[string]string
}

func NewMediaTransformer() *MediaTransformer {
	return &MediaTransformer{
		sourceURLs: make(map[string]string),
	}
}

func (mt *MediaTransformer) Validate(_ map[string]*pb.Entity, _ *pb.Entity) error {
	return nil
}

func (mt *MediaTransformer) Resolve(head map[string]*pb.Entity, changedID string) (upsert []*pb.Entity, remove []string) {
	entity := head[changedID]
	if entity == nil || entity.Camera == nil || len(entity.Camera.Streams) == 0 {
		return nil, nil
	}

	port := enginePort()
	httpOrigin := "http://localhost:" + port
	rtspOrigin := "rtsp://localhost:" + port

	mt.mu.Lock()
	defer mt.mu.Unlock()

	for idx, stream := range entity.Camera.Streams {
		key := fmt.Sprintf("%s/%d", changedID, idx)

		// If URL already points to our proxy, skip.
		if isProxyURL(stream.Url, httpOrigin) || isProxyURL(stream.Url, rtspOrigin) {
			continue
		}

		// Store the raw source URL.
		mt.sourceURLs[key] = stream.Url

		// Rewrite to proxy URL based on protocol.
		switch stream.Protocol {
		case pb.MediaStreamProtocol_MediaStreamProtocolWebrtc:
			stream.Url = fmt.Sprintf("%s/media/whep/%s?stream=%d", httpOrigin, changedID, idx)
		case pb.MediaStreamProtocol_MediaStreamProtocolRtsp:
			stream.Url = fmt.Sprintf("%s/media/rtsp/%s?stream=%d", rtspOrigin, changedID, idx)
		case pb.MediaStreamProtocol_MediaStreamProtocolImage,
			pb.MediaStreamProtocol_MediaStreamProtocolMjpeg:
			stream.Url = fmt.Sprintf("%s/media/image/%s?stream=%d", httpOrigin, changedID, idx)
		case pb.MediaStreamProtocol_MediaStreamProtocolHls,
			pb.MediaStreamProtocol_MediaStreamProtocolIframe:
			// HLS and iframe streams use the original URL directly —
			// proxying would break relative segment/resource URLs.
			continue
		default:
			stream.Url = fmt.Sprintf("%s/media/image/%s?stream=%d", httpOrigin, changedID, idx)
		}
	}

	return nil, nil
}

// GetSourceURL returns the original source URL for an entity's stream.
// This is used by proxy handlers to connect to the actual camera.
func (mt *MediaTransformer) GetSourceURL(entityID string, streamIndex int) string {
	mt.mu.RLock()
	defer mt.mu.RUnlock()
	return mt.sourceURLs[fmt.Sprintf("%s/%d", entityID, streamIndex)]
}

// isProxyURL returns true if the URL's path matches a media proxy endpoint.
// Checks the path only (not origin) so that federated URLs from other nodes
// are also recognized and not double-rewritten.
func isProxyURL(u, _ string) bool {
	parsed, err := url.Parse(u)
	if err != nil {
		return false
	}
	return strings.HasPrefix(parsed.Path, "/media/image/") ||
		strings.HasPrefix(parsed.Path, "/media/whep/") ||
		strings.HasPrefix(parsed.Path, "/media/rtsp/") ||
		strings.HasPrefix(parsed.Path, "/media/webcam/")
}

func enginePort() string {
	port := os.Getenv("PORT")
	if port == "" {
		port = "50051"
	}
	return port
}
