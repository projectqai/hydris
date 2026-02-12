package cli

import (
	"context"
	"fmt"
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
	resp, err := client.ListEntities(context.Background(), &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to list entities: %w", err)
	}

	if len(resp.Entities) == 0 {
		fmt.Println("No devices found")
		return nil
	}

	// Index entities by ID
	byID := make(map[string]*deviceNode, len(resp.Entities))
	for _, e := range resp.Entities {
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
	} else {
		parts = append(parts, e.Id)
	}

	// State
	if dev != nil {
		switch dev.State {
		case pb.DeviceState_DeviceStateActive:
			parts = append(parts, "[active]")
		case pb.DeviceState_DeviceStateFailed:
			msg := "[failed]"
			if dev.Error != nil {
				msg = fmt.Sprintf("[failed: %s]", *dev.Error)
			}
			parts = append(parts, msg)
		case pb.DeviceState_DeviceStatePending:
			parts = append(parts, "[pending]")
		}
	}

	// Subsystem info
	if dev != nil {
		if dev.Node != nil {
			info := ""
			if dev.Node.Hostname != nil {
				info = *dev.Node.Hostname
			}
			if dev.Node.Os != nil {
				info += "/" + *dev.Node.Os
			}
			if dev.Node.Arch != nil {
				info += "/" + *dev.Node.Arch
			}
			if info != "" {
				parts = append(parts, fmt.Sprintf("(node: %s)", info))
			}
		}
		if dev.Usb != nil {
			info := ""
			if dev.Usb.ProductName != nil {
				info = *dev.Usb.ProductName
			}
			if dev.Usb.VendorId != nil && dev.Usb.ProductId != nil {
				info += fmt.Sprintf(" %04x:%04x", *dev.Usb.VendorId, *dev.Usb.ProductId)
			}
			if info != "" {
				parts = append(parts, fmt.Sprintf("(usb: %s)", strings.TrimSpace(info)))
			}
		}
		if dev.Serial != nil && dev.Serial.Path != nil {
			parts = append(parts, fmt.Sprintf("(serial: %s)", *dev.Serial.Path))
		}
		if dev.Ip != nil && dev.Ip.Host != nil {
			info := *dev.Ip.Host
			if dev.Ip.Port != nil {
				info += fmt.Sprintf(":%d", *dev.Ip.Port)
			}
			parts = append(parts, fmt.Sprintf("(ip: %s)", info))
		}
	}

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
