package plugins

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/blang/semver/v4"
	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/cli"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const controllerName = "plugins"

func init() {
	builtin.Register(controllerName, Run)
}

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	index, err := FetchIndex(ctx)
	if err != nil {
		logger.Warn("failed to fetch plugin registry, continuing with empty list", "error", err)
		index = &PluginIndex{}
	}

	compatible := filterCompatible(index.Plugins, logger)
	logger.Info("plugin registry loaded", "total", len(index.Plugins), "compatible", len(compatible), "hydris_version", cli.HydrisVersion)

	serviceID := controllerName + ".service"

	if err := controller.Push(ctx, &pb.Entity{
		Id:    serviceID,
		Label: proto.String("Open Source Plugins"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Plugins"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("puzzle"),
		},
	}); err != nil {
		return err
	}

	// Push a child entity per plugin and run a controller for each.
	for _, p := range compatible {
		childID := controllerName + "." + p.Name
		if err := controller.Push(ctx, &pb.Entity{
			Id:    childID,
			Label: proto.String(p.Label),
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Parent:   proto.String(serviceID),
				Category: proto.String("Plugins"),
			},
			Configurable: &pb.ConfigurableComponent{
				Schema: enabledSchema(p),
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String(p.Icon),
			},
		}); err != nil {
			return err
		}
	}

	// Custom plugins service entity.
	customServiceID := controllerName + ".custom"
	if err := controller.Push(ctx, &pb.Entity{
		Id:    customServiceID,
		Label: proto.String("Custom Plugins"),
		Controller: &pb.Controller{
			Id: proto.String(controllerName),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Plugins"),
			State:    pb.DeviceState_DeviceStateActive,
		},
		Configurable: &pb.ConfigurableComponent{
			SupportedDeviceClasses: []*pb.DeviceClassOption{
				{Class: "plugin", Label: "Custom Plugin"},
				{Class: "feed", Label: "Plugin Feed"},
				{Class: "registry", Label: "Registry Credentials"},
			},
		},
		Interactivity: &pb.InteractivityComponent{
			Icon: proto.String("puzzle"),
		},
	}); err != nil {
		return err
	}

	var regStore registryStore

	var wg sync.WaitGroup

	// Run registry plugins.
	for _, p := range compatible {
		p := p
		childID := controllerName + "." + p.Name
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := controller.Run(ctx, childID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
				if !isEnabled(entity) {
					return nil
				}
				ready()
				return runPlugin(ctx, logger, p, serverURL, regStore.dockerConfigDir())
			})
			if err != nil && ctx.Err() == nil {
				logger.Error("plugin controller exited", "name", p.Name, "error", err)
			}
		}()
	}

	// Watch for user-created custom plugin, feed, and registry subdevices.
	wg.Add(1)
	go func() {
		defer wg.Done()
		err := controller.WatchChildren(ctx, customServiceID, controllerName, []controller.DeviceClass{
			{Class: "plugin", Label: "Custom Plugin", Schema: customPluginSchema()},
			{Class: "feed", Label: "Plugin Feed", Schema: feedSchema()},
			{Class: "registry", Label: "Registry Credentials", Schema: registrySchema()},
		}, func(ctx context.Context, entityID string) error {
			return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
				// Registry credential entities update the shared store.
				if entity.Device.GetClass() == "registry" {
					registry := configString(entity, "registry")
					username := configString(entity, "username")
					password := configString(entity, "password")
					if registry == "" || username == "" || password == "" {
						regStore.remove(entityID)
						return nil
					}
					regStore.set(entityID, registry, username, password)
					ready()
					<-ctx.Done()
					regStore.remove(entityID)
					return nil
				}

				// Feed entities: fetch a remote index and run its plugins.
				if entity.Device.GetClass() == "feed" {
					feedURL := configString(entity, "url")
					if feedURL == "" {
						return nil
					}
					feedUser := configString(entity, "username")
					feedToken := configString(entity, "token")
					return runFeed(ctx, logger, entityID, feedURL, feedUser, feedToken, serverURL, &regStore)
				}

				// Custom plugin entities.
				ref := configString(entity, "ref")
				if ref == "" || !isEnabled(entity) {
					return nil
				}
				if err := validatePluginRef(ref); err != nil {
					return err
				}
				ready()
				info := PluginInfo{Name: entityID, Ref: ref}
				return runPlugin(ctx, logger, info, serverURL, regStore.dockerConfigDir())
			})
		})
		if err != nil && ctx.Err() == nil {
			logger.Error("custom plugins watcher exited", "error", err)
		}
	}()

	wg.Wait()
	return nil
}

