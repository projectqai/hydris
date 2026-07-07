package axis

import (
	"google.golang.org/protobuf/types/known/structpb"

	pb "github.com/projectqai/proto/go"
)

type serviceConfig struct {
	Username  string
	Password  string
	AutoProbe bool
}

type cameraConfig struct {
	Host              string
	Username          string
	Password          string
	Resolution        string
	Codec             string
	FPS               int
	Compression       int
	Bitrate           int
	KeyframeInterval  int
	BitrateMode       string
	H264Profile       string
	ZipstreamStrength int
	Audio             bool
	Rotation          int
	EnableDirectDrive bool
}

func serviceSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"ui:groups": []any{
			map[string]any{"key": "credentials", "title": "Credentials"},
			map[string]any{"key": "discovery", "title": "Discovery"},
		},
		"properties": map[string]any{
			"username": map[string]any{
				"type":           "string",
				"title":          "Username",
				"description":    "Default AXIS username for all cameras",
				"default":        "root",
				"ui:placeholder": "root",
				"ui:group":       "credentials",
				"ui:order":       0,
			},
			"password": map[string]any{
				"type":        "string",
				"title":       "Password",
				"description": "Default AXIS password for all cameras",
				"ui:widget":   "password",
				"ui:group":    "credentials",
				"ui:order":    1,
			},
			"auto_probe": map[string]any{
				"type":        "boolean",
				"title":       "Auto-Probe Discovered Cameras",
				"description": "Automatically connect to AXIS cameras discovered via ONVIF",
				"default":     true,
				"ui:group":    "discovery",
				"ui:order":    0,
			},
		},
	})
	return s
}

func cameraSchema() *structpb.Struct {
	return cameraSchemaWithCaps(nil)
}

func cameraSchemaWithCaps(caps *imageCapabilities) *structpb.Struct {
	resProp := map[string]any{
		"type":     "string",
		"title":    "Resolution",
		"default":  "",
		"ui:group": "stream",
		"ui:order": 3,
	}
	codecProp := map[string]any{
		"type":     "string",
		"title":    "Codec",
		"default":  "",
		"ui:group": "stream",
		"ui:order": 4,
	}
	fpsProp := map[string]any{
		"type":        "integer",
		"title":       "FPS",
		"description": "0 = camera default",
		"default":     0,
		"minimum":     0,
		"ui:group":    "stream",
		"ui:order":    5,
	}
	compressionProp := map[string]any{
		"type":        "integer",
		"title":       "Compression",
		"description": "0 = camera default, 1-100",
		"default":     0,
		"minimum":     0,
		"maximum":     100,
		"ui:group":    "stream",
		"ui:order":    6,
	}
	bitrateProp := map[string]any{
		"type":        "integer",
		"title":       "Bitrate (kbps)",
		"description": "0 = camera default",
		"default":     0,
		"minimum":     0,
		"ui:group":    "stream",
		"ui:order":    7,
	}
	keyframeIntervalProp := map[string]any{
		"type":        "integer",
		"title":       "Keyframe Interval",
		"description": "Frames between keyframes (GOP length). 0 = camera default",
		"default":     0,
		"minimum":     0,
		"maximum":     512,
		"ui:group":    "stream",
		"ui:order":    8,
	}
	bitrateModeProp := map[string]any{
		"type":    "string",
		"title":   "Bitrate Mode",
		"default": "",
		"oneOf": []any{
			map[string]any{"const": "", "title": "Default"},
			map[string]any{"const": "vbr", "title": "VBR (Variable)"},
			map[string]any{"const": "cbr", "title": "CBR (Constant)"},
		},
		"ui:group": "stream",
		"ui:order": 9,
	}
	h264ProfileProp := map[string]any{
		"type":    "string",
		"title":   "H.264 Profile",
		"default": "",
		"oneOf": []any{
			map[string]any{"const": "", "title": "Default"},
			map[string]any{"const": "baseline", "title": "Baseline"},
			map[string]any{"const": "main", "title": "Main"},
			map[string]any{"const": "high", "title": "High"},
		},
		"ui:group": "stream",
		"ui:order": 10,
	}
	zipstreamStrengthProp := map[string]any{
		"type":        "integer",
		"title":       "Zipstream Strength",
		"description": "0 = off, 10 = low, 20 = medium, 30 = high, 50 = extreme",
		"default":     0,
		"minimum":     0,
		"maximum":     50,
		"ui:group":    "stream",
		"ui:order":    11,
	}
	audioProp := map[string]any{
		"type":     "boolean",
		"title":    "Audio",
		"default":  false,
		"ui:group": "stream",
		"ui:order": 12,
	}
	rotationProp := map[string]any{
		"type":    "integer",
		"title":   "Rotation",
		"default": 0,
		"oneOf": []any{
			map[string]any{"const": 0, "title": "0°"},
			map[string]any{"const": 90, "title": "90°"},
			map[string]any{"const": 180, "title": "180°"},
			map[string]any{"const": 270, "title": "270°"},
		},
		"ui:group": "stream",
		"ui:order": 13,
	}

	if caps != nil {
		if len(caps.Resolutions) > 0 {
			opts := []any{map[string]any{"const": "", "title": "Default"}}
			for _, r := range caps.Resolutions {
				opts = append(opts, map[string]any{"const": r, "title": r})
			}
			resProp["oneOf"] = opts
		}
		if len(caps.Codecs) > 0 {
			opts := []any{map[string]any{"const": "", "title": "Default"}}
			for _, c := range caps.Codecs {
				opts = append(opts, map[string]any{"const": c, "title": c})
			}
			codecProp["oneOf"] = opts
		}
		if caps.MaxFPS > 0 {
			fpsProp["maximum"] = caps.MaxFPS
		}
	}

	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"ui:groups": []any{
			map[string]any{"key": "connection", "title": "Connection"},
			map[string]any{"key": "stream", "title": "Stream"},
		},
		"properties": map[string]any{
			"host": map[string]any{
				"type":           "string",
				"title":          "Host",
				"description":    "IP address or hostname of the camera",
				"ui:placeholder": "192.168.1.50",
				"ui:group":       "connection",
				"ui:order":       0,
			},
			"username": map[string]any{
				"type":        "string",
				"title":       "Username",
				"description": "Override username for this camera (leave empty for global default)",
				"ui:group":    "connection",
				"ui:order":    1,
			},
			"password": map[string]any{
				"type":        "string",
				"title":       "Password",
				"description": "Override password for this camera",
				"ui:widget":   "password",
				"ui:group":    "connection",
				"ui:order":    2,
			},
			"resolution":         resProp,
			"codec":              codecProp,
			"fps":                fpsProp,
			"compression":        compressionProp,
			"bitrate":            bitrateProp,
			"keyframe_interval":  keyframeIntervalProp,
			"bitrate_mode":       bitrateModeProp,
			"h264_profile":       h264ProfileProp,
			"zipstream_strength": zipstreamStrengthProp,
			"audio":              audioProp,
			"rotation":           rotationProp,
			"enable_direct_drive": map[string]any{
				"type":        "boolean",
				"title":       "Direct Drive",
				"description": "Accept manual joystick control for pan and tilt",
				"default":     false,
				"ui:order":    14,
			},
		},
	})
	return s
}

