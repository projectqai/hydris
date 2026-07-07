package axis

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/projectqai/hydris/pkg/onvif"
	pb "github.com/projectqai/proto/go"
)

var axisDebug = os.Getenv("HYDRIS_DEBUG_AXIS") != ""

func vapixGet(url, user, pass string) ([]byte, error) {
	if axisDebug {
		slog.Info("AXIS GET", "url", url)
	}
	data, err := onvif.DigestGet(url, user, pass)
	if axisDebug {
		if err != nil {
			slog.Info("AXIS GET error", "url", url, "error", err)
		} else {
			slog.Info("AXIS GET response", "url", url, "body", string(data))
		}
	}
	return data, err
}

func vapixPost(url, user, pass, contentType string, body []byte) ([]byte, error) {
	if axisDebug {
		slog.Info("AXIS POST", "url", url, "body", string(body))
	}
	data, err := onvif.DigestPost(url, user, pass, contentType, body)
	if axisDebug {
		if err != nil {
			slog.Info("AXIS POST error", "url", url, "error", err)
		} else {
			slog.Info("AXIS POST response", "url", url, "body", string(data))
		}
	}
	return data, err
}

func getDeviceInfo(host, user, pass string) (model, serial string, err error) {
	data, err := vapixGet(fmt.Sprintf("http://%s/axis-cgi/param.cgi?action=list&group=root.Brand", host), user, pass)
	if err != nil {
		return "", "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) != 2 {
			continue
		}
		switch {
		case strings.HasSuffix(parts[0], ".ProdNbr"):
			model = parts[1]
		case strings.HasSuffix(parts[0], ".ProdSerNbr"):
			serial = parts[1]
		}
	}
	if model == "" && serial == "" {
		return "", "", fmt.Errorf("no Brand parameters in response")
	}
	return model, serial, nil
}

func getFieldAngle(host, user, pass string) (wide, tele float64) {
	data, err := vapixGet(fmt.Sprintf("http://%s/axis-cgi/param.cgi?action=list&group=root.PTZ.Limit", host), user, pass)
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) != 2 {
			continue
		}
		var f float64
		if _, err := fmt.Sscanf(parts[1], "%f", &f); err != nil || f <= 0 {
			continue
		}
		switch {
		case strings.HasSuffix(parts[0], "MaxFieldAngle"):
			wide = f / 10
		case strings.HasSuffix(parts[0], "MinFieldAngle"):
			tele = f / 10
		}
	}
	return wide, tele
}

type ptzPosition struct {
	Pan  float64
	Tilt float64
	Zoom float64
}

func getPTZPosition(host, user, pass string) (ptzPosition, error) {
	data, err := vapixGet(fmt.Sprintf("http://%s/axis-cgi/com/ptz.cgi?query=position", host), user, pass)
	if err != nil {
		return ptzPosition{}, err
	}
	var pos ptzPosition
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) != 2 {
			continue
		}
		var f float64
		if _, err := fmt.Sscanf(parts[1], "%f", &f); err != nil {
			continue
		}
		switch strings.ToLower(parts[0]) {
		case "pan":
			pos.Pan = f
		case "tilt":
			pos.Tilt = f
		case "zoom":
			pos.Zoom = f
		}
	}
	return pos, nil
}

func continuousPanTiltMove(host, user, pass string, panSpeed, tiltSpeed int) error {
	u := fmt.Sprintf("http://%s/axis-cgi/com/ptz.cgi?continuouspantiltmove=%d,%d",
		host, panSpeed, tiltSpeed)
	_, err := vapixGet(u, user, pass)
	return err
}

func continuousZoomMove(host, user, pass string, speed int) error {
	u := fmt.Sprintf("http://%s/axis-cgi/com/ptz.cgi?continuouszoommove=%d", host, speed)
	_, err := vapixGet(u, user, pass)
	return err
}

func absoluteMove(host, user, pass string, pan, tilt, zoom float64) error {
	u := fmt.Sprintf("http://%s/axis-cgi/com/ptz.cgi?pan=%.2f&tilt=%.2f&zoom=%.0f",
		host, pan, tilt, zoom)
	_, err := vapixGet(u, user, pass)
	return err
}

