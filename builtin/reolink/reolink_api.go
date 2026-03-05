package reolink

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
)

type reolinkSession struct {
	baseURL string
	token   string
}

var (
	sessionMu sync.Mutex
	sessions  = map[string]*reolinkSession{} // keyed by baseURL
)

type reolinkCmd struct {
	Cmd    string      `json:"cmd"`
	Action int         `json:"action"`
	Param  interface{} `json:"param"`
}

type reolinkResp struct {
	Cmd   string                 `json:"cmd"`
	Code  int                    `json:"code"`
	Value map[string]interface{} `json:"value"`
}

type ptzPosition struct {
	Pan  float64
	Tilt float64
	Zoom float64
}

// reolinkAPI sends a command to the Reolink HTTP API.
func reolinkAPI(host, user, pass string, commands []reolinkCmd) ([]reolinkResp, error) {
	sess, err := getSession(host, user, pass)
	if err != nil {
		return nil, err
	}

	payload, _ := json.Marshal(commands)

	resp, err := http.Post(
		sess.baseURL+"?token="+sess.token,
		"application/json",
		strings.NewReader(string(payload)),
	)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var results []reolinkResp
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, fmt.Errorf("parse: %w\nraw: %s", err, body)
	}

	return results, nil
}

func getSession(host, user, pass string) (*reolinkSession, error) {
	baseURL := fmt.Sprintf("http://%s/api.cgi", host)

	sessionMu.Lock()
	defer sessionMu.Unlock()

	if sess, ok := sessions[baseURL]; ok {
		return sess, nil
	}

	token, err := reolinkLogin(baseURL, user, pass)
	if err != nil {
		return nil, fmt.Errorf("login: %w", err)
	}

	sess := &reolinkSession{baseURL: baseURL, token: token}
	sessions[baseURL] = sess
	return sess, nil
}

func clearSession(host string) {
	baseURL := fmt.Sprintf("http://%s/api.cgi", host)
	sessionMu.Lock()
	delete(sessions, baseURL)
	sessionMu.Unlock()
}

func reolinkLogin(baseURL, user, pass string) (string, error) {
	payload := fmt.Sprintf(`[{"cmd":"Login","action":0,"param":{"User":{"userName":"%s","password":"%s"}}}]`, user, pass)

	resp, err := http.Post(baseURL+"?cmd=Login", "application/json", strings.NewReader(payload))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var results []reolinkResp
	if err := json.Unmarshal(body, &results); err != nil {
		return "", fmt.Errorf("parse login: %w", err)
	}

	if len(results) == 0 {
		return "", fmt.Errorf("empty login response")
	}

	token, ok := results[0].Value["Token"]
	if !ok {
		return "", fmt.Errorf("no token in login response: %s", body)
	}

	tokenMap, ok := token.(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("unexpected token format: %s", body)
	}

	name, ok := tokenMap["name"].(string)
	if !ok {
		return "", fmt.Errorf("no token name: %s", body)
	}

	return name, nil
}

func reolinkLogout(host, user, pass string) {
	sess, err := getSession(host, user, pass)
	if err != nil {
		return
	}
	payload := `[{"cmd":"Logout","action":0,"param":{}}]`
	http.Post(sess.baseURL+"?token="+sess.token, "application/json", strings.NewReader(payload))
	clearSession(host)
}

// getPTZPosition reads the current pan/tilt/zoom from the camera.
func getPTZPosition(host, user, pass string) (ptzPosition, error) {
	results, err := reolinkAPI(host, user, pass, []reolinkCmd{
		{Cmd: "GetPtzCurPos", Action: 0, Param: map[string]interface{}{
			"PtzCurPos": map[string]interface{}{"channel": 0},
		}},
	})
	if err != nil {
		return ptzPosition{}, err
	}

	for _, r := range results {
		if r.Cmd == "GetPtzCurPos" {
			if pos, ok := r.Value["PtzCurPos"].(map[string]interface{}); ok {
				return ptzPosition{
					Pan:  toFloat(pos["Ppos"]),
					Tilt: toFloat(pos["Tpos"]),
					Zoom: toFloat(pos["Zpos"]),
				}, nil
			}
		}
	}

	return ptzPosition{}, fmt.Errorf("no position in response")
}

// reolinkPTZMove sends a directional move command at the given speed.
func reolinkPTZMove(host, user, pass, dir string, speed int) error {
	_, err := reolinkAPI(host, user, pass, []reolinkCmd{
		{Cmd: "PtzCtrl", Action: 0, Param: map[string]interface{}{
			"channel": 0,
			"op":      dir,
			"speed":   speed,
		}},
	})
	return err
}

