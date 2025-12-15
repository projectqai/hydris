package cmd

import (
	"github.com/joho/godotenv"
	"github.com/spf13/cobra"
)

const DefaultPort = "50051"

var CMD = &cobra.Command{
	Use:   "hydra",
	Short: "world state machine",
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		godotenv.Load()
		return nil
	},
}
