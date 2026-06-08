package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/pkg/missionpkg"
	"github.com/spf13/cobra"
)

func init() {
	var out, server string

	exportCmd := &cobra.Command{
		Use:   "export",
		Short: "fetch a diagnostic bundle from a running hydris",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runDiagnosticExport(server, out)
		},
	}
	exportCmd.Flags().StringVarP(&out, "out", "o", "", "output path (default: server-supplied filename in cwd)")
	exportCmd.Flags().StringVar(&server, "server", "http://localhost:50051", "hydris server URL")

	inspectCmd := &cobra.Command{
		Use:   "inspect <file>",
		Short: "summarize a mission or diagnostic pack offline (no engine connection)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runDiagnosticInspect(cmd.Context(), cmd.OutOrStdout(), args[0])
		},
	}

	diagnosticCmd := &cobra.Command{Use: "diagnostic", Short: "diagnostics"}
	diagnosticCmd.AddCommand(exportCmd, inspectCmd)
	CMD.AddCommand(diagnosticCmd)
}

var cdFilenameRe = regexp.MustCompile(`filename="([^"]+)"`)

func runDiagnosticExport(server, out string) error {
	url := strings.TrimRight(server, "/") + "/diagnostic/export"
	resp, err := http.Post(url, "", nil)
	if err != nil {
		return fmt.Errorf("fetch %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}

	if out == "" {
		if m := cdFilenameRe.FindStringSubmatch(resp.Header.Get("Content-Disposition")); len(m) == 2 {
			out = m[1]
		} else {
			out = "diagnostic.zip"
		}
	}

	f, err := os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("%s already exists; refusing to overwrite", out)
		}
		return fmt.Errorf("create %s: %w", out, err)
	}
	defer f.Close()
	if _, err := io.Copy(f, resp.Body); err != nil {
		return fmt.Errorf("write %s: %w", out, err)
	}

	fmt.Fprintln(os.Stderr, "wrote", out)
	return nil
}

func runDiagnosticInspect(ctx context.Context, w io.Writer, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return fmt.Errorf("stat %s: %w", path, err)
	}

	unpacked, err := missionpkg.Unpack(ctx, f, stat.Size())
	if err != nil {
		return fmt.Errorf("unpack: %w", err)
	}
	var artifactBytes int64
	for _, a := range unpacked.Artifacts {
		artifactBytes += int64(len(a.Data))
	}

	fmt.Fprintf(w, "file:      %s\n", path)
	if d := unpacked.Index.Diagnostic; d != nil {
		fmt.Fprintf(w, "node:      %s\n", d.NodeID)
		fmt.Fprintf(w, "version:   %s\n", d.Version)
		fmt.Fprintf(w, "time:      %s\n", d.Timestamp)
		fmt.Fprintf(w, "host:      %s (%s/%s)\n", d.Hostname, d.OS, d.Arch)
		fmt.Fprintf(w, "uptime:    %s\n", d.Uptime)
	} else {
		fmt.Fprintln(w, "diagnostic: (not present)")
	}

	if unpacked.World != nil {
		entities, parseErr := engine.ParseEntities(unpacked.World)
		if parseErr != nil {
			fmt.Fprintf(w, "entities:  unparseable (%v)\n", parseErr)
		} else {
			fmt.Fprintf(w, "entities:  %d\n", len(entities))
		}
	}

	if unpacked.Index.MissionKit != nil {
		fmt.Fprintf(w, "layouts:   %d\n", len(unpacked.Index.MissionKit.Layouts))
	}

	if unpacked.Index.ViewState != nil {
		var compact bytes.Buffer
		if err := json.Compact(&compact, unpacked.Index.ViewState); err == nil {
			fmt.Fprintf(w, "view:      %d bytes\n", compact.Len())
		} else {
			fmt.Fprintf(w, "view:      (present)\n")
		}
	}

	if m := unpacked.Index.Manifest; m != nil {
		fmt.Fprintf(w, "manifest:  %d entities, %d layouts (hydris %s)\n",
			m.EntityCount, len(m.LayoutNames), m.HydrisVersion)
	}

	if len(unpacked.Artifacts) > 0 {
		fmt.Fprintf(w, "artifacts: %d (%s)\n", len(unpacked.Artifacts), formatBytes(artifactBytes))
	}

	if len(unpacked.Logs) > 0 {
		fmt.Fprintf(w, "logs:      %s\n", formatBytes(int64(len(unpacked.Logs))))
	}

	return nil
}
