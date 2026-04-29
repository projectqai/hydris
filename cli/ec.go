package cli

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/x/term"
	"github.com/mattn/go-runewidth"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"

	"github.com/rodaine/table"
	"github.com/spf13/cobra"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

var (
	filterWith             []int
	filterWithout          []int
	filterController       string
	filterTracker          string
	filterTaskableContext  string
	filterTaskableAssignee string
	filterBBox             string
	outputFormat           string

	debugMaxRateHz   float64
	debugMinPriority string
	debugKeepaliveMs uint32
	watchFilterID    string
)

func init() {
	ECCMD := &cobra.Command{
		Use:               "ec",
		Aliases:           []string{"entities", "e"},
		Short:             "entity/components client",
		PersistentPreRunE: connect,
	}
	AddConnectionFlags(ECCMD)

	lsCmd := &cobra.Command{
		Use:     "ls",
		Aliases: []string{"list"},
		Short:   "list all entities",
		RunE:    runLS,
	}
	lsCmd.Flags().IntSliceVar(&filterWith, "with", nil, "filter entities with these component field numbers (e.g., 2=label, 11=geo, 23=taskable)")
	lsCmd.Flags().IntSliceVar(&filterWithout, "without", nil, "filter entities without these component field numbers")
	lsCmd.Flags().StringVar(&filterController, "controller", "", "filter by controller ID")
	lsCmd.Flags().StringVar(&filterTracker, "tracker", "", "filter by track.tracker ID")
	lsCmd.Flags().StringVar(&filterTaskableContext, "taskable-context", "", "filter by taskable context entity ID")
	lsCmd.Flags().StringVar(&filterTaskableAssignee, "taskable-assignee", "", "filter by taskable assignee entity ID")
	lsCmd.Flags().StringVar(&filterBBox, "bbox", "", "filter by bounding box: lon1,lat1,lon2,lat2")
	lsCmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")

	watchCmd := &cobra.Command{
		Use:     "watch",
		Aliases: []string{"debug", "w"},
		Short:   "subscribe to change events and print as JSON",
		RunE:    runWatch,
	}
	watchCmd.Flags().Float64Var(&debugMaxRateHz, "max-rate-hz", 0, "max message rate in hz (0 = unlimited)")
	watchCmd.Flags().StringVar(&debugMinPriority, "min-priority", "", "minimum priority level: routine, immediate, flash")
	watchCmd.Flags().Uint32Var(&debugKeepaliveMs, "keepalive-ms", 0, "keepalive interval in ms (0 = only actual changes)")
	watchCmd.Flags().StringVar(&watchFilterID, "id", "", "filter by entity ID (exact match)")

	getCmd := &cobra.Command{
		Use:   "get [entity-id]",
		Short: "get an entity by ID and print as JSON",
		Args:  cobra.ExactArgs(1),
		RunE:  runGet,
	}

	putCmd := &cobra.Command{
		Use:     "put [file or -]",
		Aliases: []string{"apply"},
		Short:   "push one or more entities from JSON or YAML file or stdin",
		Long:    "push one or more entities from JSON or YAML file or stdin. Use '-' to read from stdin. Format is auto-detected. YAML files can contain multiple entities separated by '---'.",
		Args:    cobra.ExactArgs(1),
		RunE:    runPut,
	}

	editCmd := &cobra.Command{
		Use:   "edit [entity-id]",
		Short: "edit an entity in your default editor",
		Long:  "edit an entity in your default editor.",
		Args:  cobra.ExactArgs(1),
		RunE:  runEdit,
	}

	rmCmd := &cobra.Command{
		Use:     "rm [entity-id]",
		Aliases: []string{"remove", "delete"},
		Short:   "remove an entity by setting its lifetime.until to now",
		Args:    cobra.ExactArgs(1),
		RunE:    runRM,
	}

	confCmd := &cobra.Command{
		Use:     "conf [entity-id]",
		Aliases: []string{"configure", "config"},
		Short:   "interactive device tree configuration",
		Args:    cobra.MaximumNArgs(1),
		RunE:    runConfigure,
	}
	confCmd.Flags().Bool("clear", false, "remove the configuration from the entity")

	clearCmd := &cobra.Command{
		Use:   "clear",
		Short: "remove all entities by listing and deleting them one by one",
		RunE:  runClear,
	}

	dtCmd := &cobra.Command{
		Use:     "dt",
		Aliases: []string{"devicetree"},
		Short:   "display the device tree",
		RunE:    runDT,
	}
	dtCmd.Flags().StringSlice("ble-service", nil, "filter BLE devices by service UUID")

	ECCMD.AddCommand(lsCmd)
	ECCMD.AddCommand(watchCmd)
	ECCMD.AddCommand(getCmd)
	ECCMD.AddCommand(putCmd)
	ECCMD.AddCommand(editCmd)
	ECCMD.AddCommand(rmCmd)
	ECCMD.AddCommand(confCmd)
	var resetMissionID string
	resetCmd := &cobra.Command{
		Use:   "reset",
		Short: "hard reset: atomically clear all entities, persistence, and HTTP connections",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runReset(cmd, args, resetMissionID)
		},
	}
	resetCmd.Flags().StringVar(&resetMissionID, "mission", "", "artifact entity ID to keep as the active mission")

	ECCMD.AddCommand(clearCmd)
	ECCMD.AddCommand(dtCmd)
	ECCMD.AddCommand(resetCmd)

	CMD.AddCommand(ECCMD)
}