func enabledSchema(p PluginInfo) *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"enabled": map[string]any{
				"type":        "boolean",
				"title":       "Enabled",
				"description": p.Description + "\n" + p.Ref,
			},
		},
	})
	return s
}

func isEnabled(entity *pb.Entity) bool {
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return false
	}
	v, ok := entity.Config.Value.Fields["enabled"]
	return ok && v.GetBoolValue()
}

func filterCompatible(plugins []PluginInfo, logger *slog.Logger) []PluginInfo {
	raw := strings.TrimPrefix(cli.HydrisVersion, "v")
	cur, err := semver.ParseTolerant(raw)
	if err != nil {
		logger.Warn("cannot parse hydris version, showing all plugins", "version", cli.HydrisVersion)
		return plugins
	}

	var out []PluginInfo
	for _, p := range plugins {
		if p.Compat == "" {
			out = append(out, p)
			continue
		}
		rng, err := semver.ParseRange(p.Compat)
		if err != nil {
			logger.Warn("skipping plugin with invalid compat range", "name", p.Name, "compat", p.Compat)
			continue
		}
		if rng(cur) {
			out = append(out, p)
		} else {
			logger.Info("skipping incompatible plugin", "name", p.Name, "compat", p.Compat, "hydris", cli.HydrisVersion)
		}
	}
	return out
}

func feedSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"url": map[string]any{
				"type":           "string",
				"title":          "Feed URL",
				"description":    "URL to an index.json plugin feed. For GitLab use the API endpoint.",
				"ui:placeholder": "https://gitlab.com/api/v4/projects/ID/repository/files/feed.json/raw?ref=main",
				"ui:order":       0,
			},
			"username": map[string]any{
				"type":           "string",
				"title":          "Username",
				"description":    "Username for feed and registry auth (use \"oauth2\" for GitLab PATs)",
				"ui:placeholder": "oauth2",
				"ui:order":       1,
			},
			"token": map[string]any{
				"type":        "string",
				"title":       "Access Token",
				"description": "Token used for both the feed and pulling plugin images",
				"ui:widget":   "password",
				"ui:order":    2,
			},
		},
	})
	return s
}

// runFeed fetches a remote plugin index and runs each compatible plugin from it.
// If username and token are provided, registry credentials are automatically
// registered for each unique registry hostname found in the plugin refs.
func runFeed(ctx context.Context, logger *slog.Logger, feedEntityID, feedURL, feedUser, feedToken, serverURL string, regStore *registryStore) error {
	index, err := FetchRemoteIndexFromURL(ctx, feedURL, feedToken)
	if err != nil {
		logger.Error("failed to fetch plugin feed", "url", feedURL, "error", err)
		return err
	}

	compatible := filterCompatible(index.Plugins, logger)
	logger.Info("plugin feed loaded", "url", feedURL, "total", len(index.Plugins), "compatible", len(compatible))

	// Register credentials for each unique registry found in plugin refs.
	if feedUser != "" && feedToken != "" {
		seen := make(map[string]bool)
		for _, p := range compatible {
			host := registryHost(p.Ref)
			if host != "" && !seen[host] {
				seen[host] = true
				regStore.set(feedEntityID+".registry."+host, host, feedUser, feedToken)
			}
		}
		defer func() {
			for host := range seen {
				regStore.remove(feedEntityID + ".registry." + host)
			}
		}()
	}

	// Push child entities for each plugin in the feed.
	for _, p := range compatible {
		childID := feedEntityID + "." + p.Name
		if err := controller.Push(ctx, &pb.Entity{
			Id:    childID,
			Label: proto.String(p.Label),
			Controller: &pb.Controller{
				Id: proto.String(controllerName),
			},
			Device: &pb.DeviceComponent{
				Parent:   proto.String(feedEntityID),
				Category: proto.String("Plugins"),
			},
			Configurable: &pb.ConfigurableComponent{
				Schema: enabledSchema(p),
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String(p.Icon),
			},
		}); err != nil {
			return err
		}
	}

	// Run a controller for each plugin.
	var wg sync.WaitGroup
	for _, p := range compatible {
		p := p
		childID := feedEntityID + "." + p.Name
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := controller.Run(ctx, childID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
				if !isEnabled(entity) {
					return nil
				}
				ready()
				return runPlugin(ctx, logger, p, serverURL, regStore.dockerConfigDir())
			})
			if err != nil && ctx.Err() == nil {
				logger.Error("feed plugin controller exited", "name", p.Name, "error", err)
			}
		}()
	}
	wg.Wait()
	return nil
}