func vapixZoomToRange(zoom, rangeMax float64) float64 {
	if rangeMax <= 0 {
		rangeMax = 30
	}
	norm := zoom / 9999
	if norm < 0 {
		norm = 0
	}
	if norm > 1 {
		norm = 1
	}
	return norm * rangeMax
}

func hasAPI(host, user, pass, apiID string) bool {
	data, err := vapixPost(
		fmt.Sprintf("http://%s/axis-cgi/apidiscovery.cgi", host),
		user, pass, "application/json",
		[]byte(`{"apiVersion":"1.0","method":"getApiList"}`),
	)
	if err != nil {
		return false
	}
	return strings.Contains(string(data), `"`+apiID+`"`)
}

type imageCapabilities struct {
	Resolutions []string
	Codecs      []string
	MaxFPS      int
}

func getImageCapabilities(host, user, pass string) imageCapabilities {
	var caps imageCapabilities
	seenRes := make(map[string]bool)
	seenCodec := make(map[string]bool)

	data, err := vapixGet(fmt.Sprintf("http://%s/axis-cgi/param.cgi?action=list&group=root.Properties.Image", host), user, pass)
	if err != nil {
		return caps
	}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) != 2 {
			continue
		}
		val := strings.TrimSpace(parts[1])
		switch {
		case strings.HasSuffix(parts[0], ".Resolution"):
			for _, r := range strings.Split(val, ",") {
				r = strings.TrimSpace(r)
				if r != "" && !seenRes[r] {
					seenRes[r] = true
					caps.Resolutions = append(caps.Resolutions, r)
				}
			}
		case strings.HasSuffix(parts[0], ".Format"):
			for _, f := range strings.Split(val, ",") {
				f = strings.TrimSpace(strings.ToLower(f))
				if (f == "h264" || f == "mjpeg") && !seenCodec[f] {
					seenCodec[f] = true
					caps.Codecs = append(caps.Codecs, f)
				}
			}
		}
	}

	return caps
}

func startWiper(host, user, pass string) error {
	_, err := vapixPost(
		fmt.Sprintf("http://%s/axis-cgi/clearviewcontrol.cgi", host),
		user, pass, "application/json",
		[]byte(`{"apiVersion":"1.0","method":"start","params":{"id":0}}`),
	)
	return err
}

type streamProfile struct {
	Name        string
	Description string
	Parameters  map[string]string
}

func getStreamProfiles(host, user, pass string) ([]streamProfile, error) {
	data, err := vapixPost(
		fmt.Sprintf("http://%s/axis-cgi/streamprofile.cgi", host),
		user, pass, "application/json",
		[]byte(`{"apiVersion":"1.0","method":"list","params":{}}`),
	)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data struct {
			StreamProfile []struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Parameters  string `json:"parameters"`
			} `json:"streamProfile"`
		} `json:"data"`
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("parse stream profiles: %w", err)
	}
	if resp.Error != nil {
		return getStreamProfilesLegacy(host, user, pass)
	}

	var profiles []streamProfile
	for _, sp := range resp.Data.StreamProfile {
		profiles = append(profiles, streamProfile{
			Name:        sp.Name,
			Description: sp.Description,
			Parameters:  parseProfileParameters(sp.Parameters),
		})
	}
	return profiles, nil
}

