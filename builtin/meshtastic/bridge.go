package meshtastic

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/builtin/devices"
	"github.com/projectqai/hydris/builtin/meshtastic/meshpb"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// SerialWriter is implemented by Kotlin via gomobile.
type SerialWriter interface {
	Write(data []byte) (int, error)
}

// DeviceOpener is implemented by Kotlin. Go calls RequestDevice when a config
// entity needs a USB serial device opened.
// deviceFilter is the config "device" field — empty string means any device.
type DeviceOpener interface {
	RequestDevice(deviceFilter string)
}

// deviceConn is a writer + read channel for a single USB device.
type deviceConn struct {
	writer SerialWriter
	recvCh chan []byte
}

// deviceRequest represents a config instance waiting for a USB device.
type deviceRequest struct {
	deviceFilter string
	ch           chan *deviceConn
}

var (
	registryMu   sync.Mutex
	opener       DeviceOpener
	requests     []*deviceRequest
	connected    = make(map[string]chan []byte)
	deviceListCh = make(chan string, 1)
)

// SetDeviceOpener is called once at startup by Kotlin to provide the callback.
func SetDeviceOpener(o DeviceOpener) {
	registryMu.Lock()
	opener = o
	registryMu.Unlock()
}

// UpdateDeviceList is called by Kotlin with a JSON array of all current USB
// devices whenever the set changes (attach/detach) or at startup.
func UpdateDeviceList(devicesJSON string) {
	// Replace any pending update with the latest snapshot.
	select {
	case <-deviceListCh:
	default:
	}
	deviceListCh <- devicesJSON
}

// ConnectDevice is called from Kotlin after it opens a USB device in response
// to a RequestDevice call.
func ConnectDevice(deviceName string, writer SerialWriter) {
	recvCh := make(chan []byte, 256)
	conn := &deviceConn{writer: writer, recvCh: recvCh}

	registryMu.Lock()
	connected[deviceName] = recvCh

	// Find matching request: exact match first, then wildcard
	var matched *deviceRequest
	matchIdx := -1
	for i, r := range requests {
		if r.deviceFilter == deviceName {
			matched = r
			matchIdx = i
			break
		}
	}
	if matched == nil {
		for i, r := range requests {
			if r.deviceFilter == "" {
				matched = r
				matchIdx = i
				break
			}
		}
	}
	if matchIdx >= 0 {
		requests = append(requests[:matchIdx], requests[matchIdx+1:]...)
	}
	registryMu.Unlock()

	if matched != nil {
		matched.ch <- conn
	}
}

// DisconnectDevice is called when a USB device is removed.
func DisconnectDevice(deviceName string) {
	registryMu.Lock()
	delete(connected, deviceName)
	registryMu.Unlock()
}

// OnDeviceData is called from Kotlin's read thread when bytes arrive.
func OnDeviceData(deviceName string, data []byte) {
	buf := make([]byte, len(data))
	copy(buf, data)

	registryMu.Lock()
	ch, ok := connected[deviceName]
	registryMu.Unlock()

	if ok {
		select {
		case ch <- buf:
		default:
		}
	}
}