// registryHost extracts the registry hostname from an OCI image ref.
// Returns empty for local file refs.
func registryHost(ref string) string {
	if isLocalRef(ref) {
		return ""
	}
	// OCI refs are host/path:tag — the host is everything before the first slash.
	if i := strings.Index(ref, "/"); i > 0 {
		return ref[:i]
	}
	return ""
}

func customPluginSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"ref": map[string]any{
				"type":        "string",
				"title":       "Plugin Reference",
				"description": "OCI image reference or local file path (.ts/.js)",
			},
			"enabled": map[string]any{
				"type":        "boolean",
				"title":       "Enabled",
				"description": "Enable this custom plugin",
			},
		},
	})
	return s
}

func configString(entity *pb.Entity, key string) string {
	if entity.Config == nil || entity.Config.Value == nil || entity.Config.Value.Fields == nil {
		return ""
	}
	v, ok := entity.Config.Value.Fields[key]
	if !ok {
		return ""
	}
	return v.GetStringValue()
}

// validatePluginRef checks that local file paths are allowed by --allow-path.
func validatePluginRef(ref string) error {
	if !isLocalRef(ref) {
		return nil
	}
	if err := builtin.ValidatePath(ref); err != nil {
		return fmt.Errorf("plugin path %q is not allowed; add --allow-path=%s to hydris startup", ref, filepath.Dir(ref))
	}
	return nil
}

func isLocalRef(ref string) bool {
	ext := filepath.Ext(ref)
	return ext == ".ts" || ext == ".js"
}

func registrySchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"registry": map[string]any{
				"type":           "string",
				"title":          "Registry",
				"description":    "Container registry hostname (e.g. ghcr.io)",
				"ui:placeholder": "ghcr.io",
				"ui:order":       0,
			},
			"username": map[string]any{
				"type":     "string",
				"title":    "Username",
				"ui:order": 1,
			},
			"password": map[string]any{
				"type":      "string",
				"title":     "Password / Token",
				"ui:widget": "password",
				"ui:order":  2,
			},
		},
	})
	return s
}

// registryStore collects credentials from multiple registry entities and
// writes a merged Docker-compatible config.json.
type registryStore struct {
	mu      sync.Mutex
	entries map[string]registryEntry // keyed by entity ID
	dir     string                   // temp dir containing config.json
}

type registryEntry struct {
	registry string
	username string
	password string
}

func (s *registryStore) set(entityID, registry, username, password string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.entries == nil {
		s.entries = make(map[string]registryEntry)
	}
	s.entries[entityID] = registryEntry{registry, username, password}
	s.flush()
}

func (s *registryStore) remove(entityID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, entityID)
	s.flush()
}

// flush writes all collected credentials into a single config.json.
// Must be called with s.mu held.
func (s *registryStore) flush() {
	if len(s.entries) == 0 {
		if s.dir != "" {
			os.RemoveAll(s.dir)
			s.dir = ""
		}
		return
	}

	auths := make(map[string]any, len(s.entries))
	for _, e := range s.entries {
		auth := base64.StdEncoding.EncodeToString([]byte(e.username + ":" + e.password))
		auths[e.registry] = map[string]any{"auth": auth}
	}
	data, err := json.Marshal(map[string]any{"auths": auths})
	if err != nil {
		slog.Error("marshal docker config", "error", err)
		return
	}

	if s.dir == "" {
		s.dir, err = os.MkdirTemp("", "hydris-docker-config-*")
		if err != nil {
			slog.Error("create docker config dir", "error", err)
			return
		}
	}
	if err := os.WriteFile(filepath.Join(s.dir, "config.json"), data, 0600); err != nil {
		slog.Error("write docker config", "error", err)
	}
}

func (s *registryStore) dockerConfigDir() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dir
}