func getStreamProfilesLegacy(host, user, pass string) ([]streamProfile, error) {
	data, err := vapixGet(fmt.Sprintf("http://%s/axis-cgi/param.cgi?action=list&group=root.StreamProfile", host), user, pass)
	if err != nil {
		return nil, err
	}

	type rawProfile struct {
		name, description, parameters string
	}
	byIndex := make(map[string]*rawProfile)
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := parts[0]
		val := parts[1]

		idx := ""
		if rest, ok := strings.CutPrefix(key, "root.StreamProfile.S"); ok {
			if dot := strings.IndexByte(rest, '.'); dot > 0 {
				idx = rest[:dot]
			}
		}
		if idx == "" {
			continue
		}

		rp, ok := byIndex[idx]
		if !ok {
			rp = &rawProfile{}
			byIndex[idx] = rp
		}
		switch {
		case strings.HasSuffix(key, ".Name"):
			rp.name = val
		case strings.HasSuffix(key, ".Description"):
			rp.description = val
		case strings.HasSuffix(key, ".Parameters"):
			rp.parameters = val
		}
	}

	if len(byIndex) == 0 {
		return nil, fmt.Errorf("no stream profiles in param.cgi")
	}

	type indexed struct {
		idx string
		rp  *rawProfile
	}
	var sorted []indexed
	for idx, rp := range byIndex {
		if rp.name != "" {
			sorted = append(sorted, indexed{idx, rp})
		}
	}
	for i := range sorted {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].idx < sorted[i].idx {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	var profiles []streamProfile
	for _, s := range sorted {
		profiles = append(profiles, streamProfile{
			Name:        s.rp.name,
			Description: s.rp.description,
			Parameters:  parseProfileParameters(s.rp.parameters),
		})
	}
	return profiles, nil
}

func parseProfileParameters(raw string) map[string]string {
	params := make(map[string]string)
	for _, kv := range strings.Split(raw, "&") {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) == 2 {
			k, _ := url.QueryUnescape(parts[0])
			v, _ := url.QueryUnescape(parts[1])
			params[k] = v
		}
	}
	return params
}

func rtspHost(host string) string {
	h, _, err := net.SplitHostPort(host)
	if err != nil {
		return host
	}
	return net.JoinHostPort(h, "554")
}

func streamQuery(cfg cameraConfig) string {
	params := url.Values{}
	if cfg.Resolution != "" {
		params.Set("resolution", cfg.Resolution)
	}
	if cfg.Codec != "" {
		params.Set("videocodec", strings.ToLower(cfg.Codec))
	}
	if cfg.FPS > 0 {
		params.Set("fps", fmt.Sprintf("%d", cfg.FPS))
	}
	if cfg.Compression > 0 {
		params.Set("compression", fmt.Sprintf("%d", cfg.Compression))
	}
	if cfg.Bitrate > 0 {
		params.Set("videobitrate", fmt.Sprintf("%d", cfg.Bitrate))
	}
	if cfg.KeyframeInterval > 0 {
		params.Set("videokeyframeinterval", fmt.Sprintf("%d", cfg.KeyframeInterval))
	}
	if cfg.BitrateMode != "" {
		params.Set("videobitratemode", cfg.BitrateMode)
	}
	if cfg.H264Profile != "" {
		params.Set("h264profile", cfg.H264Profile)
	}
	if cfg.ZipstreamStrength > 0 {
		params.Set("videozstrength", fmt.Sprintf("%d", cfg.ZipstreamStrength))
	}
	if cfg.Audio {
		params.Set("audio", "1")
	}
	if cfg.Rotation > 0 {
		params.Set("rotation", fmt.Sprintf("%d", cfg.Rotation))
	}
	return params.Encode()
}

func parseResolution(res string, s *pb.MediaStream) {
	if parts := strings.SplitN(res, "x", 2); len(parts) == 2 {
		var width, height int32
		if _, err := fmt.Sscanf(parts[0], "%d", &width); err == nil {
			if _, err := fmt.Sscanf(parts[1], "%d", &height); err == nil && width > 0 && height > 0 {
				s.Width = &width
				s.Height = &height
			}
		}
	}
}

