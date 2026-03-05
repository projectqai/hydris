package cli

import (
	"context"
	crand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/huh/spinner"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"github.com/spf13/cobra"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type schemaProperty struct {
	Name        string
	Title       string
	Description string
	Type        string
	Default     interface{}
	Minimum     *float64
	Maximum     *float64
	Required    bool
	Order       int
	Placeholder string
	Unit        string
	Enum        []interface{}
}

func runConfigure(cmd *cobra.Command, args []string) error {
	if len(args) == 1 {
		return runConfigureSingle(cmd, args[0])
	}
	return runConfigureInteractive(cmd)
}

// runConfigureInteractive shows the device tree and lets the user pick actions.
func runConfigureInteractive(cmd *cobra.Command) error {
	client := pb.NewWorldServiceClient(conn)

	for {
		clearTerm()

		// Fetch all device entities
		devResp, err := client.ListEntities(context.Background(), &pb.ListEntitiesRequest{
			Filter: &pb.EntityFilter{
				Component: []uint32{50}, // DeviceComponent
			},
		})
		if err != nil {
			return fmt.Errorf("failed to list entities: %w", err)
		}

		if len(devResp.Entities) == 0 {
			fmt.Println("No devices found")
			return nil
		}

		// Build tree
		byID := make(map[string]*deviceNode, len(devResp.Entities))
		for _, e := range devResp.Entities {
			if e == nil {
				continue
			}
			byID[e.Id] = &deviceNode{entity: e}
		}

		var roots []*deviceNode
		for _, node := range byID {
			dev := node.entity.Device
			if dev == nil || dev.Parent == nil || *dev.Parent == "" {
				roots = append(roots, node)
				continue
			}
			parent, ok := byID[*dev.Parent]
			if !ok {
				roots = append(roots, node)
				continue
			}
			parent.children = append(parent.children, node)
		}

		slices.SortFunc(roots, func(a, b *deviceNode) int {
			return strings.Compare(a.entity.Id, b.entity.Id)
		})

		// Flatten tree into selectable options
		type treeEntry struct {
			entity *pb.Entity
			label  string
		}
		var entries []treeEntry
		var flatten func(node *deviceNode, prefix string, last bool)
		flatten = func(node *deviceNode, prefix string, last bool) {
			connector := "├── "
			if last {
				connector = "└── "
			}
			entries = append(entries, treeEntry{
				entity: node.entity,
				label:  prefix + connector + deviceLine(node.entity),
			})
			childPrefix := prefix + "│   "
			if last {
				childPrefix = prefix + "    "
			}
			slices.SortFunc(node.children, func(a, b *deviceNode) int {
				return strings.Compare(a.entity.Id, b.entity.Id)
			})
			for i, child := range node.children {
				flatten(child, childPrefix, i == len(node.children)-1)
			}
		}
		for i, root := range roots {
			flatten(root, "", i == len(roots)-1)
		}

		// Build select options
		var options []huh.Option[string]
		for _, e := range entries {
			options = append(options, huh.NewOption(e.label, e.entity.Id))
		}

		options = append(options, huh.NewOption("(refresh)", "\x00refresh"))

		var selected string
		err = runSelect(
			huh.NewSelect[string]().
				Title("Device Tree").
				Options(options...).
				Value(&selected),
		)
		if err != nil {
			if errors.Is(err, huh.ErrUserAborted) {
				return nil
			}
			return err
		}

		if selected == "\x00refresh" {
			continue
		}

		runDeviceDetail(cmd, client, selected)
	}
}