func parseServiceConfig(entity *pb.Entity) serviceConfig {
	cfg := serviceConfig{
		Username:  "root",
		AutoProbe: true,
	}
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return cfg
	}
	f := entity.Config.Value.Fields
	if v, ok := f["username"]; ok {
		cfg.Username = v.GetStringValue()
	}
	if v, ok := f["password"]; ok {
		cfg.Password = v.GetStringValue()
	}
	if v, ok := f["auto_probe"]; ok {
		cfg.AutoProbe = v.GetBoolValue()
	}
	return cfg
}

func parseCameraConfig(entity *pb.Entity, defaults serviceConfig) cameraConfig {
	cfg := cameraConfig{
		Username: defaults.Username,
		Password: defaults.Password,
	}
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return cfg
	}
	f := entity.Config.Value.Fields
	if v, ok := f["host"]; ok && v.GetStringValue() != "" {
		cfg.Host = v.GetStringValue()
	}
	if v, ok := f["username"]; ok && v.GetStringValue() != "" {
		cfg.Username = v.GetStringValue()
	}
	if v, ok := f["password"]; ok && v.GetStringValue() != "" {
		cfg.Password = v.GetStringValue()
	}
	if v, ok := f["resolution"]; ok && v.GetStringValue() != "" {
		cfg.Resolution = v.GetStringValue()
	}
	if v, ok := f["codec"]; ok && v.GetStringValue() != "" {
		cfg.Codec = v.GetStringValue()
	}
	if v, ok := f["fps"]; ok {
		cfg.FPS = int(v.GetNumberValue())
	}
	if v, ok := f["compression"]; ok {
		cfg.Compression = int(v.GetNumberValue())
	}
	if v, ok := f["bitrate"]; ok {
		cfg.Bitrate = int(v.GetNumberValue())
	}
	if v, ok := f["keyframe_interval"]; ok {
		cfg.KeyframeInterval = int(v.GetNumberValue())
	}
	if v, ok := f["bitrate_mode"]; ok && v.GetStringValue() != "" {
		cfg.BitrateMode = v.GetStringValue()
	}
	if v, ok := f["h264_profile"]; ok && v.GetStringValue() != "" {
		cfg.H264Profile = v.GetStringValue()
	}
	if v, ok := f["zipstream_strength"]; ok {
		cfg.ZipstreamStrength = int(v.GetNumberValue())
	}
	if v, ok := f["audio"]; ok {
		cfg.Audio = v.GetBoolValue()
	}
	if v, ok := f["rotation"]; ok {
		cfg.Rotation = int(v.GetNumberValue())
	}
	if v, ok := f["enable_direct_drive"]; ok {
		cfg.EnableDirectDrive = v.GetBoolValue()
	}
	return cfg
}