func intSliceToUint32(ints []int) []uint32 {
	result := make([]uint32, len(ints))
	for i, v := range ints {
		result[i] = uint32(v)
	}
	return result
}

// protoToYAML converts a protobuf message to YAML (for editing)
// Preserves field order from protobuf definition using reflection
func protoToYAML(entity *pb.Entity) ([]byte, error) {
	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
		Indent:          "  ",
	}

	jsonBytes, err := marshaler.Marshal(entity)
	if err != nil {
		return nil, err
	}

	// Unmarshal to map to get the data
	var jsonMap map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &jsonMap); err != nil {
		return nil, err
	}

	// Get field order from protobuf descriptor
	msgDesc := entity.ProtoReflect().Descriptor()
	fields := msgDesc.Fields()

	// Create list of fields sorted by field number
	type fieldInfo struct {
		name   string
		number int
	}
	var fieldList []fieldInfo

	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		fieldList = append(fieldList, fieldInfo{
			name:   string(fd.Name()),
			number: int(fd.Number()),
		})
	}

	// Sort by field number
	sort.Slice(fieldList, func(i, j int) bool {
		return fieldList[i].number < fieldList[j].number
	})

	// Build YAML node manually to preserve order
	var rootNode yaml.Node
	rootNode.Kind = yaml.MappingNode

	// Add fields in proto definition order
	for _, field := range fieldList {
		if val, ok := jsonMap[field.name]; ok {
			// Add key node
			keyNode := yaml.Node{
				Kind:  yaml.ScalarNode,
				Value: field.name,
			}
			rootNode.Content = append(rootNode.Content, &keyNode)

			// Add value node
			var valNode yaml.Node
			_ = valNode.Encode(val)
			rootNode.Content = append(rootNode.Content, &valNode)
		}
	}

	return yaml.Marshal(&rootNode)
}

// yamlToProto converts YAML to a protobuf message (from editing)
func yamlToProto(yamlBytes []byte, entity *pb.Entity) error {
	var data map[string]interface{}
	if err := yaml.Unmarshal(yamlBytes, &data); err != nil {
		return err
	}

	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return err
	}

	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	return unmarshaler.Unmarshal(jsonBytes, entity)
}

