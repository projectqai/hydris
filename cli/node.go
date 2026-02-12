package cli

import (
	"context"
	"fmt"

	"github.com/projectqai/hydris/cmd"
	pb "github.com/projectqai/proto/go"

	"github.com/spf13/cobra"
	"google.golang.org/protobuf/encoding/protojson"
)

func init() {
	nodeCmd := &cobra.Command{
		Use:               "node",
		Aliases:           []string{"n"},
		Short:             "node commands",
		PersistentPreRunE: connect,
	}
	AddConnectionFlags(nodeCmd)

	infoCmd := &cobra.Command{
		Use:   "info",
		Short: "show local node information",
		RunE:  runNodeInfo,
	}

	nodeCmd.AddCommand(infoCmd)
	cmd.CMD.AddCommand(nodeCmd)
}

func runNodeInfo(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)

	resp, err := client.GetLocalNode(context.Background(), &pb.GetLocalNodeRequest{})
	if err != nil {
		return fmt.Errorf("failed to get local node: %w", err)
	}

	if resp.Entity == nil {
		fmt.Println("No local node entity")
		return nil
	}

	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
		Indent:          "  ",
	}

	jsonBytes, err := marshaler.Marshal(resp.Entity)
	if err != nil {
		return fmt.Errorf("failed to marshal node entity: %w", err)
	}

	fmt.Println(string(jsonBytes))
	return nil
}
