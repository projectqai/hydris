package cli

import (
	"fmt"

	"github.com/projectqai/hydris/pkg/version"
	"github.com/spf13/cobra"
)

func init() {
	CMD.AddCommand(&cobra.Command{
		Use:   "version",
		Short: "Print version information",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println(version.Version)
		},
	})
}