// yamlToProtoMulti converts multiple YAML documents to protobuf messages
// Supports multiple documents separated by ---
// Returns all successfully parsed entities and per-document errors
func yamlToProtoMulti(yamlBytes []byte) ([]*pb.Entity, []error) {
	decoder := yaml.NewDecoder(bytes.NewReader(yamlBytes))
	var entities []*pb.Entity
	var errs []error
	docIndex := 0

	consecutiveErrors := 0
	for {
		var data map[string]interface{}
		err := decoder.Decode(&data)
		if err == io.EOF {
			break
		}
		docIndex++
		if err != nil {
			errs = append(errs, fmt.Errorf("document %d: failed to decode YAML: %w", docIndex, err))
			consecutiveErrors++
			if consecutiveErrors > 10 {
				break
			}
			continue
		}
		consecutiveErrors = 0

		// Skip empty documents
		if len(data) == 0 {
			continue
		}

		// Extract ID for error context
		id, _ := data["id"].(string)
		if id == "" {
			id = fmt.Sprintf("document %d", docIndex)
		}

		// Convert to JSON then to protobuf
		jsonBytes, err := json.Marshal(data)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: failed to marshal to JSON: %w", id, err))
			continue
		}

		entity := &pb.Entity{}
		unmarshaler := protojson.UnmarshalOptions{
			DiscardUnknown: false,
		}

		if err := unmarshaler.Unmarshal(jsonBytes, entity); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", id, err))
			continue
		}

		entities = append(entities, entity)
	}

	return entities, errs
}

func getLocalNodeID(client pb.WorldServiceClient) string {
	resp, err := client.GetLocalNode(context.Background(), &pb.GetLocalNodeRequest{})
	if err != nil || resp.Entity == nil || resp.Entity.Controller == nil || resp.Entity.Controller.Node == nil {
		return ""
	}
	return *resp.Entity.Controller.Node
}

func runLS(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)

	localNodeID := getLocalNodeID(client)

	// Build the request with filters
	filter := &pb.EntityFilter{}

	if len(filterWith) > 0 {
		filter.Component = intSliceToUint32(filterWith)
	}
	if len(filterWithout) > 0 {
		filter.Not = &pb.EntityFilter{
			Component: intSliceToUint32(filterWithout),
		}
	}

	// Controller ID filter
	if filterController != "" {
		filter.Controller = &pb.ControllerFilter{
			Id: &filterController,
		}
	}

	// Track tracker filter
	if filterTracker != "" {
		filter.Track = &pb.TrackFilter{
			Tracker: &filterTracker,
		}
	}

	// Taskable context or assignee
	if filterTaskableContext != "" || filterTaskableAssignee != "" {
		filter.Taskable = &pb.TaskableFilter{}
		if filterTaskableContext != "" {
			filter.Taskable.Context = &pb.TaskableContext{
				EntityId: &filterTaskableContext,
			}
		}
		if filterTaskableAssignee != "" {
			filter.Taskable.Assignee = &pb.TaskableAssignee{
				EntityId: &filterTaskableAssignee,
			}
		}
	}

	// Bounding box geometry
	if filterBBox != "" {
		var lon1, lat1, lon2, lat2 float64
		_, err := fmt.Sscanf(filterBBox, "%f,%f,%f,%f", &lon1, &lat1, &lon2, &lat2)
		if err != nil {
			return fmt.Errorf("invalid bbox format, expected 'lon1,lat1,lon2,lat2': %w", err)
		}

		// Create a planar polygon from the bounding box
		filter.Geo = &pb.GeoFilter{
			Geo: &pb.GeoFilter_Geometry{
				Geometry: &pb.Geometry{
					Planar: &pb.PlanarGeometry{
						Plane: &pb.PlanarGeometry_Polygon{
							Polygon: &pb.PlanarPolygon{
								Outer: &pb.PlanarRing{
									Points: []*pb.PlanarPoint{
										{Longitude: lon1, Latitude: lat1},
										{Longitude: lon2, Latitude: lat1},
										{Longitude: lon2, Latitude: lat2},
										{Longitude: lon1, Latitude: lat2},
										{Longitude: lon1, Latitude: lat1},
									},
								},
							},
						},
					},
				},
			},
		}
	}

	req := &pb.ListEntitiesRequest{Filter: filter}

	resp, err := client.ListEntities(context.Background(), req)
	if err != nil {
		return fmt.Errorf("failed to list entities: %w", err)
	}

	// Output based on format
	switch outputFormat {
	case "yaml":
		return printEntitiesYAML(resp.Entities)
	case "json":
		return printEntitiesJSON(resp.Entities)
	case "table":
		printEntitiesTable(resp.Entities, localNodeID)
		return nil
	default:
		return fmt.Errorf("unknown output format: %s (use: table, yaml, json)", outputFormat)
	}
}

