package whep

import (
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	pb "github.com/projectqai/proto/go"
)

// ImageProxyHandler serves camera images by proxying the entity's image stream URL.
type ImageProxyHandler struct {
	lookup EntityLookup
	client *http.Client
}

func NewImageProxyHandler(lookup EntityLookup) *ImageProxyHandler {
	return &ImageProxyHandler{
		lookup: lookup,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (h *ImageProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	entityID := r.PathValue("entityId")
	cameraIndexStr := r.PathValue("cameraIndex")
	cameraIndex, err := strconv.Atoi(cameraIndexStr)
	if err != nil {
		http.Error(w, "invalid camera index", http.StatusBadRequest)
		return
	}

	entity := h.lookup.GetHead(entityID)
	if entity == nil || entity.Camera == nil {
		http.Error(w, "entity not found or has no camera", http.StatusNotFound)
		return
	}

	// If a specific index is given, use that stream directly (it must be an image stream).
	// Otherwise with index -1, find the first image stream.
	var imageURL string
	if cameraIndex >= 0 {
		if cameraIndex >= len(entity.Camera.Streams) {
			http.Error(w, "camera index out of range", http.StatusNotFound)
			return
		}
		s := entity.Camera.Streams[cameraIndex]
		if !isProxyableStream(s.Protocol) {
			http.Error(w, "stream is not an image or mjpeg stream", http.StatusBadRequest)
			return
		}
		imageURL = s.Url
	} else {
		// Find first proxyable stream (image or mjpeg)
		for _, s := range entity.Camera.Streams {
			if isProxyableStream(s.Protocol) {
				imageURL = s.Url
				break
			}
		}
	}

	if imageURL == "" {
		http.Error(w, "no image stream found", http.StatusNotFound)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, imageURL, nil)
	if err != nil {
		http.Error(w, "invalid image URL", http.StatusBadRequest)
		return
	}
	// Go's http client doesn't send credentials from userinfo in the URL,
	// so extract them and set Basic Auth explicitly.
	if u, err := url.Parse(imageURL); err == nil && u.User != nil {
		pass, _ := u.User.Password()
		req.SetBasicAuth(u.User.Username(), pass)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		http.Error(w, "failed to fetch image", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, "upstream returned "+resp.Status, http.StatusBadGateway)
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	} else {
		w.Header().Set("Content-Type", "image/jpeg")
	}
	w.Header().Set("Cache-Control", "no-cache")

	io.Copy(w, resp.Body)
}

func isProxyableStream(p pb.MediaStreamProtocol) bool {
	return p == pb.MediaStreamProtocol_MediaStreamProtocolImage ||
		p == pb.MediaStreamProtocol_MediaStreamProtocolMjpeg
}
