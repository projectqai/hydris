package onvif

import (
	"crypto/md5"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

type ServiceEndpoints struct {
	Device  string
	Media   string
	PTZ     string
	Imaging string
}

type DeviceInfo struct {
	Manufacturer string
	Model        string
	SerialNumber string
}

type MediaProfile struct {
	Token    string
	Name     string
	Encoding string // e.g. "JPEG", "H264", "H265"
}

func DiscoverEndpoints(host, user, pass string) (ServiceEndpoints, error) {
	deviceURL := fmt.Sprintf("http://%s/onvif/device_service", host)
	ep := ServiceEndpoints{Device: deviceURL}

	data, err := soapRequest(deviceURL, `<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>`, user, pass)
	if err != nil {
		return ep, fmt.Errorf("GetCapabilities: %w", err)
	}

	body := string(data)

	if addr := extractXAddrFromSection(body, "Media"); addr != "" {
		ep.Media = addr
	}
	if addr := extractXAddrFromSection(body, "PTZ"); addr != "" {
		ep.PTZ = addr
	}
	if addr := extractXAddrFromSection(body, "Imaging"); addr != "" {
		ep.Imaging = addr
	}

	if ep.Media == "" {
		ep.Media = fmt.Sprintf("http://%s/onvif/media_service", host)
	}

	return ep, nil
}

func GetDeviceInformation(ep ServiceEndpoints, user, pass string) (DeviceInfo, error) {
	data, err := soapRequest(ep.Device, `<tds:GetDeviceInformation/>`, user, pass)
	if err != nil {
		return DeviceInfo{}, fmt.Errorf("request: %w", err)
	}

	body := string(data)
	return DeviceInfo{
		Manufacturer: extractTagValue(body, "Manufacturer"),
		Model:        extractTagValue(body, "Model"),
		SerialNumber: extractTagValue(body, "SerialNumber"),
	}, nil
}

func GetProfiles(ep ServiceEndpoints, user, pass string) ([]MediaProfile, error) {
	data, err := soapRequest(ep.Media, `<trt:GetProfiles/>`, user, pass)
	if err != nil {
		return nil, fmt.Errorf("request: %w", err)
	}

	body := string(data)
	if strings.Contains(body, "<html") || strings.Contains(body, "<HTML") {
		return nil, fmt.Errorf("media service returned HTML (wrong endpoint URL)")
	}

	return parseProfiles(body), nil
}

func GetStreamURI(ep ServiceEndpoints, user, pass, profileToken string) (string, error) {
	body := fmt.Sprintf(`<trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>%s</trt:ProfileToken>
    </trt:GetStreamUri>`, profileToken)

	data, err := soapRequest(ep.Media, body, user, pass)
	if err != nil {
		return "", fmt.Errorf("request: %w", err)
	}

	uri := extractTagValue(string(data), "Uri")
	if uri == "" {
		return "", fmt.Errorf("no Uri in response")
	}
	return uri, nil
}

func GetSnapshotURI(ep ServiceEndpoints, user, pass, profileToken string) (string, error) {
	body := fmt.Sprintf(`<trt:GetSnapshotUri>
      <trt:ProfileToken>%s</trt:ProfileToken>
    </trt:GetSnapshotUri>`, profileToken)

	data, err := soapRequest(ep.Media, body, user, pass)
	if err != nil {
		return "", fmt.Errorf("request: %w", err)
	}

	return extractTagValue(string(data), "Uri"), nil
}

func GetPTZStatus(ep ServiceEndpoints, user, pass, profileToken string) (pan, tilt, zoom float64, err error) {
	if ep.PTZ == "" {
		return 0, 0, 0, fmt.Errorf("no PTZ service")
	}
	body := fmt.Sprintf(`<tptz:GetStatus>
      <tptz:ProfileToken>%s</tptz:ProfileToken>
    </tptz:GetStatus>`, profileToken)

	data, err := soapRequest(ep.PTZ, body, user, pass)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("request: %w", err)
	}

	resp := string(data)

	panTiltTag := findTag(resp, "PanTilt")
	if panTiltTag != "" {
		pan = parseFloat(extractAttr(panTiltTag, "x"))
		tilt = parseFloat(extractAttr(panTiltTag, "y"))
	}

	zoomTag := findTag(resp, "Zoom")
	if zoomTag != "" {
		zoom = parseFloat(extractAttr(zoomTag, "x"))
	}

	return pan, tilt, zoom, nil
}