func humanDuration(d time.Duration) string {
	if d < 0 {
		d = -d
	}
	switch {
	case d < time.Second:
		return "<1s"
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		m := int(d.Minutes())
		s := int(d.Seconds()) - m*60
		if s == 0 {
			return fmt.Sprintf("%dm", m)
		}
		return fmt.Sprintf("%dm%ds", m, s)
	case d < 24*time.Hour:
		h := int(d.Hours())
		m := int(d.Minutes()) - h*60
		if m == 0 {
			return fmt.Sprintf("%dh", h)
		}
		return fmt.Sprintf("%dh%dm", h, m)
	case d < 365*24*time.Hour:
		days := int(math.Round(d.Hours() / 24))
		return fmt.Sprintf("%dd", days)
	default:
		return ">1y"
	}
}

func termWidth() int {
	for _, f := range []*os.File{os.Stdout, os.Stderr, os.Stdin} {
		if w, _, err := term.GetSize(f.Fd()); err == nil && w > 0 {
			return w
		}
	}
	return 0
}

func printEntitiesTable(entities []*pb.Entity, localNodeID string) {
	if len(entities) == 0 {
		fmt.Println("No entities found")
		return
	}

	now := time.Now()

	// All columns in display order; rightmost are dropped first.
	headers := []string{"CH", "ID", "Label", "State", "Seen", "Expire", "Latitude", "Longitude"}
	var rows [][]string

	for _, entity := range entities {
		if entity == nil {
			continue
		}
		lat := ""
		lon := ""
		if entity.Geo != nil {
			lat = fmt.Sprintf("%.6f", entity.Geo.Latitude)
			lon = fmt.Sprintf("%.6f", entity.Geo.Longitude)
		}
		state := ""
		if entity.Configurable != nil {
			switch entity.Configurable.State {
			case pb.ConfigurableState_ConfigurableStateActive:
				state = "active"
			case pb.ConfigurableState_ConfigurableStateFailed:
				state = "failed"
				if entity.Configurable.Error != nil {
					state = fmt.Sprintf("failed: %s", *entity.Configurable.Error)
				}
			case pb.ConfigurableState_ConfigurableStateInactive:
				state = "inactive"
			case pb.ConfigurableState_ConfigurableStateStarting:
				state = "starting"
			case pb.ConfigurableState_ConfigurableStateScheduled:
				state = "scheduled"
			case pb.ConfigurableState_ConfigurableStateConflict:
				state = "conflict"
			}
		} else if entity.Device != nil {
			switch entity.Device.State {
			case pb.DeviceState_DeviceStateActive:
				state = "active"
			case pb.DeviceState_DeviceStateFailed:
				state = "failed"
				if entity.Device.Error != nil {
					state = fmt.Sprintf("failed: %s", *entity.Device.Error)
				}
			}
		}
		if runewidth.StringWidth(state) > 24 {
			state = runewidth.Truncate(state, 23, "…")
		}
		label := ""
		if entity.Label != nil {
			label = *entity.Label
			if runewidth.StringWidth(label) > 16 {
				label = runewidth.Truncate(label, 15, "…")
			}
		}

		fresh := ""
		until := ""
		if entity.Lifetime != nil {
			if entity.Lifetime.Fresh != nil {
				t := entity.Lifetime.Fresh.AsTime()
				d := now.Sub(t)
				fresh = humanDuration(d) + " ago"
			}
			if entity.Lifetime.Until != nil {
				t := entity.Lifetime.Until.AsTime()
				d := t.Sub(now)
				if d > 0 {
					until = "in " + humanDuration(d)
				} else {
					until = humanDuration(-d) + " ago"
				}
			}
		}

		prefix := "▪ "
		ch := ""
		if entity.Routing != nil && len(entity.Routing.Channels) > 0 {
			ch = fmt.Sprintf("%d", len(entity.Routing.Channels))
			isRemote := localNodeID != "" && entity.Controller != nil && entity.Controller.Node != nil && *entity.Controller.Node != localNodeID
			if isRemote {
				prefix = "⇣ "
			} else {
				prefix = "⇡ "
			}
		}
		ch = prefix + ch

		rows = append(rows, []string{ch, entity.Id, label, state, fresh, until, lat, lon})
	}

	// Calculate how many columns fit in the terminal.
	// Drop columns from the right until the table fits.
	width := termWidth()
	padding := 2
	numCols := len(headers)

	// Precompute max display width per column.
	colWidths := make([]int, len(headers))
	for col := 0; col < len(headers); col++ {
		colWidths[col] = runewidth.StringWidth(headers[col])
		for _, row := range rows {
			if rw := runewidth.StringWidth(row[col]); rw > colWidths[col] {
				colWidths[col] = rw
			}
		}
	}

	if width > 0 {
		for numCols > 1 {
			total := 0
			for col := 0; col < numCols; col++ {
				total += colWidths[col] + padding
			}
			if total <= width {
				break
			}
			numCols--
		}
	}

	ifaces := make([]interface{}, numCols)
	for i := 0; i < numCols; i++ {
		ifaces[i] = headers[i]
	}
	tbl := table.New(ifaces...)

	for _, row := range rows {
		vals := make([]interface{}, numCols)
		for i := 0; i < numCols; i++ {
			vals[i] = row[i]
		}
		tbl.AddRow(vals...)
	}

	tbl.Print()
}

