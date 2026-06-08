package cli

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/projectqai/hydris/builtin/maps"
	"github.com/projectqai/hydris/engine"
	"github.com/projectqai/hydris/pkg/missionpkg"
	pb "github.com/projectqai/proto/go"
	"github.com/spf13/cobra"
)

func init() {
	var out, entity string
	var bbox []float64
	var zoom []int

	buildCmd := &cobra.Command{
		Use:   "build WORLD",
		Short: "build a mission package (.zip) from a world.yaml",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return runMissionBuild(args[0], out, entity, zoom, bbox)
		},
	}
	buildCmd.Flags().StringVarP(&out, "out", "o", "mission.zip", "output path")
	buildCmd.Flags().StringVar(&entity, "entity", "", "entity ID whose map layer tiles to bundle")
	buildCmd.Flags().Float64SliceVar(&bbox, "bbox", nil, "tile area: W,S,E,N")
	buildCmd.Flags().IntSliceVar(&zoom, "zoom", nil, "zoom range: min,max")

	loadCmd := &cobra.Command{
		Use:     "load <file>",
		Short:   "load a mission pack into a running engine",
		Args:    cobra.ExactArgs(1),
		PreRunE: connect,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runMissionLoad(cmd.Context(), args[0])
		},
	}
	AddConnectionFlags(loadCmd)

	missionCmd := &cobra.Command{Use: "mission", Short: "build and load mission packs"}
	missionCmd.AddCommand(buildCmd, loadCmd)
	CMD.AddCommand(missionCmd)
}

// runMissionBuild writes a mission package containing world.yaml, an empty
// index.json, and, when --entity is set, XYZ map layer tiles for the bbox
// and zoom range. Uses missionpkg.Packer so the output matches engine packs.
func runMissionBuild(worldPath, outPath, entity string, zoom []int, bbox []float64) (err error) {
	world, err := os.ReadFile(worldPath)
	if err != nil {
		return err
	}

	f, err := os.OpenFile(outPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("%s already exists; refusing to overwrite", outPath)
		}
		return err
	}
	defer f.Close()

	p := missionpkg.NewPacker(f, time.Now().UTC())
	defer func() {
		if cerr := p.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()

	// Best-effort manifest from the world.yaml. Parse failures fall back to
	// an empty Index so the build still produces a pack file.
	var idx missionpkg.Index
	if parsed, parseErr := engine.ParseEntities(world); parseErr == nil {
		idx.Manifest = engine.ComputeManifest(parsed, idx)
	}

	p.WriteWorld(world)
	p.WriteIndex(idx)
	if entity == "" {
		fmt.Fprintf(os.Stderr, "wrote %s\n", outPath)
		return nil
	}

	if len(bbox) != 4 {
		return fmt.Errorf("--bbox must be 4 numbers: W,S,E,N")
	}
	if bbox[0] >= bbox[2] || bbox[1] >= bbox[3] {
		return fmt.Errorf("--bbox: need W<E and S<N")
	}

	if len(zoom) != 2 {
		return fmt.Errorf("--zoom must be 2 numbers: min,max")
	}
	zMin, zMax := zoom[0], zoom[1]
	if zMin < 0 || zMin > zMax {
		return fmt.Errorf("--zoom: need 0 <= min <= max")
	}

	entities, err := engine.ParseEntities(world)
	if err != nil {
		return err
	}
	var tmpl string
	for _, e := range entities {
		if e.Id == entity && e.MapLayer != nil {
			if t := e.MapLayer.GetTiles(); t != nil {
				tmpl = t.Url
			}
		}
	}
	if tmpl == "" {
		return fmt.Errorf("entity %q not found or has no tile source", entity)
	}

	count := 0
	for z := zMin; z <= zMax; z++ {
		// Y axis is inverted, south is the larger
		xMin, yMax := lonLatToTile(bbox[0], bbox[1], z) // sw
		xMax, yMin := lonLatToTile(bbox[2], bbox[3], z) // ne
		for x := xMin; x <= xMax; x++ {
			for y := yMin; y <= yMax; y++ {
				body, err := fetchTile(tmpl, z, x, y)
				if err != nil {
					return err
				}
				p.WriteArtifact(maps.TileBlobID(entity, z, x, y), bytes.NewReader(body))
				count++
			}
		}
	}
	fmt.Fprintf(os.Stderr, "wrote %s (%d tiles)\n", outPath, count)
	return nil
}

func runMissionLoad(ctx context.Context, archivePath string) error {
	worldClient := pb.NewWorldServiceClient(conn)
	artClient := pb.NewArtifactServiceClient(conn)

	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()

	artifactID := fmt.Sprintf("mission.load.%d", time.Now().UnixNano())

	if _, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{{
			Id: artifactID,
			Artifact: &pb.ArtifactComponent{
				Id:          artifactID,
				ContentType: guessContentType(archivePath),
			},
		}},
	}); err != nil {
		return fmt.Errorf("create artifact entity: %w", err)
	}

	if err := uploadArtifactStream(ctx, artClient, artifactID, f); err != nil {
		return err
	}

	resp, err := worldClient.LoadMission(ctx, &pb.LoadMissionRequest{
		ArtifactId: artifactID,
	})
	if err != nil {
		return fmt.Errorf("load mission: %w", err)
	}

	fmt.Fprintf(os.Stderr, "loaded %s (%d entities)\n", archivePath, resp.Mission.GetEntityCount())
	return nil
}

// fetchTile downloads one XYZ tile replacing z/x/y into the URL template.
func fetchTile(tmpl string, z, x, y int) ([]byte, error) {
	url := strings.NewReplacer("{z}", strconv.Itoa(z), "{x}", strconv.Itoa(x), "{y}", strconv.Itoa(y)).Replace(tmpl)
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("User-Agent", "hydris-mission-builder")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", url, resp.Status)
	}
	return io.ReadAll(resp.Body)
}

// lonLatToTile converts lon/lat to XYZ tile coordinates at zoom z.
func lonLatToTile(lon, lat float64, z int) (x, y int) {
	n := math.Exp2(float64(z))
	x = int((lon + 180) / 360 * n)
	rad := lat * math.Pi / 180
	y = int((1 - math.Log(math.Tan(rad)+1/math.Cos(rad))/math.Pi) / 2 * n)
	return
}
