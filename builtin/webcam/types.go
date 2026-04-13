package webcam

import pb "github.com/projectqai/proto/go"

// webcamInfo describes a discovered webcam device.
type webcamInfo struct {
	// Name is the human-readable name of the camera.
	Name string
	// DevicePath is the platform-specific device path (e.g. /dev/video0).
	DevicePath string
	// USB descriptor, populated when the camera is USB-connected.
	USB *pb.UsbDevice
	// Formats lists the pixel formats the camera natively supports.
	Formats []pixelFormat
}

// pixelFormat describes a camera-supported pixel format.
type pixelFormat struct {
	// FourCC is the four-character code (e.g. "MJPG", "H264", "YUYV").
	FourCC string
	// Width and Height are the maximum resolution for this format.
	Width, Height uint32
	// Framerate is the native framerate for this format (0 = unknown/default).
	Framerate float64
}