func printEntitiesYAML(entities []*pb.Entity) error {
	for i, entity := range entities {
		yamlBytes, err := protoToYAML(entity)
		if err != nil {
			return fmt.Errorf("failed to marshal entity %s: %w", entity.Id, err)
		}
		if i > 0 {
			fmt.Println("---")
		}
		fmt.Print(string(yamlBytes))
	}
	return nil
}

func printEntitiesJSON(entities []*pb.Entity) error {
	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
		Indent:          "  ",
	}

	// Output as JSON array
	fmt.Println("[")
	for i, entity := range entities {
		jsonBytes, err := marshaler.Marshal(entity)
		if err != nil {
			return fmt.Errorf("failed to marshal entity %s: %w", entity.Id, err)
		}
		fmt.Print("  ", string(jsonBytes))
		if i < len(entities)-1 {
			fmt.Println(",")
		} else {
			fmt.Println()
		}
	}
	fmt.Println("]")
	return nil
}

func runWatch(cmd *cobra.Command, args []string) error {
	world := pb.NewWorldServiceClient(conn)

	req := &pb.ListEntitiesRequest{}

	if watchFilterID != "" {
		req.Filter = &pb.EntityFilter{
			Id: &watchFilterID,
		}
	}

	// Build WatchBehavior if any flags are set
	if debugMaxRateHz != 0 || debugMinPriority != "" || debugKeepaliveMs != 0 {
		req.Behaviour = &pb.WatchBehavior{}
		if debugMaxRateHz != 0 {
			hz := float32(debugMaxRateHz)
			req.Behaviour.MaxRateHz = &hz
		}
		if debugMinPriority != "" {
			var p pb.Priority
			switch strings.ToLower(debugMinPriority) {
			case "routine":
				p = pb.Priority_PriorityRoutine
			case "immediate":
				p = pb.Priority_PriorityImmediate
			case "flash":
				p = pb.Priority_PriorityFlash
			default:
				return fmt.Errorf("unknown priority %q, use: routine, immediate, flash", debugMinPriority)
			}
			req.Behaviour.MinPriority = &p
		}
		if debugKeepaliveMs != 0 {
			req.Behaviour.KeepaliveIntervalMs = &debugKeepaliveMs
		}
	}

	// Subscribe to all change events (no geometry filter)
	stream, err := goclient.WatchEntitiesWithRetry(cmd.Context(), world, req)
	if err != nil {
		return fmt.Errorf("failed to watch entities: %w", err)
	}

	// Configure JSON marshaler
	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
		Indent:          "  ",
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("stream error: %w", err)
		}

		// Marshal the entire EntityChangeEvent to JSON
		jsonBytes, err := marshaler.Marshal(event)
		if err != nil {
			return fmt.Errorf("failed to marshal event: %w", err)
		}

		fmt.Println(string(jsonBytes))
	}
}