func AbsoluteMove(ep ServiceEndpoints, user, pass, profileToken string, pan, tilt, zoom float64) error {
	if ep.PTZ == "" {
		return fmt.Errorf("no PTZ service")
	}
	body := fmt.Sprintf(`<tptz:AbsoluteMove>
      <tptz:ProfileToken>%s</tptz:ProfileToken>
      <tptz:Position>
        <tt:PanTilt x="%.6f" y="%.6f"/>
        <tt:Zoom x="%.6f"/>
      </tptz:Position>
    </tptz:AbsoluteMove>`, profileToken, pan, tilt, zoom)

	_, err := soapRequest(ep.PTZ, body, user, pass)
	return err
}

// Imaging service: focal length / FOV

const SensorWidth1_2_8 = 5.04 // mm, 1/2.8" sensor (most common in security cameras)

type LensInfo struct {
	FocalLengthMin float64 // mm, widest
	FocalLengthMax float64 // mm, most zoomed
}

func FOVFromFocalLength(focalLengthMM, sensorWidthMM float64) float64 {
	if focalLengthMM <= 0 || sensorWidthMM <= 0 {
		return 0
	}
	return 2 * math.Atan(sensorWidthMM/(2*focalLengthMM)) * 180 / math.Pi
}

func GetVideoSourceToken(ep ServiceEndpoints, user, pass string) (string, error) {
	data, err := soapRequest(ep.Media, `<trt:GetVideoSources/>`, user, pass)
	if err != nil {
		return "", fmt.Errorf("request: %w", err)
	}

	tag := findTag(string(data), "VideoSources")
	if tag == "" {
		tag = findTag(string(data), "VideoSource")
	}
	if tag == "" {
		return "", fmt.Errorf("no video sources found")
	}
	token := extractAttr(tag, "token")
	if token == "" {
		return "", fmt.Errorf("no token on video source")
	}
	return token, nil
}

func GetLensInfo(ep ServiceEndpoints, user, pass, videoSourceToken string) (LensInfo, error) {
	if ep.Imaging == "" {
		return LensInfo{}, fmt.Errorf("no imaging service")
	}

	body := fmt.Sprintf(`<timg:GetOptions>
      <timg:VideoSourceToken>%s</timg:VideoSourceToken>
    </timg:GetOptions>`, videoSourceToken)

	data, err := soapRequest(ep.Imaging, body, user, pass)
	if err != nil {
		return LensInfo{}, fmt.Errorf("request: %w", err)
	}

	resp := string(data)
	lower := strings.ToLower(resp)

	flIdx := strings.Index(lower, "focallength")
	if flIdx < 0 {
		return LensInfo{}, fmt.Errorf("no FocalLength in response")
	}

	tagStart := strings.LastIndex(lower[:flIdx], "<")
	if tagStart < 0 {
		return LensInfo{}, fmt.Errorf("malformed FocalLength element")
	}

	closeIdx := -1
	for _, prefix := range []string{"tt:", "timg:", ""} {
		ct := strings.ToLower(fmt.Sprintf("</%sFocalLength>", prefix))
		ci := strings.Index(lower[tagStart:], ct)
		if ci >= 0 {
			closeIdx = tagStart + ci + len(ct)
			break
		}
	}
	if closeIdx < 0 {
		return LensInfo{}, fmt.Errorf("no closing FocalLength tag")
	}

	section := resp[tagStart:closeIdx]
	li := LensInfo{
		FocalLengthMin: parseFloat(extractTagValue(section, "Min")),
		FocalLengthMax: parseFloat(extractTagValue(section, "Max")),
	}
	if li.FocalLengthMin <= 0 && li.FocalLengthMax <= 0 {
		return LensInfo{}, fmt.Errorf("no Min/Max in FocalLength")
	}
	return li, nil
}

