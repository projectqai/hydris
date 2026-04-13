package cli

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	pb "github.com/projectqai/proto/go"
	"github.com/spf13/cobra"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const artifactChunkSize = 64 * 1024

func init() {
	artifactCmd := &cobra.Command{
		Use:               "artifact",
		Aliases:           []string{"art"},
		Short:             "manage artifacts",
		PersistentPreRunE: connect,
	}
	AddConnectionFlags(artifactCmd)

	// --- list ---
	listCmd := &cobra.Command{
		Use:   "list [prefix]",
		Short: "list artifact entities",
		RunE:  runArtifactList,
	}

	// --- get (download) ---
	var outputPath string
	getCmd := &cobra.Command{
		Use:   "get <id-or-sha256>",
		Short: "download an artifact",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runArtifactGet(cmd, args, outputPath)
		},
	}
	getCmd.Flags().StringVarP(&outputPath, "output", "o", "", "output file (default: stdout)")

	// --- put (upload) ---
	var (
		putContentType string
		putExpires     string
		putID          string
	)
	putCmd := &cobra.Command{
		Use:   "put <file>",
		Short: "upload an artifact",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runArtifactPut(cmd, args, putID, putContentType, putExpires)
		},
	}
	putCmd.Flags().StringVar(&putContentType, "type", "", "content type (auto-detected if omitted)")
	putCmd.Flags().StringVar(&putExpires, "expires", "", "expiry duration (e.g. 24h, 7d)")
	putCmd.Flags().StringVar(&putID, "id", "", "entity ID (auto-generated if omitted)")

	// --- delete ---
	deleteCmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "delete an artifact entity",
		Args:  cobra.ExactArgs(1),
		RunE:  runArtifactDelete,
	}

	// --- info ---
	infoCmd := &cobra.Command{
		Use:   "info <id>",
		Short: "show artifact metadata",
		Args:  cobra.ExactArgs(1),
		RunE:  runArtifactInfo,
	}

	artifactCmd.AddCommand(listCmd, getCmd, putCmd, deleteCmd, infoCmd)
	CMD.AddCommand(artifactCmd)
}

func runArtifactList(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	ctx := cmd.Context()

	artField := uint32(pb.EntityComponent_EntityComponentArtifact)
	resp, err := client.ListEntities(ctx, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{artField},
		},
	})
	if err != nil {
		return fmt.Errorf("list entities: %w", err)
	}

	prefix := ""
	if len(args) > 0 {
		prefix = args[0]
	}

	for _, e := range resp.Entities {
		if prefix != "" && !strings.HasPrefix(e.Id, prefix) {
			continue
		}
		art := e.Artifact
		if art == nil {
			continue
		}
		size := ""
		if art.SizeBytes != nil {
			size = formatBytes(*art.SizeBytes)
		}
		hash := ""
		if art.Sha256 != nil {
			h := *art.Sha256
			if len(h) > 12 {
				h = h[:12]
			}
			hash = h
		}
		expires := ""
		if e.Lifetime != nil && e.Lifetime.Until != nil {
			expires = e.Lifetime.Until.AsTime().Format(time.RFC3339)
		}
		fmt.Printf("%-40s  %-20s  %8s  %-12s  %s\n", e.Id, art.ContentType, size, hash, expires)
	}
	return nil
}

func runArtifactGet(cmd *cobra.Command, args []string, outputPath string) error {
	artClient := pb.NewArtifactServiceClient(conn)
	ctx := cmd.Context()

	ref := args[0]
	req := &pb.DownloadArtifactRequest{}

	// If it looks like a hex sha256, use sha256 lookup.
	if len(ref) == 64 && isHex(ref) {
		req.Ref = &pb.DownloadArtifactRequest_Sha256{Sha256: ref}
	} else {
		req.Ref = &pb.DownloadArtifactRequest_Id{Id: ref}
	}

	stream, err := artClient.DownloadArtifact(ctx, req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}

	var out io.Writer = os.Stdout
	if outputPath != "" {
		f, err := os.Create(outputPath)
		if err != nil {
			return err
		}
		defer f.Close()
		out = f
	}

	for {
		msg, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("recv: %w", err)
		}

		if msg.Meta != nil && outputPath != "" {
			fmt.Fprintf(os.Stderr, "artifact: %s  type: %s", msg.Meta.Id, msg.Meta.ContentType)
			if msg.Meta.SizeBytes != nil {
				fmt.Fprintf(os.Stderr, "  size: %s", formatBytes(*msg.Meta.SizeBytes))
			}
			fmt.Fprintln(os.Stderr)
		}

		if len(msg.Chunk) > 0 {
			if _, err := out.Write(msg.Chunk); err != nil {
				return err
			}
		}
	}
	return nil
}