func runDeviceDetail(cmd *cobra.Command, client pb.WorldServiceClient, entityID string) {
	for {
		// Re-fetch entity to get current state
		getResp, err := client.GetEntity(context.Background(), &pb.GetEntityRequest{Id: entityID})
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		entity := getResp.Entity

		clearTerm()

		// Build detailed status
		var lines []string
		lines = append(lines, fmt.Sprintf("ID:    %s", entity.Id))
		if entity.Label != nil {
			lines = append(lines, fmt.Sprintf("Label: %s", *entity.Label))
		}
		if entity.Device != nil {
			if entity.Device.Class != nil {
				lines = append(lines, fmt.Sprintf("Class: %s", *entity.Device.Class))
			}
			if entity.Device.Category != nil {
				lines = append(lines, fmt.Sprintf("Category: %s", *entity.Device.Category))
			}
			if entity.Device.Parent != nil && *entity.Device.Parent != "" {
				lines = append(lines, fmt.Sprintf("Parent: %s", *entity.Device.Parent))
			}
		}
		if entity.Controller != nil {
			if entity.Controller.Id != nil {
				lines = append(lines, fmt.Sprintf("Controller: %s", *entity.Controller.Id))
			}
			if entity.Controller.Node != nil {
				lines = append(lines, fmt.Sprintf("Node: %s", *entity.Controller.Node))
			}
		}

		// State
		if entity.Configurable != nil {
			state := ""
			switch entity.Configurable.State {
			case pb.ConfigurableState_ConfigurableStateActive:
				state = "active"
			case pb.ConfigurableState_ConfigurableStateFailed:
				state = "failed"
				if entity.Configurable.Error != nil {
					state += ": " + *entity.Configurable.Error
				}
			case pb.ConfigurableState_ConfigurableStateStarting:
				state = "starting"
			case pb.ConfigurableState_ConfigurableStateScheduled:
				state = "scheduled"
			case pb.ConfigurableState_ConfigurableStateInactive:
				state = "inactive"
			case pb.ConfigurableState_ConfigurableStateConflict:
				state = "conflict"
			}
			if state != "" {
				lines = append(lines, fmt.Sprintf("State: %s", state))
			}
		} else if entity.Device != nil {
			switch entity.Device.State {
			case pb.DeviceState_DeviceStateActive:
				lines = append(lines, "State: active")
			case pb.DeviceState_DeviceStateFailed:
				s := "State: failed"
				if entity.Device.Error != nil {
					s += ": " + *entity.Device.Error
				}
				lines = append(lines, s)
			}
		}

		// Config values
		if entity.Config != nil && entity.Config.Value != nil {
			vals := getExistingValues(entity)
			if len(vals) > 0 {
				lines = append(lines, "Config:")
				for k, v := range vals {
					lines = append(lines, fmt.Sprintf("  %s: %s", k, formatValue(v)))
				}
			}
		}

		fmt.Println(strings.Join(lines, "\n"))
		fmt.Println()

		// Build action list
		var actions []huh.Option[string]

		if entity.Configurable != nil && entity.Configurable.Schema != nil {
			actions = append(actions, huh.NewOption("Configure", "configure"))
		}

		if entity.Config != nil && entity.Config.Value != nil {
			actions = append(actions, huh.NewOption("Clear config", "clear"))
		}

		if entity.Configurable != nil && len(entity.Configurable.SupportedDeviceClasses) > 0 {
			actions = append(actions, huh.NewOption("Add device", "add"))
		}

		if entity.Device != nil && entity.Device.Parent != nil && *entity.Device.Parent != "" {
			actions = append(actions, huh.NewOption("Delete", "delete"))
		}

		actions = append(actions, huh.NewOption("Back", "back"))

		if len(actions) == 1 {
			return
		}

		var action string
		err = runSelect(
			huh.NewSelect[string]().
				Title("Actions").
				Options(actions...).
				Value(&action),
		)
		if err != nil {
			if errors.Is(err, huh.ErrUserAborted) {
				return
			}
			fmt.Printf("Error: %v\n", err)
			return
		}

		switch action {
		case "configure":
			if err := runConfigureSingle(cmd, entityID); err != nil {
				if !errors.Is(err, huh.ErrUserAborted) {
					fmt.Printf("Error: %v\n", err)
				}
			}
		case "clear":
			if err := runClearConfig(client, entity); err != nil {
				fmt.Printf("Error: %v\n", err)
			}
		case "add":
			newID, err := runAddDevice(cmd, client, entity)
			if err != nil {
				if !errors.Is(err, huh.ErrUserAborted) {
					fmt.Printf("Error: %v\n", err)
				}
			} else if newID != "" {
				runDeviceDetail(cmd, client, newID)
			}
		case "delete":
			if err := runDeleteDevice(client, entity); err != nil {
				fmt.Printf("Error: %v\n", err)
			}
			return
		case "back":
			return
		}
	}
}

// escKeyMap returns a KeyMap where ESC and ctrl+c both quit.
func escKeyMap() *huh.KeyMap {
	km := huh.NewDefaultKeyMap()
	km.Quit = key.NewBinding(key.WithKeys("ctrl+c", "esc"))
	return km
}

