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
	Host     string
	Username string
	Password string
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
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"host": map[string]any{
				"type":           "string",
				"title":          "Host",
				"description":    "IP address or hostname of the camera",
				"ui:placeholder": "192.168.1.50",
				"ui:order":       0,
			},
			"username": map[string]any{
				"type":        "string",
				"title":       "Username",
				"description": "Override username for this camera (leave empty for global default)",
				"ui:order":    1,
			},
			"password": map[string]any{
				"type":        "string",
				"title":       "Password",
				"description": "Override password for this camera",
				"ui:widget":   "password",
				"ui:order":    2,
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
	return cfg
}
