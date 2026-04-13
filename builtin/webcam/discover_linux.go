//go:build linux

package webcam

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"github.com/fsnotify/fsnotify"
	pb "github.com/projectqai/proto/go"
	"golang.org/x/sys/unix"
	"google.golang.org/protobuf/proto"
)

// discoverAndWatch returns a channel that receives snapshots of currently
// present webcams. It fires once immediately and again on each hotplug
// event via inotify on /dev/.
func discoverAndWatch(ctx context.Context, logger *slog.Logger) <-chan map[string]webcamInfo {
	ch := make(chan map[string]webcamInfo, 1)

	go func() {
		defer close(ch)

		ch <- scanWebcams(logger)

		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			logger.Error("failed to create fsnotify watcher", "error", err)
			return
		}
		defer func() { _ = watcher.Close() }()

		if err := watcher.Add("/dev"); err != nil {
			logger.Error("failed to watch /dev", "error", err)
			return
		}

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				name := filepath.Base(event.Name)
				if !strings.HasPrefix(name, "video") {
					continue
				}
				if event.Op&(fsnotify.Create|fsnotify.Remove) == 0 {
					continue
				}
				ch <- scanWebcams(logger)
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				logger.Error("fsnotify error", "error", err)
			}
		}
	}()

	return ch
}

// scanWebcams enumerates webcams via /sys/class/video4linux/ and verifies
// they are capture-capable using V4L2 VIDIOC_QUERYCAP.
func scanWebcams(logger *slog.Logger) map[string]webcamInfo {
	cams := make(map[string]webcamInfo)

	entries, err := os.ReadDir("/sys/class/video4linux")
	if err != nil {
		logger.Warn("cannot read /sys/class/video4linux", "error", err)
		return cams
	}

	for _, entry := range entries {
		name := entry.Name()
		devPath := "/dev/" + name

		// Check capture capability via VIDIOC_QUERYCAP.
		fd, err := unix.Open(devPath, unix.O_RDWR|unix.O_NONBLOCK, 0)
		if err != nil {
			continue
		}

		var cap v4l2Capability
		if err := ioctlQuerycap(fd, &cap); err != nil {
			_ = unix.Close(fd)
			continue
		}

		// Use device-specific caps when available (filters out metadata nodes).
		caps := cap.capabilities
		if caps&v4l2CapDeviceCaps != 0 {
			caps = cap.deviceCaps
		}
		if caps&v4l2CapVideoCapture == 0 {
			_ = unix.Close(fd)
			continue
		}

		// Read human-readable name from sysfs.
		humanName := readStringFile(filepath.Join("/sys/class/video4linux", name, "name"))
		if humanName == "" {
			humanName = nullTerminatedString(cap.card[:])
		}

		// Enumerate supported formats.
		formats := enumFormats(fd)
		_ = unix.Close(fd)

		info := webcamInfo{
			Name:       humanName,
			DevicePath: devPath,
			Formats:    formats,
		}

		// Read USB info if available.
		deviceLink := filepath.Join("/sys/class/video4linux", name, "device")
		resolved, err := filepath.EvalSymlinks(deviceLink)
		if err == nil {
			readUSBInfo(&info, resolved)
		}

		key := stableID(name, info)
		// Keep only the first (lowest-numbered) node per physical camera.
		// Multiple video nodes per device is common (e.g. video0=capture, video2=capture alternate).
		if _, exists := cams[key]; !exists {
			cams[key] = info
		}
	}

	return cams
}

// stableID returns a hardware-based identifier for the webcam that is stable
// across reboots and re-enumeration.
func stableID(devName string, info webcamInfo) string {
	if u := info.USB; u != nil && u.GetSerialNumber() != "" {
		return fmt.Sprintf("%04x-%04x-%s", u.GetVendorId(), u.GetProductId(), u.GetSerialNumber())
	}
	if u := info.USB; u != nil {
		return fmt.Sprintf("%04x-%04x-%s", u.GetVendorId(), u.GetProductId(), devName)
	}
	return devName
}

// readUSBInfo walks up from the device sysfs path to find the USB device
// directory (containing idVendor) and populates the webcamInfo USB descriptor.
func readUSBInfo(info *webcamInfo, resolved string) {
	dir := resolved
	for dir != "/" {
		if _, err := os.Stat(filepath.Join(dir, "idVendor")); err == nil {
			info.USB = &pb.UsbDevice{
				VendorId:         proto.Uint32(readHexFile(filepath.Join(dir, "idVendor"))),
				ProductId:        proto.Uint32(readHexFile(filepath.Join(dir, "idProduct"))),
				ManufacturerName: proto.String(readStringFile(filepath.Join(dir, "manufacturer"))),
				ProductName:      proto.String(readStringFile(filepath.Join(dir, "product"))),
				SerialNumber:     proto.String(readStringFile(filepath.Join(dir, "serial"))),
			}
			return
		}
		dir = filepath.Dir(dir)
	}
}

func readStringFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func readHexFile(path string) uint32 {
	s := readStringFile(path)
	if s == "" {
		return 0
	}
	var val uint32
	_, _ = fmt.Sscanf(s, "%x", &val)
	return val
}

// V4L2 constants and structures for capability and format queries.
const (
	v4l2CapVideoCapture uint32 = 0x00000001
	v4l2CapDeviceCaps   uint32 = 0x80000000 // V4L2_CAP_DEVICE_CAPS

	vidiocQuerycap = 0x80685600 // VIDIOC_QUERYCAP
	vidiocEnumFmt  = 0xC0405602 // VIDIOC_ENUM_FMT
)

type v4l2Capability struct {
	driver       [16]byte
	card         [32]byte
	busInfo      [32]byte
	version      uint32
	capabilities uint32
	deviceCaps   uint32
	reserved     [3]uint32
}

type v4l2Fmtdesc struct {
	index       uint32
	typ         uint32
	flags       uint32
	description [32]byte
	pixelformat uint32
	mbus_code   uint32
	reserved    [3]uint32
}

func ioctlQuerycap(fd int, cap *v4l2Capability) error {
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), vidiocQuerycap, uintptr(unsafe.Pointer(cap)))
	if errno != 0 {
		return errno
	}
	return nil
}

func enumFormats(fd int) []pixelFormat {
	var formats []pixelFormat
	for i := uint32(0); ; i++ {
		var desc v4l2Fmtdesc
		desc.index = i
		desc.typ = 1 // V4L2_BUF_TYPE_VIDEO_CAPTURE
		_, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), vidiocEnumFmt, uintptr(unsafe.Pointer(&desc)))
		if errno != 0 {
			break
		}
		fourCC := fourCCString(desc.pixelformat)
		formats = append(formats, pixelFormat{
			FourCC: fourCC,
		})
	}
	return formats
}

func fourCCString(v uint32) string {
	b := [4]byte{
		byte(v & 0xFF),
		byte((v >> 8) & 0xFF),
		byte((v >> 16) & 0xFF),
		byte((v >> 24) & 0xFF),
	}
	return strings.TrimRight(string(b[:]), " \x00")
}

func nullTerminatedString(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}