func runArtifactPut(cmd *cobra.Command, args []string, entityID, contentType, expires string) error {
	worldClient := pb.NewWorldServiceClient(conn)
	artClient := pb.NewArtifactServiceClient(conn)
	ctx := cmd.Context()

	filePath := args[0]

	// Auto-detect content type.
	if contentType == "" {
		contentType = guessContentType(filePath)
	}

	// Generate entity ID if not provided.
	if entityID == "" {
		entityID = fmt.Sprintf("artifact:%d", time.Now().UnixNano())
	}

	// Read the file to get size and sha256 for the entity.
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return err
	}

	// Create the entity with ArtifactComponent first.
	entity := &pb.Entity{
		Id: entityID,
		Artifact: &pb.ArtifactComponent{
			Id:          entityID,
			ContentType: contentType,
		},
	}

	if expires != "" {
		dur, err := parseDuration(expires)
		if err != nil {
			return fmt.Errorf("invalid expires: %w", err)
		}
		entity.Lifetime = &pb.Lifetime{
			Until: timestamppb.New(time.Now().Add(dur)),
		}
	}

	if _, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{entity},
	}); err != nil {
		return fmt.Errorf("create entity: %w", err)
	}

	// Upload the data.
	stream, err := artClient.UploadArtifact(ctx)
	if err != nil {
		return fmt.Errorf("upload: %w", err)
	}

	// First message with entity ID.
	if err := stream.Send(&pb.UploadArtifactRequest{
		Id: proto.String(entityID),
	}); err != nil {
		return fmt.Errorf("send header: %w", err)
	}

	// Stream file data.
	h := sha256.New()
	buf := make([]byte, artifactChunkSize)
	for {
		n, readErr := f.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			h.Write(chunk)
			if err := stream.Send(&pb.UploadArtifactRequest{Chunk: chunk}); err != nil {
				return fmt.Errorf("send chunk: %w", err)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return fmt.Errorf("read file: %w", readErr)
		}
	}

	if _, err := stream.CloseAndRecv(); err != nil {
		return fmt.Errorf("close upload: %w", err)
	}

	hash := hex.EncodeToString(h.Sum(nil))
	fmt.Printf("uploaded %s (%s, %s, sha256:%s)\n", entityID, contentType, formatBytes(fi.Size()), hash[:12])
	return nil
}

func runArtifactDelete(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	ctx := cmd.Context()

	if _, err := client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: args[0]}); err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	fmt.Printf("deleted %s\n", args[0])
	return nil
}

func runArtifactInfo(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	ctx := cmd.Context()

	resp, err := client.GetEntity(ctx, &pb.GetEntityRequest{Id: args[0]})
	if err != nil {
		return fmt.Errorf("get entity: %w", err)
	}

	e := resp.Entity
	if e == nil {
		return fmt.Errorf("entity not found")
	}

	fmt.Printf("ID:     %s\n", e.Id)
	if e.Label != nil {
		fmt.Printf("Label:  %s\n", *e.Label)
	}

	art := e.Artifact
	if art != nil {
		fmt.Printf("Type:   %s\n", art.ContentType)
		if art.SizeBytes != nil {
			fmt.Printf("Size:   %s (%d bytes)\n", formatBytes(*art.SizeBytes), *art.SizeBytes)
		}
		if art.Sha256 != nil {
			fmt.Printf("SHA256: %s\n", *art.Sha256)
		}
		for _, loc := range art.Location {
			fmt.Printf("URL:    %s\n", loc.Url)
		}
	}

	if e.Lifetime != nil {
		if e.Lifetime.From != nil {
			fmt.Printf("From:   %s\n", e.Lifetime.From.AsTime().Format(time.RFC3339))
		}
		if e.Lifetime.Until != nil {
			fmt.Printf("Until:  %s\n", e.Lifetime.Until.AsTime().Format(time.RFC3339))
		}
	}

	return nil
}

func isHex(s string) bool {
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') && (c < 'A' || c > 'F') {
			return false
		}
	}
	return true
}

func formatBytes(b int64) string {
	switch {
	case b >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(b)/(1<<30))
	case b >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(b)/(1<<20))
	case b >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(b)/(1<<10))
	default:
		return fmt.Sprintf("%d B", b)
	}
}

func guessContentType(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".gif"):
		return "image/gif"
	case strings.HasSuffix(lower, ".pdf"):
		return "application/pdf"
	case strings.HasSuffix(lower, ".json"):
		return "application/json"
	case strings.HasSuffix(lower, ".txt"):
		return "text/plain"
	case strings.HasSuffix(lower, ".csv"):
		return "text/csv"
	case strings.HasSuffix(lower, ".zip"):
		return "application/zip"
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		return "application/gzip"
	default:
		return "application/octet-stream"
	}
}

// parseDuration extends time.ParseDuration with "d" for days.
func parseDuration(s string) (time.Duration, error) {
	if strings.HasSuffix(s, "d") {
		s = strings.TrimSuffix(s, "d")
		var days float64
		if _, err := fmt.Sscanf(s, "%f", &days); err != nil {
			return 0, err
		}
		return time.Duration(days * 24 * float64(time.Hour)), nil
	}
	return time.ParseDuration(s)
}
