package cli

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/projectqai/hydris/pkg/version"
	pb "github.com/projectqai/proto/go"

	"github.com/spf13/cobra"
	"google.golang.org/protobuf/encoding/protojson"
)

var infoOutput string

func init() {
	infoCmd := &cobra.Command{
		Use:               "info",
		Short:             "show local and remote version and identity",
		PersistentPreRunE: connect,
		RunE:              runInfo,
	}
	AddConnectionFlags(infoCmd)
	infoCmd.Flags().StringVarP(&infoOutput, "output", "o", "human", "output format: human or json")
	CMD.AddCommand(infoCmd)
}

func runInfo(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	ctx := context.Background()

	self, err := client.GetSelf(ctx, &pb.GetSelfRequest{})
	if err != nil {
		return fmt.Errorf("failed to get self: %w", err)
	}

	node, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return fmt.Errorf("failed to get local node: %w", err)
	}

	var remoteVersion string
	if node.Entity != nil && node.Entity.Device != nil && node.Entity.Device.Node != nil {
		remoteVersion = node.Entity.GetDevice().GetNode().GetHydrisVersion()
	}

	switch infoOutput {
	case "json":
		return printInfoJSON(self, remoteVersion)
	case "human", "":
		printInfoHuman(self, remoteVersion)
		return nil
	default:
		return fmt.Errorf("unknown output format %q (want human or json)", infoOutput)
	}
}

func printInfoHuman(self *pb.GetSelfResponse, remoteVersion string) {
	if remoteVersion == "" {
		remoteVersion = "unknown"
	}
	fmt.Printf("local version:  %s\n", version.Version)
	fmt.Printf("remote version: %s\n", remoteVersion)
	fmt.Printf("identity:       %s\n", self.EntityId)
	if self.Entity != nil && self.Entity.Label != nil {
		fmt.Printf("label:          %s\n", *self.Entity.Label)
	}
}

func printInfoJSON(self *pb.GetSelfResponse, remoteVersion string) error {
	out := struct {
		LocalVersion  string          `json:"local_version"`
		RemoteVersion string          `json:"remote_version"`
		Identity      json.RawMessage `json:"identity,omitempty"`
	}{
		LocalVersion:  version.Version,
		RemoteVersion: remoteVersion,
	}

	if self.Entity != nil {
		marshaler := protojson.MarshalOptions{UseProtoNames: true}
		entityJSON, err := marshaler.Marshal(self.Entity)
		if err != nil {
			return fmt.Errorf("failed to marshal identity entity: %w", err)
		}
		out.Identity = entityJSON
	}

	jsonBytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal info: %w", err)
	}
	fmt.Println(string(jsonBytes))
	return nil
}
