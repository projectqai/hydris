package axis

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/projectqai/hydris/pkg/onvif"
)

func getDeviceInfo(host, user, pass string) (model, serial string, err error) {
	data, err := onvif.DigestGet(fmt.Sprintf("http://%s/axis-cgi/param.cgi?action=list&group=root.Brand", host), user, pass)
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
	data, err := onvif.DigestGet(fmt.Sprintf("http://%s/axis-cgi/param.cgi?action=list&group=root.PTZ.Limit", host), user, pass)
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
	data, err := onvif.DigestGet(fmt.Sprintf("http://%s/axis-cgi/com/ptz.cgi?query=position", host), user, pass)
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

func absoluteMove(host, user, pass string, pan, tilt, zoom float64) error {
	u := fmt.Sprintf("http://%s/axis-cgi/com/ptz.cgi?pan=%.2f&tilt=%.2f&zoom=%.0f",
		host, pan, tilt, zoom)
	_, err := onvif.DigestGet(u, user, pass)
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
	data, err := onvif.DigestPost(
		fmt.Sprintf("http://%s/axis-cgi/apidiscovery.cgi", host),
		user, pass, "application/json",
		[]byte(`{"apiVersion":"1.0","method":"getApiList"}`),
	)
	if err != nil {
		return false
	}
	return strings.Contains(string(data), `"`+apiID+`"`)
}

func startWiper(host, user, pass string) error {
	_, err := onvif.DigestPost(
		fmt.Sprintf("http://%s/axis-cgi/clearviewcontrol.cgi", host),
		user, pass, "application/json",
		[]byte(`{"apiVersion":"1.0","method":"start","params":{"id":0}}`),
	)
	return err
}

func streamURLs(host, user, pass string) (rtsp, mjpeg, snapshot string) {
	creds := url.PathEscape(user) + ":" + url.PathEscape(pass)
	rtsp = fmt.Sprintf("rtsp://%s@%s/axis-media/media.amp", creds, host)
	mjpeg = fmt.Sprintf("http://%s@%s/axis-cgi/mjpg/video.cgi", creds, host)
	snapshot = fmt.Sprintf("http://%s@%s/axis-cgi/jpg/image.cgi", creds, host)
	return rtsp, mjpeg, snapshot
}
