package cli

import (
	"context"
	"fmt"
	"slices"
	"strings"

	pb "github.com/projectqai/proto/go"

	"github.com/spf13/cobra"
)

type deviceNode struct {
	entity   *pb.Entity
	children []*deviceNode
}

func runDT(cobraCmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)

	// Fetch all entities that have a DeviceComponent (field 50)
	devResp, err := client.ListEntities(context.Background(), &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to list entities: %w", err)
	}

	if len(devResp.Entities) == 0 {
		fmt.Println("No devices found")
		return nil
	}

	// Index device entities by ID
	byID := make(map[string]*deviceNode, len(devResp.Entities))
	for _, e := range devResp.Entities {
		if e == nil {
			continue
		}
		byID[e.Id] = &deviceNode{entity: e}
	}

	// Build tree: attach children to parents
	var roots []*deviceNode
	for _, node := range byID {
		dev := node.entity.Device
		if dev == nil || dev.Parent == nil || *dev.Parent == "" {
			roots = append(roots, node)
			continue
		}
		parent, ok := byID[*dev.Parent]
		if !ok {
			// Parent not found, treat as root
			roots = append(roots, node)
			continue
		}
		parent.children = append(parent.children, node)
	}

	// Sort roots by ID for consistent output
	slices.SortFunc(roots, func(a, b *deviceNode) int {
		return strings.Compare(a.entity.Id, b.entity.Id)
	})

	// Print tree
	for i, root := range roots {
		printDeviceTree(root, "", i == len(roots)-1)
	}

	return nil
}

func deviceLine(e *pb.Entity) string {
	dev := e.Device
	var parts []string

	// Label
	if e.Label != nil && *e.Label != "" {
		parts = append(parts, *e.Label)
	}

	// State — prefer configurable state (controller-managed), fall back to device state
	if e.Configurable != nil {
		switch e.Configurable.State {
		case pb.ConfigurableState_ConfigurableStateActive:
			parts = append(parts, "[active]")
		case pb.ConfigurableState_ConfigurableStateFailed:
			msg := "[failed]"
			if e.Configurable.Error != nil {
				msg = fmt.Sprintf("[failed: %s]", *e.Configurable.Error)
			}
			parts = append(parts, msg)
		case pb.ConfigurableState_ConfigurableStateStarting:
			parts = append(parts, "[starting]")
		case pb.ConfigurableState_ConfigurableStateScheduled:
			parts = append(parts, "[scheduled]")
		case pb.ConfigurableState_ConfigurableStateInactive:
		}
	} else if dev != nil {
		switch dev.State {
		case pb.DeviceState_DeviceStateActive:
			parts = append(parts, "[active]")
		case pb.DeviceState_DeviceStateFailed:
			msg := "[failed]"
			if dev.Error != nil {
				msg = fmt.Sprintf("[failed: %s]", *dev.Error)
			}
			parts = append(parts, msg)
		}
	}

	// Configuration indicator
	if e.Config != nil {
		parts = append(parts, "[configured]")
	}

	// ID (always shown)
	parts = append(parts, fmt.Sprintf("<%s>", e.Id))

	return strings.Join(parts, " ")
}

func printDeviceTree(node *deviceNode, prefix string, last bool) {
	connector := "├── "
	if last {
		connector = "└── "
	}

	fmt.Println(prefix + connector + deviceLine(node.entity))

	childPrefix := prefix + "│   "
	if last {
		childPrefix = prefix + "    "
	}

	for i, child := range node.children {
		printDeviceTree(child, childPrefix, i == len(node.children)-1)
	}
}
