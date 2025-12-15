package engine

import (
	"github.com/projectqai/hydra/cmd"
	"github.com/spf13/cobra"
)

var Port string

var CMD = &cobra.Command{
	Use:   "node",
	RunE:  RunEngine,
	Short: "run a hydra node",
}

func init() {
	CMD.Flags().StringVarP(&Port, "port", "p", cmd.DefaultPort, "port to listen on")
	cmd.CMD.PersistentFlags().StringVarP(&Port, "port", "p", cmd.DefaultPort, "port to listen on")
	cmd.CMD.AddCommand(CMD)
}
