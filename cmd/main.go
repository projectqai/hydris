package cmd

import (
	"github.com/joho/godotenv"
	"github.com/spf13/cobra"
)

var CMD = &cobra.Command{
	Use:   "hydris",
	Short: "world state machine",
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		_ = godotenv.Load()
		return nil
	},
}
