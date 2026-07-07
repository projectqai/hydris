package mediaserver

import (
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/projectqai/hydris/pkg/media"
	"github.com/projectqai/hydris/pkg/onvif"
)

type ImageProxyHandler struct {
	client *http.Client
}

func NewImageProxyHandler() *ImageProxyHandler {
	return &ImageProxyHandler{
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

	imageURL := entity.Camera.Streams[cameraIndex].Url
	if imageURL == "" {
		http.Error(w, "stream has no URL", http.StatusNotFound)
		return
	}

	if parsed, err := url.Parse(imageURL); err == nil && !parsed.IsAbs() {
		base := &url.URL{Scheme: "http", Host: r.Host, Path: parsed.Path, RawQuery: parsed.RawQuery}
		imageURL = base.String()
	}

	var user, pass string
	if u, err := url.Parse(imageURL); err == nil && u.User != nil {
		user = u.User.Username()
		pass, _ = u.User.Password()
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, imageURL, nil)
	if err != nil {
		http.Error(w, "invalid image URL", http.StatusBadRequest)
		return
	}
	if user != "" {
		req.SetBasicAuth(user, pass)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		slog.Debug("image proxy: fetch failed", "url", imageURL, "entity", entityID, "error", err)
		http.Error(w, "failed to fetch image", http.StatusBadGateway)
		return
	}

	if resp.StatusCode == http.StatusUnauthorized && user != "" {
		wwwAuth := resp.Header.Get("WWW-Authenticate")
		resp.Body.Close()
		if strings.HasPrefix(strings.ToLower(wwwAuth), "digest") {
			req, err = http.NewRequestWithContext(r.Context(), http.MethodGet, imageURL, nil)
			if err != nil {
				http.Error(w, "invalid image URL", http.StatusBadRequest)
				return
			}
			req.Header.Set("Authorization", onvif.DigestAuthHeader("GET", imageURL, user, pass, wwwAuth))
			resp, err = h.client.Do(req)
			if err != nil {
				slog.Debug("image proxy: digest retry failed", "url", imageURL, "entity", entityID, "error", err)
				http.Error(w, "failed to fetch image", http.StatusBadGateway)
				return
			}
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("image proxy: upstream error", "status", resp.Status, "url", imageURL, "entity", entityID)
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