// runSelect wraps a Select in a Form with ESC-to-quit support.
func runSelect[T comparable](s *huh.Select[T]) error {
	return runField(s)
}

// runField wraps any huh.Field in a Form with ESC-to-quit support.
func runField(f huh.Field) error {
	return huh.NewForm(huh.NewGroup(f)).WithKeyMap(escKeyMap()).Run()
}

// clearTerm clears the terminal screen using ANSI escape codes.
func clearTerm() {
	fmt.Fprint(os.Stdout, "\033[H\033[2J")
}

func runClearConfig(client pb.WorldServiceClient, entity *pb.Entity) error {
	entity.Config = nil
	_, err := client.Push(context.Background(), &pb.EntityChangeRequest{
		Replacements: []*pb.Entity{entity},
	})
	if err != nil {
		return fmt.Errorf("failed to clear configuration: %w", err)
	}
	fmt.Printf("Configuration for %q cleared\n", entity.Id)
	return nil
}

func runAddDevice(_ *cobra.Command, client pb.WorldServiceClient, parent *pb.Entity) (string, error) {
	classes := parent.Configurable.GetSupportedDeviceClasses()
	if len(classes) == 0 {
		return "", fmt.Errorf("no supported device classes")
	}

	// Pick device class
	var classOptions []huh.Option[string]
	classMap := map[string]*pb.DeviceClassOption{}
	for _, c := range classes {
		label := c.Label
		if label == "" {
			label = c.Class
		}
		classOptions = append(classOptions, huh.NewOption(label, c.Class))
		classMap[c.Class] = c
	}

	var selectedClass string
	if len(classes) == 1 {
		selectedClass = classes[0].Class
	} else {
		err := runSelect(
			huh.NewSelect[string]().
				Title("Device class").
				Options(classOptions...).
				Value(&selectedClass),
		)
		if err != nil {
			return "", err
		}
	}

	// Generate a default device ID with random suffix
	var rnd [8]byte
	if _, err := crand.Read(rnd[:]); err != nil {
		return "", fmt.Errorf("generating random bytes: %w", err)
	}
	deviceID := fmt.Sprintf("%s.%s.%x", parent.Id, selectedClass, rnd)

	err := runField(
		huh.NewInput().
			Title("Device ID").
			Description(fmt.Sprintf("Unique ID for the new %s device", classMap[selectedClass].GetLabel())).
			Value(&deviceID).
			Validate(func(s string) error {
				s = strings.TrimSpace(s)
				if s == "" {
					return fmt.Errorf("required")
				}
				return nil
			}),
	)
	if err != nil {
		return "", err
	}
	deviceID = strings.TrimSpace(deviceID)

	// Push the new device entity
	parentID := parent.Id
	resp, err := client.Push(context.Background(), &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: deviceID,
			Device: &pb.DeviceComponent{
				Parent: &parentID,
				Class:  proto.String(selectedClass),
			},
		}},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create device: %w", err)
	}
	if !resp.Accepted {
		return "", fmt.Errorf("device creation was not accepted")
	}

	fmt.Printf("Device %q created under %q\n", deviceID, parent.Id)
	return deviceID, nil
}

func runDeleteDevice(client pb.WorldServiceClient, entity *pb.Entity) error {
	_, err := client.ExpireEntity(context.Background(), &pb.ExpireEntityRequest{
		Id: entity.Id,
	})
	if err != nil {
		return fmt.Errorf("failed to delete device: %w", err)
	}

	fmt.Printf("Device %q deleted\n", entity.Id)
	return nil
}