func IsVideoCodec(enc string) bool {
	switch enc {
	case "H264", "H265", "MPEG4":
		return true
	}
	return false
}

// Coordinate conversions between ONVIF [-1,1] ranges and degrees.

func PanToAzimuth(pan float64) float64 {
	az := math.Mod((pan+1)*180, 360)
	if az < 0 {
		az += 360
	}
	return az
}

func AzimuthToPan(az float64) float64 {
	pan := math.Mod(az, 360)/180 - 1
	if pan < -1 {
		pan += 2
	}
	if pan > 1 {
		pan = 1
	}
	return pan
}

func TiltToElevation(tilt float64) float64 {
	return tilt * 90
}

func ElevationToTilt(el float64) float64 {
	tilt := el / 90
	if tilt < -1 {
		tilt = -1
	}
	if tilt > 1 {
		tilt = 1
	}
	return tilt
}

// SOAP / WSSE / HTTP Digest internals

func nonce() (raw []byte, b64 string) {
	raw = make([]byte, 16)
	_, _ = rand.Read(raw)
	b64 = base64.StdEncoding.EncodeToString(raw)
	return
}

func wsseSecurity(user, pass string) string {
	if user == "" && pass == "" {
		return ""
	}
	n, nonceB64 := nonce()
	created := time.Now().UTC().Format("2006-01-02T15:04:05Z")

	h := sha1.New()
	h.Write(n)
	h.Write([]byte(created))
	h.Write([]byte(pass))
	digest := base64.StdEncoding.EncodeToString(h.Sum(nil))

	return fmt.Sprintf(`<Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">
      <UsernameToken>
        <Username>%s</Username>
        <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">%s</Password>
        <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">%s</Nonce>
        <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">%s</Created>
      </UsernameToken>
    </Security>`, user, digest, nonceB64, created)
}

func soapEnvelope(body, user, pass string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
            xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
            xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl"
            xmlns:timg="http://www.onvif.org/ver20/imaging/wsdl"
            xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Header>%s</s:Header>
  <s:Body>%s</s:Body>
</s:Envelope>`, wsseSecurity(user, pass), body)
}

func doPost(url, envelope string) (*http.Response, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	return client.Post(url, "application/soap+xml; charset=utf-8", strings.NewReader(envelope))
}

func soapRequest(url, body, user, pass string) ([]byte, error) {
	envelope := soapEnvelope(body, "", "")
	resp, err := doPost(url, envelope)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == 401 && user != "" {
		wwwAuth := resp.Header.Get("WWW-Authenticate")
		if strings.HasPrefix(strings.ToLower(wwwAuth), "digest") {
			return soapRequestDigest(url, body, user, pass, resp)
		}
	}

	if user != "" {
		if faultErr := checkSOAPFault(string(data)); faultErr != nil {
			lower := strings.ToLower(faultErr.Error())
			if strings.Contains(lower, "not authorized") || strings.Contains(lower, "unauthorized") {
				wsseEnvelope := soapEnvelope(body, user, pass)
				wsseResp, wsseErr := doPost(url, wsseEnvelope)
				if wsseErr != nil {
					return nil, wsseErr
				}
				defer wsseResp.Body.Close()
				wsseData, wsseErr := io.ReadAll(wsseResp.Body)
				if wsseErr != nil {
					return nil, wsseErr
				}
				return validateSOAPResponse(wsseData, wsseResp)
			}
			return nil, faultErr
		}
	}

	return validateSOAPResponse(data, resp)
}

func DigestAuthHeader(method, rawURL, user, pass, wwwAuth string) string {
	params := parseDigestChallenge(wwwAuth)
	realm := params["realm"]
	digestNonce := params["nonce"]
	qop := params["qop"]
	opaque := params["opaque"]

	ha1 := md5Hex(user + ":" + realm + ":" + pass)
	digestURI := rawURL
	if idx := strings.Index(rawURL, "://"); idx >= 0 {
		if slash := strings.Index(rawURL[idx+3:], "/"); slash >= 0 {
			digestURI = rawURL[idx+3+slash:]
		}
	}
	ha2 := md5Hex(method + ":" + digestURI)

	nc := "00000001"
	cnonce := fmt.Sprintf("%08x", time.Now().UnixNano())

	var response string
	if strings.Contains(qop, "auth") {
		response = md5Hex(ha1 + ":" + digestNonce + ":" + nc + ":" + cnonce + ":auth:" + ha2)
	} else {
		response = md5Hex(ha1 + ":" + digestNonce + ":" + ha2)
	}

	header := fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s"`,
		user, realm, digestNonce, digestURI, response)
	if strings.Contains(qop, "auth") {
		header += fmt.Sprintf(`, qop=auth, nc=%s, cnonce="%s"`, nc, cnonce)
	}
	if opaque != "" {
		header += fmt.Sprintf(`, opaque="%s"`, opaque)
	}
	return header
}

