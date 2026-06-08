package media

import (
	"fmt"
	"net/http"
	"strconv"

	pb "github.com/projectqai/proto/go"
)

// ResolveStreamIndex returns the camera stream index to use.
// If ?stream=N is set, it validates and returns N.
// Otherwise it finds the first stream where prefer() returns true,
// falling back to stream 0.
func ResolveStreamIndex(r *http.Request, streams []*pb.MediaStream, prefer func(pb.MediaStreamProtocol) bool) (int, error) {
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

// IsVideoStream returns true for streams that can be bridged to WebRTC.
func IsVideoStream(p pb.MediaStreamProtocol) bool {
	return p == pb.MediaStreamProtocol_MediaStreamProtocolWebrtc ||
		p == pb.MediaStreamProtocol_MediaStreamProtocolRtsp
}

func IsProxyableStream(p pb.MediaStreamProtocol) bool {
	return p == pb.MediaStreamProtocol_MediaStreamProtocolImage ||
		p == pb.MediaStreamProtocol_MediaStreamProtocolMjpeg
}