func runConfigureSingle(cmd *cobra.Command, entityID string) error {
	client := pb.NewWorldServiceClient(conn)

	clearConfig, _ := cmd.Flags().GetBool("clear")

	resp, err := client.GetEntity(context.Background(), &pb.GetEntityRequest{
		Id: entityID,
	})
	if err != nil {
		return fmt.Errorf("failed to get entity: %w", err)
	}

	entity := resp.Entity

	if clearConfig {
		entity.Config = nil
		_, err := client.Push(context.Background(), &pb.EntityChangeRequest{
			Replacements: []*pb.Entity{entity},
		})
		if err != nil {
			return fmt.Errorf("failed to clear configuration: %w", err)
		}
		fmt.Printf("Configuration for %q cleared\n", entityID)
		return nil
	}

	if entity.Configurable == nil || entity.Configurable.Schema == nil {
		return fmt.Errorf("entity %q has no configurable schema", entityID)
	}

	props, err := parseSchema(entity.Configurable.Schema)
	if err != nil {
		return err
	}

	// Pre-fill from existing config, or from configurable's current value, or defaults
	existingValues := getExistingValues(entity)

	// Track version across retries so each push gets a unique number
	var version uint64
	if entity.Config != nil {
		version = entity.Config.Version
	}

	for {
		result, err := showConfigForm(props, existingValues)
		if err != nil {
			return err
		}

		hasExistingConfig := entity.Config != nil && entity.Config.Value != nil
		if hasExistingConfig && reflect.DeepEqual(result, existingValues) {
			fmt.Println("No changes made")
			return nil
		}

		structVal, err := structpb.NewStruct(result)
		if err != nil {
			return fmt.Errorf("failed to build config value: %w", err)
		}

		version++

		pushResp, err := client.Push(context.Background(), &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: entityID,
				Config: &pb.ConfigurationComponent{
					Value:   structVal,
					Version: version,
				},
			}},
		})
		if err != nil {
			return fmt.Errorf("failed to push configuration: %w", err)
		}
		if !pushResp.Accepted {
			return fmt.Errorf("configuration push was not accepted")
		}

		// Watch until the controller echoes back our version
		state, deviceErr, err := waitForConfigurableState(cmd.Context(), client, entityID, version)
		if err != nil {
			return err
		}

		if state == pb.ConfigurableState_ConfigurableStateActive || state == pb.ConfigurableState_ConfigurableStateScheduled {
			fmt.Printf("Configuration for %q applied successfully\n", entityID)
			return nil
		}

		// Failed — show error and ask to retry
		msg := fmt.Sprintf("Device state: %s", state)
		if deviceErr != "" {
			msg += "\nError: " + deviceErr
		}

		var choice string
		err = runSelect(
			huh.NewSelect[string]().
				Title("Configuration failed").
				Description(msg).
				Options(
					huh.NewOption("Edit", "edit"),
					huh.NewOption("Abort", "abort"),
				).
				Value(&choice),
		)
		if err != nil {
			return err
		}
		if choice != "edit" {
			return fmt.Errorf("device entered state %s: %s", state, deviceErr)
		}

		// Use the values we just submitted as the pre-fill for next attempt
		existingValues = result
	}
}

func waitForConfigurableState(ctx context.Context, client pb.WorldServiceClient, entityID string, version uint64) (pb.ConfigurableState, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	id := entityID
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Id:        &id,
			Component: []uint32{52}, // ConfigurableComponent
		},
	})
	if err != nil {
		return 0, "", fmt.Errorf("failed to watch entity: %w", err)
	}

	var state pb.ConfigurableState
	var cfgErr string

	action := func() {
		for {
			event, err := stream.Recv()
			if err != nil {
				return
			}
			e := event.Entity
			if e == nil || e.Configurable == nil {
				continue
			}
			// Wait until the controller has processed our config version
			if e.Configurable.AppliedVersion < version {
				continue
			}
			// Skip transient states, wait for it to settle
			switch e.Configurable.State {
			case pb.ConfigurableState_ConfigurableStateStarting:
				continue
			}
			state = e.Configurable.State
			cfgErr = ""
			if e.Configurable.Error != nil {
				cfgErr = *e.Configurable.Error
			}
			return
		}
	}

	_ = spinner.New().Title("Waiting for device...").Action(action).Run()

	return state, cfgErr, nil
}

