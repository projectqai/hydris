package webcam

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os/exec"

	"github.com/projectqai/hydris/pkg/executil"
)

// ffmpegCapture runs ffmpeg with the given arguments and parses the MJPEG
// output, delivering each JPEG frame to onFrame. This is shared across
// all platforms that use ffmpeg for capture.
func ffmpegCapture(ctx context.Context, logger *slog.Logger, args []string, onFrame func([]byte)) error {
	ffmpegPath, err := findFFmpeg()
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	executil.HideWindow(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}

	// Log stderr so ffmpeg errors are visible.
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start ffmpeg: %w", err)
	}

	logger.Info("ffmpeg capture started", "pid", cmd.Process.Pid, "args", args)

	// Read MJPEG stream: each frame starts with FFD8 and ends with FFD9.
	reader := bufio.NewReaderSize(stdout, 512*1024)
	var frame bytes.Buffer

	inFrame := false
	buf := make([]byte, 32*1024)

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			data := buf[:n]
			for len(data) > 0 {
				if !inFrame {
					idx := bytes.Index(data, []byte{0xFF, 0xD8})
					if idx < 0 {
						break
					}
					inFrame = true
					frame.Reset()
					data = data[idx:]
				}

				idx := bytes.Index(data, []byte{0xFF, 0xD9})
				if idx >= 0 {
					frame.Write(data[:idx+2])
					onFrame(bytes.Clone(frame.Bytes()))
					inFrame = false
					data = data[idx+2:]
				} else {
					frame.Write(data)
					data = nil
				}
			}
		}
		if err != nil {
			break
		}
	}

	err = cmd.Wait()
	if err != nil && stderrBuf.Len() > 0 {
		logger.Error("ffmpeg stderr", "output", stderrBuf.String())
	}
	return err
}

// ffmpegOneFrame runs ffmpeg to capture a single JPEG frame.
func ffmpegOneFrame(args []string) ([]byte, error) {
	ffmpegPath, err := findFFmpeg()
	if err != nil {
		return nil, err
	}

	cmd := exec.Command(ffmpegPath, args...)
	executil.HideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg: %w", err)
	}
	if len(out) < 2 || out[0] != 0xFF || out[1] != 0xD8 {
		return nil, fmt.Errorf("ffmpeg output is not JPEG (%d bytes)", len(out))
	}
	return out, nil
}
