package mediaserver

import (
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/projectqai/hydris/pkg/media"
)

type ImageProxyHandler struct {
	getSourceURL media.GetSourceURLFunc
	client       *http.Client
}

func NewImageProxyHandler(getSourceURL media.GetSourceURLFunc) *ImageProxyHandler {
	return &ImageProxyHandler{
		getSourceURL: getSourceURL,
		client: &http.Client{
			Transport: &http.Transport{
				ResponseHeaderTimeout: 10 * time.Second,
			},
		},
	}
}

func (h *ImageProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	entityID := r.PathValue("entityId")
	entity := getEntity(r.Context(), entityID)
	if entity == nil || entity.Camera == nil {
		http.Error(w, "entity not found or has no camera", http.StatusNotFound)
		return
	}

	cameraIndex, err := media.ResolveStreamIndex(r, entity.Camera.Streams, media.IsProxyableStream)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if cameraIndex < 0 {
		http.Error(w, "no image stream found", http.StatusNotFound)
		return
	}

	imageURL := h.getSourceURL(entityID, cameraIndex)
	if imageURL == "" {
		imageURL = entity.Camera.Streams[cameraIndex].Url
	}
	if imageURL == "" {
		http.Error(w, "stream has no URL", http.StatusNotFound)
		return
	}

	if parsed, err := url.Parse(imageURL); err == nil && !parsed.IsAbs() {
		base := &url.URL{Scheme: "http", Host: r.Host, Path: parsed.Path, RawQuery: parsed.RawQuery}
		imageURL = base.String()
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, imageURL, nil)
	if err != nil {
		http.Error(w, "invalid image URL", http.StatusBadRequest)
		return
	}
	if u, err := url.Parse(imageURL); err == nil && u.User != nil {
		pass, _ := u.User.Password()
		req.SetBasicAuth(u.User.Username(), pass)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		slog.Debug("image proxy: fetch failed", "url", imageURL, "entity", entityID, "error", err)
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