func soapRequestDigest(url, body, user, pass string, challengeResp *http.Response) ([]byte, error) {
	authHeader := DigestAuthHeader("POST", url, user, pass, challengeResp.Header.Get("WWW-Authenticate"))

	envelope := soapEnvelope(body, "", "")
	req, err := http.NewRequest("POST", url, strings.NewReader(envelope))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/soap+xml; charset=utf-8")
	req.Header.Set("Authorization", authHeader)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return validateSOAPResponse(data, resp)
}

func DigestPost(rawURL, user, pass, contentType string, body []byte) ([]byte, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	resp, err := client.Post(rawURL, contentType, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 401 || user == "" {
		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return io.ReadAll(resp.Body)
	}

	wwwAuth := resp.Header.Get("WWW-Authenticate")
	if !strings.HasPrefix(strings.ToLower(wwwAuth), "digest") {
		return nil, fmt.Errorf("HTTP 401 without digest challenge")
	}
	resp.Body.Close()

	req, err := http.NewRequest("POST", rawURL, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", DigestAuthHeader("POST", rawURL, user, pass, wwwAuth))

	resp2, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp2.Body.Close()

	if resp2.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d", resp2.StatusCode)
	}
	return io.ReadAll(resp2.Body)
}

func DigestGet(rawURL, user, pass string) ([]byte, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	resp, err := client.Get(rawURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 401 || user == "" {
		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return io.ReadAll(resp.Body)
	}

	wwwAuth := resp.Header.Get("WWW-Authenticate")
	if !strings.HasPrefix(strings.ToLower(wwwAuth), "digest") {
		return nil, fmt.Errorf("HTTP 401 without digest challenge")
	}
	resp.Body.Close()

	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", DigestAuthHeader("GET", rawURL, user, pass, wwwAuth))

	resp2, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp2.Body.Close()

	if resp2.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d", resp2.StatusCode)
	}
	return io.ReadAll(resp2.Body)
}

func validateSOAPResponse(data []byte, resp *http.Response) ([]byte, error) {
	if err := checkSOAPFault(string(data)); err != nil {
		return nil, err
	}
	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode >= 400 {
		snippet := strings.TrimSpace(string(data))
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, snippet)
	}
	if ct != "" && !strings.Contains(ct, "xml") && !strings.Contains(ct, "soap") {
		return nil, fmt.Errorf("unexpected content-type %q", ct)
	}
	return data, nil
}

func parseDigestChallenge(header string) map[string]string {
	params := make(map[string]string)
	header = strings.TrimPrefix(header, "Digest ")
	header = strings.TrimPrefix(header, "digest ")
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		eq := strings.Index(part, "=")
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(part[:eq])
		val := strings.TrimSpace(part[eq+1:])
		val = strings.Trim(val, `"`)
		params[strings.ToLower(key)] = val
	}
	return params
}

