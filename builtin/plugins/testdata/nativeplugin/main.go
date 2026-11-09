// A native test plugin: pushes one entity naming the plugin it runs as and
// whether NATIVE_TEST_SECRET reached it, then runs until stopped. A file
// "fail" in its directory makes it fail at once instead.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"

	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/sdk"
	"google.golang.org/protobuf/proto"
)

func main() {
	sdk.Main(func(ctx context.Context, logger *slog.Logger) error {
		if _, err := os.Stat(filepath.Join(os.Getenv("HYDRIS_DATA_DIR"), "fail")); err == nil {
			return errors.New("asked to fail")
		}
		if err := sdk.Push(ctx, &pb.Entity{
			Id:    "nativetest.hello",
			Label: proto.String(os.Getenv("HYDRIS_PLUGIN_ID") + "|" + os.Getenv("NATIVE_TEST_SECRET")),
		}); err != nil {
			return err
		}
		logger.Info("pushed", "id", "nativetest.hello")
		<-ctx.Done()
		return nil
	})
}