func runGet(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	entityID := args[0]

	resp, err := client.GetEntity(context.Background(), &pb.GetEntityRequest{
		Id: entityID,
	})
	if err != nil {
		return fmt.Errorf("failed to get entity: %w", err)
	}

	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
		Indent:          "  ",
	}

	jsonBytes, err := marshaler.Marshal(resp.Entity)
	if err != nil {
		return fmt.Errorf("failed to marshal entity: %w", err)
	}

	fmt.Println(string(jsonBytes))
	return nil
}

func runPut(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	path := args[0]

	// Read from file or stdin
	var inputBytes []byte
	var err error

	if path == "-" {
		inputBytes, err = io.ReadAll(os.Stdin)
		if err != nil {
			return fmt.Errorf("failed to read from stdin: %w", err)
		}
	} else {
		inputBytes, err = os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read file: %w", err)
		}
	}

	var entities []*pb.Entity

	// Try JSON first (single entity)
	entity := &pb.Entity{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	err = unmarshaler.Unmarshal(inputBytes, entity)
	if err != nil {
		// JSON failed, try YAML (supports single and multiple documents)
		var parseErrs []error
		entities, parseErrs = yamlToProtoMulti(inputBytes)
		if len(parseErrs) > 0 {
			for _, e := range parseErrs {
				fmt.Fprintf(os.Stderr, "Error: %v\n", e)
			}
		}
		if len(entities) == 0 {
			if len(parseErrs) == 0 {
				return fmt.Errorf("no entities found in input")
			}
			return fmt.Errorf("all entities failed to parse")
		}
	} else {
		// JSON succeeded
		entities = []*pb.Entity{entity}
	}

	// Push entities
	resp, err := client.Push(context.Background(), &pb.EntityChangeRequest{
		Changes: entities,
	})
	if err != nil {
		return fmt.Errorf("failed to push entities: %w", err)
	}

	if resp.Accepted {
		if len(entities) == 1 {
			fmt.Printf("Entity '%s' pushed successfully\n", entities[0].Id)
		} else {
			fmt.Printf("%d entities pushed successfully\n", len(entities))
		}
	} else {
		fmt.Println("Entity push was not accepted")
	}

	return nil
}