func md5Hex(s string) string {
	h := md5.Sum([]byte(s)) //nolint:gosec // HTTP Digest auth requires MD5
	return fmt.Sprintf("%x", h)
}

func checkSOAPFault(body string) error {
	lower := strings.ToLower(body)
	if !strings.Contains(lower, "fault") {
		return nil
	}

	faultStart := strings.Index(lower, "fault")
	if faultStart < 0 {
		return nil
	}
	tagStart := strings.LastIndex(lower[:faultStart], "<")
	if tagStart < 0 {
		return nil
	}

	var parts []string

	reason := extractFaultField(body, "Reason")
	if reason != "" {
		parts = append(parts, reason)
	}

	detail := extractFaultField(body, "Detail")
	if detail != "" {
		parts = append(parts, detail)
	}

	if len(parts) == 0 {
		if strings.Contains(lower, "notauthorized") {
			return fmt.Errorf("SOAP fault: not authorized")
		}
		return nil
	}

	return fmt.Errorf("SOAP fault: %s", strings.Join(parts, " — "))
}

func extractFaultField(body, section string) string {
	lower := strings.ToLower(body)
	tag := strings.ToLower(section)

	idx := -1
	for _, pattern := range []string{":" + tag + ">", "<" + tag + ">"} {
		i := strings.Index(lower, pattern)
		if i >= 0 {
			idx = i
			break
		}
	}
	if idx < 0 {
		return ""
	}

	start := strings.Index(body[idx:], ">")
	if start < 0 {
		return ""
	}
	start += idx + 1

	for _, prefix := range []string{"soap-env:", "soap:", "s:", "env:", ""} {
		ct := "</" + prefix + section + ">"
		ci := strings.Index(strings.ToLower(body[start:]), strings.ToLower(ct))
		if ci >= 0 {
			inner := strings.TrimSpace(body[start : start+ci])
			inner = stripXMLTags(inner)
			return inner
		}
	}
	return ""
}

// XML parsing helpers

func extractXAddrFromSection(body, section string) string {
	sectionStart := -1
	sectionEnd := -1
	lower := strings.ToLower(body)
	tag := strings.ToLower(section)

	for i := 0; i < len(lower); {
		idx := strings.Index(lower[i:], "<")
		if idx < 0 {
			break
		}
		idx += i

		end := strings.Index(lower[idx:], ">")
		if end < 0 {
			break
		}
		end += idx

		tagContent := lower[idx+1 : end]
		tagContent = strings.TrimPrefix(tagContent, "/")

		localName := tagContent
		if colon := strings.Index(localName, ":"); colon >= 0 {
			localName = localName[colon+1:]
		}
		if space := strings.IndexByte(localName, ' '); space >= 0 {
			localName = localName[:space]
		}

		if localName == tag {
			if sectionStart < 0 {
				sectionStart = idx
			}
		}

		if strings.HasPrefix(strings.TrimSpace(tagContent), "/") || strings.HasSuffix(strings.TrimSpace(lower[idx+1:end]), "/") {
			if localName == tag && sectionStart >= 0 {
				sectionEnd = end + 1
				break
			}
		}

		closingTag := fmt.Sprintf("</%s>", tag)
		if sectionStart >= 0 {
			closeIdx := strings.Index(lower[sectionStart:], closingTag)
			if closeIdx < 0 {
				for _, prefix := range []string{"tt:", "tds:", "trt:", "tptz:", "env:", "soap:", "soap-env:", "s:", ""} {
					ct := fmt.Sprintf("</%s%s>", prefix, tag)
					closeIdx = strings.Index(lower[sectionStart:], ct)
					if closeIdx >= 0 {
						sectionEnd = sectionStart + closeIdx + len(ct)
						break
					}
				}
			} else {
				sectionEnd = sectionStart + closeIdx + len(closingTag)
			}
			break
		}

		i = end + 1
	}

	if sectionStart < 0 || sectionEnd < 0 {
		return ""
	}

	sectionBody := body[sectionStart:sectionEnd]
	return extractTagValue(sectionBody, "XAddr")
}