// waitForDevice registers a request and asks Kotlin to open the device.
func waitForDevice(ctx context.Context, deviceFilter string) (*deviceConn, error) {
	req := &deviceRequest{
		deviceFilter: deviceFilter,
		ch:           make(chan *deviceConn, 1),
	}

	registryMu.Lock()
	requests = append(requests, req)
	o := opener
	registryMu.Unlock()

	defer func() {
		registryMu.Lock()
		for i, r := range requests {
			if r == req {
				requests = append(requests[:i], requests[i+1:]...)
				break
			}
		}
		registryMu.Unlock()
	}()

	// Ask Kotlin to open the device
	if o != nil {
		o.RequestDevice(deviceFilter)
	} else {
		slog.Warn("no DeviceOpener registered, cannot request USB device")
	}

	select {
	case conn := <-req.ch:
		return conn, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// deviceInfo is an alias for the shared devices.DeviceInfo type.
// The platform (Kotlin/etc) pushes JSON arrays of these.
type deviceInfo = devices.DeviceInfo

// whitelistVIDs are USB Vendor IDs with high confidence of being meshtastic devices.
var whitelistVIDs = map[uint32]bool{
	0x239A: true, // Adafruit / RAK4631 / nRF52-based boards
	0x303A: true, // Espressif / Heltec ESP32-based boards
}

// blacklistVIDs are USB Vendor IDs known to NOT be meshtastic devices.
var blacklistVIDs = map[uint32]bool{
	0x1366: true, // SEGGER J-Link
	0x0483: true, // STMicroelectronics ST-LINK/V2
	0x1915: true, // Nordic Semiconductor PPK2
	0x0925: true, // Saleae Logic analyzer
	0x04b4: true, // Cypress / Hantek oscilloscope
	0x067B: true, // Prolific PL2303 USB-to-serial converter
}

// isMeshtasticCandidate checks whether a device entity with a USB descriptor
// could be a meshtastic device. Stage 1: whitelist VIDs are high confidence.
// Stage 2 fallback: any USB device not in the blacklist.
func isMeshtasticCandidate(entity *pb.Entity) bool {
	if entity.Device == nil || entity.Device.Usb == nil {
		return false
	}
	vid := entity.Device.Usb.GetVendorId()
	if whitelistVIDs[vid] {
		return true
	}
	if blacklistVIDs[vid] {
		return false
	}
	// Fallback: any USB serial device not blacklisted is a candidate.
	return entity.Device.Serial != nil
}

// maintainDeviceEntities receives device list snapshots from the platform
// (Kotlin/Android) and pushes DeviceComponent entities accordingly.
// On Linux the serial builtin handles this instead.
func maintainDeviceEntities(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		logger.Error("device entities: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	resp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		logger.Error("device entities: failed to get local node", "error", err)
		return
	}
	nodeEntityID := resp.Entity.Id

	known := make(map[string]deviceInfo)

	for {
		var raw string
		select {
		case <-ctx.Done():
			return
		case raw = <-deviceListCh:
		}

		var devs []deviceInfo
		if raw != "" {
			if err := json.Unmarshal([]byte(raw), &devs); err != nil {
				logger.Error("failed to parse device list", "error", err)
				continue
			}
		}

		current := make(map[string]deviceInfo)
		for _, d := range devs {
			current[d.Name] = d
		}

		// Push new devices
		for name, info := range current {
			if _, exists := known[name]; !exists {
				logger.Info("device appeared", "name", name)
				if _, err := client.Push(ctx, &pb.EntityChangeRequest{
					Changes: []*pb.Entity{devices.BuildDeviceEntity("meshtastic", nodeEntityID, info)},
				}); err != nil {
					logger.Error("failed to push device entity", "name", name, "error", err)
				}
			}
		}

		// Expire removed devices
		for name := range known {
			if _, exists := current[name]; !exists {
				logger.Info("device removed", "name", name)
				if _, err := client.ExpireEntity(ctx, &pb.ExpireEntityRequest{
					Id: "meshtastic.device." + nodeEntityID + "." + name,
				}); err != nil {
					logger.Error("failed to expire device entity", "name", name, "error", err)
				}
			}
		}

		known = current
	}
}

// watchDevicesAndPublishMeshtasticDevices watches all device entities and
// publishes meshtastic child device entities for those that look like
// meshtastic candidates (based on USB VID whitelist/blacklist).
// Each child device has Controller.Id = "meshtastic", Parent = parent device ID,
// Configurable entries for the meshtastic.usb.v0 key, and Labels derived from parent.
func watchDevicesAndPublishMeshtasticDevices(ctx context.Context, logger *slog.Logger) {
	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		logger.Error("device watch: failed to connect", "error", err)
		return
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	// Watch for entities with DeviceComponent (field 50).
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{50},
		},
	})
	if err != nil {
		logger.Error("device watch: failed to watch", "error", err)
		return
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Error("device watch: stream error", "error", err)
			return
		}

		if event.Entity == nil {
			continue
		}

		entity := event.Entity

		// Skip entities owned by this controller.
		if entity.Controller != nil && entity.Controller.GetId() == "meshtastic" {
			continue
		}

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			if entity.Lifetime != nil && entity.Lifetime.Until != nil &&
				!entity.Lifetime.Until.AsTime().After(time.Now()) {
				continue
			}

			if !isMeshtasticCandidate(entity) {
				continue
			}

			logger.Info("meshtastic candidate device found", "entityID", entity.Id)

			childEntity := meshtasticDeviceForParent(entity)
			if _, err := client.Push(ctx, &pb.EntityChangeRequest{
				Changes: []*pb.Entity{childEntity},
			}); err != nil {
				logger.Error("failed to push meshtastic device", "entityID", entity.Id, "error", err)
			}

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			childID := "meshtastic.device." + entity.Id
			if _, err := client.ExpireEntity(ctx, &pb.ExpireEntityRequest{
				Id: childID,
			}); err != nil {
				logger.Error("failed to expire meshtastic device", "entityID", entity.Id, "error", err)
			}
		}
	}
}