func parseSchema(schemaPB *structpb.Struct) ([]schemaProperty, error) {
	schemaJSON, err := protojson.Marshal(schemaPB)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal schema: %w", err)
	}

	var schema map[string]interface{}
	if err := json.Unmarshal(schemaJSON, &schema); err != nil {
		return nil, fmt.Errorf("failed to parse schema: %w", err)
	}

	properties, ok := schema["properties"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("schema has no properties")
	}

	requiredSet := map[string]bool{}
	if reqList, ok := schema["required"].([]interface{}); ok {
		for _, r := range reqList {
			if s, ok := r.(string); ok {
				requiredSet[s] = true
			}
		}
	}

	var props []schemaProperty
	for name, raw := range properties {
		prop := schemaProperty{Name: name, Order: 999}
		if m, ok := raw.(map[string]interface{}); ok {
			if v, ok := m["title"].(string); ok {
				prop.Title = v
			}
			if v, ok := m["description"].(string); ok {
				prop.Description = v
			}
			if v, ok := m["type"].(string); ok {
				prop.Type = v
			}
			if v, ok := m["default"]; ok {
				prop.Default = v
			}
			if v, ok := m["minimum"].(float64); ok {
				prop.Minimum = &v
			}
			if v, ok := m["maximum"].(float64); ok {
				prop.Maximum = &v
			}
			if v, ok := m["ui:order"].(float64); ok {
				prop.Order = int(v)
			}
			if v, ok := m["ui:placeholder"].(string); ok {
				prop.Placeholder = v
			}
			if v, ok := m["ui:unit"].(string); ok {
				prop.Unit = v
			}
			if v, ok := m["enum"].([]interface{}); ok {
				prop.Enum = v
			}
		}
		prop.Required = requiredSet[name]
		if prop.Title == "" {
			prop.Title = name
		}
		props = append(props, prop)
	}

	sort.Slice(props, func(i, j int) bool {
		return props[i].Order < props[j].Order
	})

	return props, nil
}

func getExistingValues(entity *pb.Entity) map[string]interface{} {
	existing := map[string]interface{}{}
	if entity.Config != nil && entity.Config.Value != nil {
		valJSON, _ := protojson.Marshal(entity.Config.Value)
		_ = json.Unmarshal(valJSON, &existing)
	}
	return existing
}

func showConfigForm(props []schemaProperty, existingValues map[string]interface{}) (map[string]interface{}, error) {
	fieldValues := make(map[string]*string)
	boolValues := make(map[string]*bool)
	var fields []huh.Field

	for i := range props {
		p := &props[i]
		val := ""

		if existing, ok := existingValues[p.Name]; ok {
			val = formatValue(existing)
		} else if p.Default != nil {
			val = formatValue(p.Default)
		}

		fieldValues[p.Name] = &val

		title := p.Title
		if p.Unit != "" {
			title += " (" + p.Unit + ")"
		}
		if p.Required {
			title += " *"
		}

		if len(p.Enum) > 0 {
			var options []huh.Option[string]
			for _, e := range p.Enum {
				s := formatValue(e)
				options = append(options, huh.NewOption(s, s))
			}
			fields = append(fields, huh.NewSelect[string]().
				Title(title).
				Description(p.Description).
				Options(options...).
				Value(fieldValues[p.Name]))
		} else if p.Type == "boolean" {
			boolVal := val == "true" || val == "yes" || val == "1"
			boolValues[p.Name] = &boolVal
			fields = append(fields, huh.NewConfirm().
				Title(title).
				Description(p.Description).
				Value(boolValues[p.Name]))
		} else {
			input := huh.NewInput().
				Title(title).
				Description(p.Description).
				Value(fieldValues[p.Name])

			if p.Placeholder != "" {
				input.Placeholder(p.Placeholder)
			}

			propType := p.Type
			required := p.Required
			minimum := p.Minimum
			maximum := p.Maximum
			input.Validate(func(s string) error {
				s = strings.TrimSpace(s)
				if s == "" {
					if required {
						return fmt.Errorf("required")
					}
					return nil
				}
				if propType == "number" || propType == "integer" {
					f, err := strconv.ParseFloat(s, 64)
					if err != nil {
						return fmt.Errorf("must be a number")
					}
					if minimum != nil && f < *minimum {
						return fmt.Errorf("minimum is %v", *minimum)
					}
					if maximum != nil && f > *maximum {
						return fmt.Errorf("maximum is %v", *maximum)
					}
				}
				return nil
			})

			fields = append(fields, input)
		}
	}

	form := huh.NewForm(huh.NewGroup(fields...)).WithKeyMap(escKeyMap())
	if err := form.Run(); err != nil {
		return nil, err
	}

	result := map[string]interface{}{}
	for _, p := range props {
		if p.Type == "boolean" {
			if bv, ok := boolValues[p.Name]; ok {
				result[p.Name] = *bv
			}
			continue
		}
		val := *fieldValues[p.Name]
		if val == "" {
			continue
		}
		switch p.Type {
		case "number", "integer":
			f, err := strconv.ParseFloat(val, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid number for %s: %q", p.Name, val)
			}
			result[p.Name] = f
		default:
			result[p.Name] = val
		}
	}

	return result, nil
}

func formatValue(v interface{}) string {
	switch v := v.(type) {
	case string:
		return v
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		if v {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", v)
	}
}