func extractTagValue(xml, localName string) string {
	lower := strings.ToLower(xml)
	tag := strings.ToLower(localName)

	idx := strings.Index(lower, ":"+tag+">")
	if idx < 0 {
		idx = strings.Index(lower, "<"+tag+">")
		if idx < 0 {
			return ""
		}
	}

	start := strings.Index(xml[idx:], ">")
	if start < 0 {
		return ""
	}
	start += idx + 1

	end := strings.Index(lower[start:], "</")
	if end < 0 {
		return ""
	}

	return unescapeXML(strings.TrimSpace(xml[start : start+end]))
}

func unescapeXML(s string) string {
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&quot;", `"`)
	s = strings.ReplaceAll(s, "&apos;", "'")
	return s
}

func extractAttr(tag, name string) string {
	lower := strings.ToLower(tag)
	key := strings.ToLower(name) + "="
	idx := strings.Index(lower, key)
	if idx < 0 {
		return ""
	}
	rest := tag[idx+len(key):]
	if len(rest) == 0 {
		return ""
	}
	quote := rest[0]
	if quote != '"' && quote != '\'' {
		return ""
	}
	end := strings.IndexByte(rest[1:], quote)
	if end < 0 {
		return ""
	}
	return rest[1 : 1+end]
}

func findTag(body, localName string) string {
	lower := strings.ToLower(body)
	tag := strings.ToLower(localName)

	for _, pattern := range []string{":" + tag, "<" + tag} {
		idx := strings.Index(lower, pattern)
		if idx < 0 {
			continue
		}
		start := strings.LastIndex(body[:idx+1], "<")
		if start < 0 {
			continue
		}
		end := strings.Index(body[start:], ">")
		if end < 0 {
			continue
		}
		return body[start : start+end+1]
	}
	return ""
}

func stripXMLTags(s string) string {
	var b strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			continue
		}
		if !inTag {
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

func parseProfiles(body string) []MediaProfile {
	var profiles []MediaProfile
	lower := strings.ToLower(body)
	search := 0
	for {
		idx := strings.Index(lower[search:], "profiles")
		if idx < 0 {
			break
		}
		idx += search

		tagStart := strings.LastIndex(lower[:idx], "<")
		if tagStart < 0 {
			search = idx + 1
			continue
		}

		tag := lower[tagStart : idx+len("profiles")]
		if !strings.Contains(tag, "profiles") || strings.Contains(tag, "/") {
			search = idx + 1
			continue
		}

		tagEnd := strings.Index(body[tagStart:], ">")
		if tagEnd < 0 {
			search = idx + 1
			continue
		}
		openTag := body[tagStart : tagStart+tagEnd+1]

		token := extractAttr(openTag, "token")
		if token == "" {
			search = idx + 1
			continue
		}

		closeTag := -1
		for _, prefix := range []string{"tt:", "trt:", "tds:", ""} {
			ct := fmt.Sprintf("</%sProfiles>", prefix)
			ci := strings.Index(body[tagStart:], ct)
			if ci >= 0 {
				closeTag = tagStart + ci + len(ct)
				break
			}
		}
		if closeTag < 0 {
			search = idx + 1
			continue
		}

		profileBody := body[tagStart:closeTag]
		name := extractTagValue(profileBody, "Name")
		if name == "" {
			name = token
		}
		encoding := extractTagValue(profileBody, "Encoding")

		profiles = append(profiles, MediaProfile{Token: token, Name: name, Encoding: strings.ToUpper(encoding)})
		search = closeTag
	}
	return profiles
}

func parseFloat(s string) float64 {
	var f float64
	_, _ = fmt.Sscanf(s, "%f", &f)
	return f
}