// meshtasticDeviceForParent creates a meshtastic child device entity from a parent device entity.
func meshtasticDeviceForParent(parent *pb.Entity) *pb.Entity {
	usbSchema, _ := structpb.NewStruct(map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"channel": map[string]interface{}{
				"type":        "integer",
				"description": "Meshtastic channel index",
			},
			"hop_limit": map[string]interface{}{
				"type":        "integer",
				"description": "Maximum number of hops for transmitted packets",
			},
			"send_format": map[string]interface{}{
				"type":        "string",
				"description": "Format for outbound entities: cot, pli, or hydris. Empty means no sending.",
				"enum":        []interface{}{"", "cot", "pli", "hydris"},
			},
		},
	})

	labels := make(map[string]string)
	if parent.Device != nil && parent.Device.Usb != nil {
		if pn := parent.Device.Usb.GetProductName(); pn != "" {
			labels["usb.product_name"] = pn
		}
	}

	return &pb.Entity{
		Id: "meshtastic.device." + parent.Id,
		Controller: &pb.Controller{
			Id: proto.String("meshtastic"),
		},
		Device: &pb.DeviceComponent{
			Parent: proto.String(parent.Id),
			Configurable: []*pb.Configurable{{
				Key:    "meshtastic.usb.v0",
				Schema: usbSchema,
			}},
			Labels: labels,
		},
	}
}