// reolinkPTZStop stops all PTZ movement.
func reolinkPTZStop(host, user, pass string) {
	reolinkAPI(host, user, pass, []reolinkCmd{
		{Cmd: "PtzCtrl", Action: 0, Param: map[string]interface{}{
			"channel": 0,
			"op":      "Stop",
		}},
	})
}

// setAbsoluteZoom sets the optical zoom to an absolute position (0-32).
func setAbsoluteZoom(host, user, pass string, pos int) error {
	_, err := reolinkAPI(host, user, pass, []reolinkCmd{
		{Cmd: "StartZoomFocus", Action: 0, Param: map[string]interface{}{
			"ZoomFocus": map[string]interface{}{
				"channel": 0,
				"op":      "ZoomPos",
				"pos":     pos,
			},
		}},
	})
	return err
}

// getDeviceInfo retrieves manufacturer/model/serial from a Reolink camera.
func getDeviceInfo(host, user, pass string) (manufacturer, model, serial string, err error) {
	results, err := reolinkAPI(host, user, pass, []reolinkCmd{
		{Cmd: "GetDevInfo", Action: 0, Param: map[string]interface{}{}},
	})
	if err != nil {
		return "", "", "", err
	}

	for _, r := range results {
		if r.Cmd == "GetDevInfo" {
			if info, ok := r.Value["DevInfo"].(map[string]interface{}); ok {
				model, _ = info["model"].(string)
				serial, _ = info["serial"].(string)
				return "Reolink", model, serial, nil
			}
		}
	}
	return "Reolink", "", "", nil
}

func toFloat(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	default:
		return 0
	}
}

// Closed-loop PTZ movement (ported from camshi).

const (
	panTolerance  = 50
	tiltTolerance = 50
	gotoTimeout   = 30 * time.Second
)

// waitStablePos polls position until it stops changing. Returns the full
// stable position. If onPosition is non-nil it is called with each
// intermediate reading so the entity pose stays up to date during moves.
func waitStablePos(host, user, pass string, onPosition func(ptzPosition)) ptzPosition {
	var last ptzPosition
	sameCount := 0
	for i := 0; i < 40; i++ {
		time.Sleep(200 * time.Millisecond)
		pos, err := getPTZPosition(host, user, pass)
		if err != nil {
			continue
		}
		if onPosition != nil {
			onPosition(pos)
		}
		if i > 0 && pos.Pan == last.Pan && pos.Tilt == last.Tilt {
			sameCount++
			if sameCount >= 3 {
				return pos
			}
		} else {
			sameCount = 0
		}
		last = pos
	}
	return last
}

// moveAxis moves one PTZ axis toward a target using closed-loop feedback.
// onPosition is called after each intermediate move with the full current position.
// Returns the final position on that axis.
func moveAxis(host, user, pass string, current, target float64,
	dirForSign func(int) string,
	readAxis func(ptzPosition) float64,
	onPosition func(ptzPosition),
	profile speedProfile,
	tolerance float64,
) float64 {
	deadline := time.Now().Add(gotoTimeout)

	for time.Now().Before(deadline) {
		err := target - current
		if math.Abs(err) < tolerance {
			return current
		}

		speed, dur := profile(err)
		sign := 1
		if err < 0 {
			sign = -1
		}
		dir := dirForSign(sign)

		reolinkPTZMove(host, user, pass, dir, speed)
		if dur > 0 {
			time.Sleep(dur)
		}
		reolinkPTZStop(host, user, pass)

		pos := waitStablePos(host, user, pass, onPosition)
		current = readAxis(pos)
	}

	reolinkPTZStop(host, user, pass)
	return current
}

type speedProfile func(float64) (int, time.Duration)

func panSpeedProfile(err float64) (int, time.Duration) {
	dist := math.Abs(err)
	switch {
	case dist > 2000:
		return 32, 1500 * time.Millisecond
	case dist > 1000:
		return 32, 800 * time.Millisecond
	case dist > 500:
		return 16, 400 * time.Millisecond
	case dist > 300:
		return 8, 150 * time.Millisecond
	default:
		return 1, 0
	}
}

func tiltSpeedProfile(err float64) (int, time.Duration) {
	_ = err
	// Single brief nudge at minimum speed. The stop command follows
	// immediately — actual pulse length is bounded by network RTT.
	return 1, 0
}