func discoverStreams(host string, cfg cameraConfig) []*pb.MediaStream {
	profiles, err := getStreamProfiles(host, cfg.Username, cfg.Password)
	if err != nil || len(profiles) == 0 {
		return fallbackStreams(host, cfg)
	}

	userinfo := url.UserPassword(cfg.Username, cfg.Password).String()
	q := streamQuery(cfg)
	var streams []*pb.MediaStream

	for i, p := range profiles {
		codec := strings.ToUpper(p.Parameters["videocodec"])
		if cfg.Codec != "" {
			codec = strings.ToUpper(cfg.Codec)
		}
		if codec == "" {
			codec = "H264"
		}

		role := pb.MediaStreamRole_MediaStreamRoleSub
		if i == 0 {
			role = pb.MediaStreamRole_MediaStreamRoleMain
		}

		label := p.Description
		if label == "" {
			label = p.Name
		}

		var s *pb.MediaStream
		switch strings.ToLower(codec) {
		case "mjpeg":
			mjpegURL := fmt.Sprintf("http://%s@%s/axis-cgi/mjpg/video.cgi?streamprofile=%s",
				userinfo, host, url.QueryEscape(p.Name))
			if q != "" {
				mjpegURL += "&" + q
			}
			s = &pb.MediaStream{
				Label:    label,
				Url:      mjpegURL,
				Protocol: pb.MediaStreamProtocol_MediaStreamProtocolMjpeg,
				Codec:    codec,
				Role:     role,
			}
		default:
			profileURL := fmt.Sprintf("rtsp://%s@%s/axis-media/media.amp?streamprofile=%s",
				userinfo, rtspHost(host), url.QueryEscape(p.Name))
			if q != "" {
				profileURL += "&" + q
			}
			s = &pb.MediaStream{
				Label:    label,
				Url:      profileURL,
				Protocol: pb.MediaStreamProtocol_MediaStreamProtocolRtsp,
				Codec:    codec,
				Role:     role,
			}
		}

		res := cfg.Resolution
		if res == "" {
			res = p.Parameters["resolution"]
		}
		parseResolution(res, s)
		streams = append(streams, s)
	}

	streams = append(streams, snapshotStream(userinfo, host, q))
	return streams
}

func fallbackStreams(host string, cfg cameraConfig) []*pb.MediaStream {
	userinfo := url.UserPassword(cfg.Username, cfg.Password).String()
	q := streamQuery(cfg)

	codec := strings.ToUpper(cfg.Codec)

	switch strings.ToLower(cfg.Codec) {
	case "mjpeg":
		mainURL := fmt.Sprintf("http://%s@%s/axis-cgi/mjpg/video.cgi", userinfo, host)
		if q != "" {
			mainURL += "?" + q
		}
		s := &pb.MediaStream{
			Label:    "Main Stream",
			Url:      mainURL,
			Protocol: pb.MediaStreamProtocol_MediaStreamProtocolMjpeg,
			Codec:    codec,
			Role:     pb.MediaStreamRole_MediaStreamRoleMain,
		}
		parseResolution(cfg.Resolution, s)
		return append([]*pb.MediaStream{s}, snapshotStream(userinfo, host, q))

	case "jpeg":
		s := snapshotStream(userinfo, host, q)
		s.Label = "Main Stream"
		s.Role = pb.MediaStreamRole_MediaStreamRoleMain
		return []*pb.MediaStream{s}

	default:
		if codec == "" {
			codec = "H264"
		}
		rtspURL := fmt.Sprintf("rtsp://%s@%s/axis-media/media.amp", userinfo, rtspHost(host))
		if q != "" {
			rtspURL += "?" + q
		}
		s := &pb.MediaStream{
			Label:    "Main Stream",
			Url:      rtspURL,
			Protocol: pb.MediaStreamProtocol_MediaStreamProtocolRtsp,
			Codec:    codec,
			Role:     pb.MediaStreamRole_MediaStreamRoleMain,
		}
		parseResolution(cfg.Resolution, s)
		return append([]*pb.MediaStream{s}, snapshotStream(userinfo, host, q))
	}
}

func snapshotStream(userinfo, host, q string) *pb.MediaStream {
	snapURL := fmt.Sprintf("http://%s@%s/axis-cgi/jpg/image.cgi", userinfo, host)
	if q != "" {
		snapURL += "?" + q
	}
	return &pb.MediaStream{
		Label:    "Snapshot",
		Url:      snapURL,
		Protocol: pb.MediaStreamProtocol_MediaStreamProtocolImage,
		Role:     pb.MediaStreamRole_MediaStreamRoleSnapshot,
	}
}