func init() {
	builtin.Register("meshtastic", Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	go maintainDeviceEntities(ctx, logger)
	go watchDevicesAndPublishMeshtasticDevices(ctx, logger)

	return controller.Run1to1(ctx, "meshtastic", func(ctx context.Context, config *pb.Entity, device *pb.Entity) error {
		return runInstance(ctx, logger, config, device)
	})
}

func runInstance(parentCtx context.Context, logger *slog.Logger, configEntity *pb.Entity, device *pb.Entity) error {
	ctx, cancel := context.WithCancel(parentCtx)
	defer cancel()

	config := configEntity.Config
	if config == nil {
		return fmt.Errorf("entity %s has no config", configEntity.Id)
	}
	if config.Key != "meshtastic.usb.v0" {
		return fmt.Errorf("unknown config key: %s", config.Key)
	}

	channel := uint32(0)
	hopLimit := uint32(3)
	sendFormat := ""
	if config.Value != nil && config.Value.Fields != nil {
		if v, ok := config.Value.Fields["channel"]; ok {
			channel = uint32(v.GetNumberValue())
		}
		if v, ok := config.Value.Fields["hop_limit"]; ok {
			hopLimit = uint32(v.GetNumberValue())
		}
		if v, ok := config.Value.Fields["send_format"]; ok {
			sendFormat = v.GetStringValue()
		}
	}

	// Resolve the serial path from the matched device entity.
	var radio *Radio
	var parentDeviceEntityID string

	if device != nil && device.Device != nil {
		parentDeviceEntityID = device.Device.GetParent()

		logger.Info("Matched device, resolving serial path",
			"configID", configEntity.Id,
			"deviceID", device.Id,
			"parentID", parentDeviceEntityID,
			"channel", channel,
			"hopLimit", hopLimit,
		)

		// Look up the parent device entity to get the serial path.
		grpcConn, err := builtin.BuiltinClientConn()
		if err != nil {
			return fmt.Errorf("grpc connect: %w", err)
		}
		parentClient := pb.NewWorldServiceClient(grpcConn)
		parentResp, err := parentClient.GetEntity(ctx, &pb.GetEntityRequest{Id: parentDeviceEntityID})
		_ = grpcConn.Close()
		if err != nil {
			return fmt.Errorf("get parent device entity %s: %w", parentDeviceEntityID, err)
		}

		parentEntity := parentResp.Entity
		if parentEntity.Device == nil || parentEntity.Device.Serial == nil {
			return fmt.Errorf("parent device %s has no serial descriptor", parentDeviceEntityID)
		}

		serialPath := parentEntity.Device.Serial.GetPath()
		if serialPath == "" {
			return fmt.Errorf("parent device %s has empty serial path", parentDeviceEntityID)
		}

		// Try direct serial open on Linux.
		registryMu.Lock()
		hasOpener := opener != nil
		registryMu.Unlock()

		if !hasOpener {
			logger.Info("Opening serial port directly", "path", serialPath)
			f, err := openSerialPort(serialPath)
			if err != nil {
				return fmt.Errorf("open serial %s: %w", serialPath, err)
			}
			defer func() { _ = f.Close() }()
			logger.Info("Serial port opened", "path", serialPath)
			radio = NewRadio(f)
		} else {
			// Android/Kotlin path: use waitForDevice.
			conn, err := waitForDevice(ctx, device.Id)
			if err != nil {
				return err
			}
			radio = NewRadioFromCallbacks(conn.writer, conn.recvCh)
		}
	} else {
		// Freestanding config (no matched device) — use waitForDevice with empty filter.
		logger.Info("No matched device, requesting any USB device...",
			"configID", configEntity.Id,
			"channel", channel,
			"hopLimit", hopLimit,
		)
		conn, err := waitForDevice(ctx, "")
		if err != nil {
			return err
		}
		radio = NewRadioFromCallbacks(conn.writer, conn.recvCh)
	}

	logger.Info("Starting radio handshake")
	radioCfg, err := radio.init()
	if err != nil {
		return fmt.Errorf("radio init: %w", err)
	}

	nodeHex := fmt.Sprintf("%08x", radioCfg.NodeNum)
	radioLabel := radioCfg.LongName
	if radioLabel == "" {
		radioLabel = "!" + nodeHex
	}

	logger.Info("Radio initialized",
		"nodeNum", "!"+nodeHex,
		"label", radioLabel,
		"channels", len(radioCfg.Channels),
		"configs", len(radioCfg.Configs),
		"moduleConfigs", len(radioCfg.ModuleConfigs),
	)

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	localNodeResp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return fmt.Errorf("get local node: %w", err)
	}
	localNodeID := localNodeResp.NodeId

	// Push radio device entity.
	radioDeviceID := "meshtastic.radio." + nodeHex

	radioEntities := buildRadioEntities(radioCfg, radioDeviceID, "", parentDeviceEntityID, configEntity.Id, radioLabel)
	if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: radioEntities}); err != nil {
		logger.Error("Failed to push radio entities", "error", err)
	} else {
		logger.Info("Pushed radio entity", "device", radioDeviceID)
	}

	// Expire radio entity on exit.
	defer func() {
		expireCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = client.ExpireEntity(expireCtx, &pb.ExpireEntityRequest{Id: radioDeviceID})
	}()

	controllerID := configEntity.Id

	go func() {
		<-ctx.Done()
		_ = radio.Close()
	}()

	senderCount := 0
	if sendFormat != "" {
		senderCount = 1
	}
	errCh := make(chan error, 1+senderCount)

	go func() {
		errCh <- runReceiver(ctx, logger, grpcConn, radio, controllerID, radioDeviceID)
	}()

	// Re-request config so the receiver picks up the cached node database.
	// The receiver handles NodeInfo and ignores config/channel messages.
	_ = radio.Send(&meshpb.ToRadio{
		Msg: &meshpb.ToRadio_WantConfigId{WantConfigId: 42},
	})

	if sendFormat != "" {
		go func() {
			errCh <- runSender(ctx, logger, grpcConn, radio, channel, hopLimit, sendFormat, localNodeID)
		}()
	}

	select {
	case err := <-errCh:
		if err != nil && ctx.Err() == nil {
			return err
		}
	case <-ctx.Done():
	}

	return nil
}

// buildRadioEntities creates a device entity and configurable entity for the
// connected radio, based on the config received during init.
func buildRadioEntities(cfg *RadioHandshake, deviceID, configurableID, parentDeviceEntityID, configEntityID, label string) []*pb.Entity {
	dev := &pb.DeviceComponent{
		State: pb.DeviceState_DeviceStateActive,
	}
	if parentDeviceEntityID != "" {
		dev.Parent = proto.String(parentDeviceEntityID)
	}

	deviceEntity := &pb.Entity{
		Id:    deviceID,
		Label: proto.String(label),
		Controller: &pb.Controller{
			Id: proto.String("meshtastic"),
		},
		Device: dev,
	}

	return []*pb.Entity{deviceEntity}
}
