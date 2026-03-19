package media

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	pb "github.com/projectqai/proto/go"
)

// resolveStreamIndex returns the camera stream index to use.
// If ?stream=N is set, it validates and returns N.
// Otherwise it finds the first stream where prefer() returns true,
// falling back to stream 0.
func resolveStreamIndex(r *http.Request, streams []*pb.MediaStream, prefer func(pb.MediaStreamProtocol) bool) (int, error) {
	if len(streams) == 0 {
		return -1, nil
	}

	if s := r.URL.Query().Get("stream"); s != "" {
		idx, err := strconv.Atoi(s)
		if err != nil {
			return 0, fmt.Errorf("invalid stream index: %s", s)
		}
		if idx < 0 || idx >= len(streams) {
			return 0, fmt.Errorf("stream index out of range: %d", idx)
		}
		return idx, nil
	}

	if prefer != nil {
		for i, st := range streams {
			if prefer(st.Protocol) {
				return i, nil
			}
		}
	}

	return 0, nil
}

// isVideoStream returns true for streams that can be bridged to WebRTC.
func isVideoStream(p pb.MediaStreamProtocol) bool {
	return p == pb.MediaStreamProtocol_MediaStreamProtocolWebrtc ||
		p == pb.MediaStreamProtocol_MediaStreamProtocolRtsp
}

// parseEntityID handles both new (?stream=N) and legacy (/N suffix) URL formats.
// If the entity ID ends with /N where N is numeric, it strips the suffix and
// returns N as the stream index via the query parameter for resolveStreamIndex.
func parseEntityID(r *http.Request) string {
	entityID := r.PathValue("entityId")
	if i := strings.LastIndex(entityID, "/"); i >= 0 {
		suffix := entityID[i+1:]
		if _, err := strconv.Atoi(suffix); err == nil {
			// Legacy format: /media/whep/{entityId}/{streamIndex}
			// Inject as query param so resolveStreamIndex picks it up.
			if r.URL.Query().Get("stream") == "" {
				q := r.URL.Query()
				q.Set("stream", suffix)
				r.URL.RawQuery = q.Encode()
			}
			entityID = entityID[:i]
		}
	}
	return entityID
}