func runEdit(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	entityID := args[0]

	// Get the entity
	resp, err := client.GetEntity(context.Background(), &pb.GetEntityRequest{
		Id: entityID,
	})
	if err != nil {
		return fmt.Errorf("failed to get entity: %w", err)
	}

	// Marshal to YAML
	yamlBytes, err := protoToYAML(resp.Entity)
	if err != nil {
		return fmt.Errorf("failed to marshal entity: %w", err)
	}

	// Create temp file
	tmpFile, err := os.CreateTemp("", fmt.Sprintf("hydris-entity-%s-*.yaml", entityID))
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	// Write YAML to temp file
	if _, err := tmpFile.Write(yamlBytes); err != nil {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to write temp file: %w", err)
	}
	_ = tmpFile.Close()

	// Calculate original hash
	originalHash := sha256.Sum256(yamlBytes)

	// Get editor
	editor := os.Getenv("EDITOR")
	if editor == "" {
		editor = "vim"
	}

	// Open editor
	editorCmd := exec.Command(editor, tmpPath)
	editorCmd.Stdin = os.Stdin
	editorCmd.Stdout = os.Stdout
	editorCmd.Stderr = os.Stderr

	if err := editorCmd.Run(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("editor exited with error: %w", err)
	}

	// Read edited file
	editedBytes, err := os.ReadFile(tmpPath)
	if err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to read edited file: %w", err)
	}

	// Check if file changed
	editedHash := sha256.Sum256(editedBytes)
	if bytes.Equal(originalHash[:], editedHash[:]) {
		_ = os.Remove(tmpPath)
		fmt.Println("No changes detected, entity not updated")
		return nil
	}

	// Unmarshal edited YAML
	editedEntity := &pb.Entity{}
	if err := yamlToProto(editedBytes, editedEntity); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		fmt.Fprintf(os.Stderr, "Edited file saved at: %s\n", tmpPath)
		fmt.Fprintf(os.Stderr, "Fix the errors and run: hydris ec put %s\n", tmpPath)
		return fmt.Errorf("failed to unmarshal edited entity YAML: %w", err)
	}

	// Replace entity entirely so removed components are actually deleted
	pushResp, err := client.Push(context.Background(), &pb.EntityChangeRequest{
		Replacements: []*pb.Entity{editedEntity},
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		fmt.Fprintf(os.Stderr, "Edited file saved at: %s\n", tmpPath)
		fmt.Fprintf(os.Stderr, "Fix the errors and run: hydris ec put %s\n", tmpPath)
		return fmt.Errorf("failed to push entity: %w", err)
	}

	if pushResp.Accepted {
		_ = os.Remove(tmpPath)
		fmt.Printf("Entity '%s' updated successfully\n", editedEntity.Id)
	} else {
		_ = os.Remove(tmpPath)
		fmt.Println("Entity update was not accepted")
	}

	return nil
}

func runRM(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	entityID := args[0]

	_, err := client.ExpireEntity(context.Background(), &pb.ExpireEntityRequest{
		Id: entityID,
	})
	if err != nil {
		return fmt.Errorf("failed to expire entity: %w", err)
	}

	fmt.Printf("Entity '%s' removed successfully\n", entityID)
	return nil
}

func runClear(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)

	// List all entities
	resp, err := client.ListEntities(context.Background(), &pb.ListEntitiesRequest{})
	if err != nil {
		return fmt.Errorf("failed to list entities: %w", err)
	}

	if len(resp.Entities) == 0 {
		fmt.Println("No entities to clear")
		return nil
	}

	fmt.Printf("Clearing %d entities...\n", len(resp.Entities))

	for _, entity := range resp.Entities {
		if entity == nil {
			continue
		}

		_, err := client.ExpireEntity(context.Background(), &pb.ExpireEntityRequest{
			Id: entity.Id,
		})
		if err != nil {
			fmt.Printf("Failed to remove entity '%s': %v\n", entity.Id, err)
			continue
		}

		fmt.Printf("Removed entity '%s'\n", entity.Id)
	}

	fmt.Println("Clear complete")
	return nil
}

func runReset(cmd *cobra.Command, args []string, missionID string) error {
	client := pb.NewWorldServiceClient(conn)
	req := &pb.HardResetRequest{}
	if missionID != "" {
		req.MissionId = &missionID
	}
	_, err := client.HardReset(context.Background(), req)
	if err != nil {
		return fmt.Errorf("hard reset failed: %w", err)
	}
	if missionID != "" {
		fmt.Printf("Hard reset complete (mission: %s)\n", missionID)
	} else {
		fmt.Println("Hard reset complete")
	}
	return nil
}
