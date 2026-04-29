package reolink

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
	Username string
	Password string
	FOV      float64
	RangeMin float64
	RangeMax float64
	Heading  float64
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
				"description":    "Default Reolink username for all cameras",
				"default":        "admin",
				"ui:placeholder": "admin",
				"ui:group":       "credentials",
				"ui:order":       0,
			},
			"password": map[string]any{
				"type":        "string",
				"title":       "Password",
				"description": "Default Reolink password for all cameras",
				"ui:widget":   "password",
				"ui:group":    "credentials",
				"ui:order":    1,
			},
			"auto_probe": map[string]any{
				"type":        "boolean",
				"title":       "Auto-Probe Discovered Cameras",
				"description": "Automatically connect to cameras discovered by netscan",
				"default":     true,
				"ui:group":    "discovery",
				"ui:order":    0,
			},
		},
	})
	return s
}

func cameraSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"username": map[string]any{
				"type":        "string",
				"title":       "Username",
				"description": "Override username for this camera (leave empty for global default)",
				"ui:order":    0,
			},
			"password": map[string]any{
				"type":        "string",
				"title":       "Password",
				"description": "Override password for this camera",
				"ui:widget":   "password",
				"ui:order":    1,
			},
			"fov": map[string]any{
				"type":        "number",
				"title":       "Field of View",
				"description": "Horizontal field of view in degrees",
				"minimum":     0,
				"maximum":     360,
				"ui:order":    2,
			},
			"range_min": map[string]any{
				"type":        "number",
				"title":       "Range Min",
				"description": "Blind zone distance in meters",
				"minimum":     0,
				"ui:order":    3,
			},
			"range_max": map[string]any{
				"type":        "number",
				"title":       "Range Max",
				"description": "Maximum range in meters",
				"minimum":     0,
				"ui:order":    4,
			},
			"heading": map[string]any{
				"type":        "number",
				"title":       "Heading",
				"description": "Camera heading in degrees from north (0-360)",
				"default":     0,
				"minimum":     0,
				"maximum":     360,
				"ui:order":    5,
			},
		},
	})
	return s
}

func parseServiceConfig(entity *pb.Entity) serviceConfig {
	cfg := serviceConfig{
		Username:  "admin",
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
	if v, ok := f["username"]; ok && v.GetStringValue() != "" {
		cfg.Username = v.GetStringValue()
	}
	if v, ok := f["password"]; ok && v.GetStringValue() != "" {
		cfg.Password = v.GetStringValue()
	}
	if v, ok := f["fov"]; ok && v.GetNumberValue() > 0 {
		cfg.FOV = v.GetNumberValue()
	}
	if v, ok := f["range_min"]; ok {
		cfg.RangeMin = v.GetNumberValue()
	}
	if v, ok := f["range_max"]; ok {
		cfg.RangeMax = v.GetNumberValue()
	}
	if v, ok := f["heading"]; ok {
		cfg.Heading = v.GetNumberValue()
	}
	return cfg
}
