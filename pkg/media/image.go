package media

import (
	"io"
	"net/http"
	"net/url"
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
		client: &http.Client{
			Transport: &http.Transport{
				ResponseHeaderTimeout: 10 * time.Second,
			},
		},
	}
}

func (h *ImageProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	entityID := r.PathValue("entityId")
	entity := h.lookup.GetHead(entityID)
	if entity == nil {
		entityID = parseEntityID(r)
		entity = h.lookup.GetHead(entityID)
	}
	if entity == nil || entity.Camera == nil {
		http.Error(w, "entity not found or has no camera", http.StatusNotFound)
		return
	}

	cameraIndex, err := resolveStreamIndex(r, entity.Camera.Streams, isProxyableStream)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if cameraIndex < 0 {
		http.Error(w, "no image stream found", http.StatusNotFound)
		return
	}

	// Use the original source URL (before the media transform rewrote it).
	imageURL := h.lookup.GetSourceURL(entityID, cameraIndex)
	if imageURL == "" {
		imageURL = entity.Camera.Streams[cameraIndex].Url
	}
	if imageURL == "" {
		http.Error(w, "stream has no URL", http.StatusNotFound)
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

	_, _ = io.Copy(w, resp.Body)
}

func isProxyableStream(p pb.MediaStreamProtocol) bool {
	return p == pb.MediaStreamProtocol_MediaStreamProtocolImage ||
		p == pb.MediaStreamProtocol_MediaStreamProtocolMjpeg
}
