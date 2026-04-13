package meshtastic

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/builtin/meshtastic/meshpb"
	"github.com/projectqai/hydris/hal"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// Shared default config state. Updated by the meshtastic.defaults connector,
// read by meshtastic.device.* connectors to fill in unset fields.
var (
	defaultsMu      sync.RWMutex
	defaultChannel  uint32 = 0
	defaultHopLimit uint32 = 3
	defaultSendFmt  string = ""
)

// activeRadios tracks the number of radios in active state.
// Used to derive the service entity's device state.
var activeRadios atomic.Int32

func init() {
	builtin.Register("meshtastic", Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	go watchDevicesAndPublishMeshtasticDevices(ctx, logger)

	// Build default config schema.
	defaultProps := map[string]interface{}{
		"channel": map[string]interface{}{
			"type":        "integer",
			"title":       "Channel Index",
			"description": "Default meshtastic channel index",
			"default":     0,
			"minimum":     0,
			"ui:group":    "messaging",
			"ui:order":    0,
		},
		"hop_limit": map[string]interface{}{
			"type":        "integer",
			"title":       "Hop Limit",
			"description": "Maximum number of hops for transmitted packets",
			"default":     3,
			"minimum":     0,
			"maximum":     7,
			"ui:widget":   "stepper",
			"ui:step":     1,
			"ui:group":    "messaging",
			"ui:order":    1,
		},
		"send_format": map[string]interface{}{
			"type":        "string",
			"title":       "Send Format",
			"description": "Format for outbound entities. Empty means no sending.",
			"default":     "",
			"oneOf": []interface{}{
				map[string]interface{}{"const": "", "title": "Silent"},
				map[string]interface{}{"const": "native", "title": "Native Meshtastic Only"},
				map[string]interface{}{"const": "tak", "title": "TAK (ATAK compatible)"},
				map[string]interface{}{"const": "hydris", "title": "Hydris"},
			},
			"ui:group": "messaging",
			"ui:order": 2,
		},
	}
	for k, v := range radioConfigSchemaProperties() {
		defaultProps[k] = v
	}
	defaultSchema, _ := structpb.NewStruct(map[string]interface{}{
		"type": "object",
		"ui:groups": []interface{}{
			map[string]interface{}{"key": "messaging", "title": "Messaging"},
			map[string]interface{}{"key": "radio", "title": "Radio", "collapsed": true},
			map[string]interface{}{"key": "device", "title": "Device", "collapsed": true},
			map[string]interface{}{"key": "position", "title": "Position", "collapsed": true},
			map[string]interface{}{"key": "identity", "title": "Identity", "collapsed": true},
			map[string]interface{}{"key": "channel", "title": "Channel", "collapsed": true},
		},
		"properties": defaultProps,
	})

	serviceSchema, _ := structpb.NewStruct(map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"autoconfig": map[string]interface{}{
				"type":        "boolean",
				"title":       "Enable Auto Provisioning",
				"description": "Automatically configure devices on the autolist (high-confidence meshtastic VIDs)",
			},
		},
	})

	controllerName := "meshtastic"

	if err := controller.Push(ctx,
		&pb.Entity{
			Id:    "meshtastic.service",
			Label: proto.String("Meshtastic"),
			Controller: &pb.Controller{
				Id: &controllerName,
			},
			Device: &pb.DeviceComponent{
				Category: proto.String("Network"),
				State:    pb.DeviceState_DeviceStateActive,
			},
			Configurable: &pb.ConfigurableComponent{
				Schema: serviceSchema,
				SupportedDeviceClasses: []*pb.DeviceClassOption{
					{Class: "defaults", Label: "Default Configuration"},
				},
			},
			Interactivity: &pb.InteractivityComponent{
				Icon: proto.String("radio"),
			},
		},
	); err != nil {
		return fmt.Errorf("push startup entities: %w", err)
	}

	// Watch the service entity's own config for autoconfig.
	go controller.Run(ctx, "meshtastic.service", func(ctx context.Context, entity *pb.Entity, ready func()) error { //nolint:errcheck // fire-and-forget goroutine
		ready()
		return runAutoConfig(ctx, logger, entity)
	})

	classes := []controller.DeviceClass{
		{Class: "defaults", Label: "Default Configuration", Schema: defaultSchema},
	}

	return controller.WatchChildren(ctx, "meshtastic.service", controllerName, classes, func(ctx context.Context, entityID string) error {
		return controller.Run(ctx, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
			if entity.Device.GetClass() == "defaults" {
				ready()
				return runDefaultConfig(ctx, logger, entity)
			}
			return fmt.Errorf("unknown device class: %s", entity.Device.GetClass())
		})
	})
}

// runDefaultConfig stores the default config values and blocks until cancelled.
// When the config changes, the controller restarts this connector with new values.
func runDefaultConfig(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	defaultsMu.Lock()
	if entity.Config != nil && entity.Config.Value != nil && entity.Config.Value.Fields != nil {
		if v, ok := entity.Config.Value.Fields["channel"]; ok {
			defaultChannel = uint32(v.GetNumberValue())
		}
		if v, ok := entity.Config.Value.Fields["hop_limit"]; ok {
			defaultHopLimit = uint32(v.GetNumberValue())
		}
		if v, ok := entity.Config.Value.Fields["send_format"]; ok {
			defaultSendFmt = v.GetStringValue()
		}
	}
	defaultsMu.Unlock()

	logger.Info("Default config updated",
		"channel", defaultChannel,
		"hopLimit", defaultHopLimit,
		"sendFormat", defaultSendFmt,
	)

	<-ctx.Done()
	return nil
}

// runAutoConfig manages auto-configuration of autolist devices.
// When enabled, it watches for autolist devices and pushes Config
// onto the device entity directly using default config values.
func runAutoConfig(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	enabled := false
	if entity.Config != nil && entity.Config.Value != nil && entity.Config.Value.Fields != nil {
		if v, ok := entity.Config.Value.Fields["autoconfig"]; ok {
			enabled = v.GetBoolValue()
		}
	}

	if !enabled {
		logger.Info("Auto-config disabled, waiting")
		<-ctx.Done()
		return nil
	}

	logger.Info("Auto-config enabled, starting auto manager")
	return runAutoManager(ctx, logger)
}

func runInstance(parentCtx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	ctx, cancel := context.WithCancel(parentCtx)
	defer cancel()

	config := entity.Config

	// Read defaults, then override with explicit config values.
	defaultsMu.RLock()
	channel := defaultChannel
	hopLimit := defaultHopLimit
	sendFormat := defaultSendFmt
	defaultsMu.RUnlock()

	if config != nil && config.Value != nil && config.Value.Fields != nil {
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

	// Backward compat for old send format names
	switch sendFormat {
	case "pli", "meshtastic":
		sendFormat = "native"
	case "cot":
		sendFormat = "tak"
	}

	// Resolve the serial path from the device entity.
	var radio *Radio
	var parentDeviceEntityID string

	if entity.Device != nil {
		// The serial device is stored in composition (not parent, which is the service entity).
		if len(entity.Device.Composition) > 0 {
			parentDeviceEntityID = entity.Device.Composition[0]
		}

		logger.Info("Matched device, resolving serial path",
			"entityID", entity.Id,
			"serialDeviceID", parentDeviceEntityID,
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

		logger.Info("Opening serial port via HAL", "path", serialPath)
		port, err := hal.OpenSerial(serialPath, 115200)
		if err != nil {
			return fmt.Errorf("open serial %s: %w", serialPath, err)
		}
		defer func() { _ = port.Close() }()
		logger.Info("Serial port opened", "path", serialPath)
		radio = NewRadio(port)
	} else {
		return fmt.Errorf("no matched device for entity %s", entity.Id)
	}

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()

	client := pb.NewWorldServiceClient(grpcConn)

	// Helper to push configurable entity state.
	pushConfigurableState := func(cfgState pb.ConfigurableState, cfgErr string) {
		var cfg *pb.ConfigurableComponent
		if entity.Configurable != nil {
			cfg = proto.Clone(entity.Configurable).(*pb.ConfigurableComponent)
		} else {
			cfg = &pb.ConfigurableComponent{}
		}
		cfg.State = cfgState
		if cfgErr != "" {
			cfg.Error = proto.String(cfgErr)
		} else {
			cfg.Error = nil
		}
		// Confirm the config version so the UI knows changes were applied.
		if cfgState == pb.ConfigurableState_ConfigurableStateActive && entity.Config != nil {
			cfg.AppliedVersion = entity.Config.Version
		}
		if _, err := client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: entity.Id,
				Controller: &pb.Controller{
					Id: proto.String("meshtastic"),
				},
				Configurable: cfg,
			}},
		}); err != nil {
			logger.Error("Failed to push configurable state", "error", err)
		}
	}

	// Signal that we're starting up.
	pushConfigurableState(pb.ConfigurableState_ConfigurableStateStarting, "")

	logger.Info("Starting radio handshake")
	radioCfg, err := radio.init()
	if err != nil {
		errMsg := fmt.Sprintf("radio init: %v", err)
		pushConfigurableState(pb.ConfigurableState_ConfigurableStateFailed, errMsg)
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

	// Apply radio hardware config if any radio fields are set.
	var configFailed bool
	var configErr string
	var radioFields map[string]*structpb.Value
	if config != nil && config.Value != nil {
		radioFields = config.Value.Fields
	}
	currentRadioState := readRadioState(radioCfg)
	if rs := parseRadioSettings(radioFields, currentRadioState); rs != nil {
		pushConfigurableState(pb.ConfigurableState_ConfigurableStateStarting, "")

		if err := applyRadioConfig(logger, radio, radioCfg, rs); err != nil {
			configErr = err.Error()
			configFailed = true
			logger.Error("Failed to apply radio config", "error", err)
		}
	}

	// Read current radio state and push as configurable value.
	stateValue, _ := structpb.NewStruct(readRadioState(radioCfg))
	if configFailed {
		pushConfigurableState(pb.ConfigurableState_ConfigurableStateFailed, configErr)
	} else {
		pushConfigurableState(pb.ConfigurableState_ConfigurableStateActive, "")
		activeRadios.Add(1)
		defer func() {
			activeRadios.Add(-1)
			updateServiceState(ctx, logger)
		}()
		updateServiceState(ctx, logger)
	}

	// Push configurable value back so UI shows current radio state.
	if entity.Configurable != nil {
		cfg := proto.Clone(entity.Configurable).(*pb.ConfigurableComponent)
		cfg.Value = stateValue
		if configFailed {
			cfg.State = pb.ConfigurableState_ConfigurableStateFailed
			cfg.Error = proto.String(configErr)
		} else {
			cfg.State = pb.ConfigurableState_ConfigurableStateActive
			cfg.Error = nil
		}
		if entity.Config != nil {
			cfg.AppliedVersion = entity.Config.Version
		}
		if _, err := client.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{{
				Id: entity.Id,
				Controller: &pb.Controller{
					Id: proto.String("meshtastic"),
				},
				Configurable: cfg,
			}},
		}); err != nil {
			logger.Error("Failed to push configurable value", "error", err)
		}
	}

	localNodeResp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
	if err != nil {
		return fmt.Errorf("get local node: %w", err)
	}
	localNodeID := localNodeResp.NodeId

	// Push radio device entity.
	radioDeviceID := "meshtastic.radio." + nodeHex

	radioEntities := buildRadioEntities(radioCfg, radioDeviceID, parentDeviceEntityID, entity.Id, radioLabel)
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

	controllerID := entity.Id

	go func() {
		<-ctx.Done()
		_ = radio.Close()
	}()

	chatIDs := newMsgIDMap(256)

	senderCount := 0
	if sendFormat != "" {
		senderCount = 1
	}
	errCh := make(chan error, 1+senderCount)

	go func() {
		errCh <- runReceiver(ctx, logger, grpcConn, radio, controllerID, radioDeviceID, chatIDs)
	}()

	// Re-request config so the receiver picks up the cached node database.
	// The receiver handles NodeInfo and ignores config/channel messages.
	_ = radio.Send(&meshpb.ToRadio{
		Msg: &meshpb.ToRadio_WantConfigId{WantConfigId: 42},
	})

	if sendFormat != "" {
		go func() {
			errCh <- runSender(ctx, logger, grpcConn, radio, channel, hopLimit, sendFormat, localNodeID, localNodeResp.Entity.Id, controllerID, chatIDs)
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

func updateServiceState(ctx context.Context, logger *slog.Logger) {
	n := activeRadios.Load()
	state := pb.DeviceState_DeviceStatePending
	if n > 0 {
		state = pb.DeviceState_DeviceStateActive
	}

	if err := controller.Push(ctx, &pb.Entity{
		Id: "meshtastic.service",
		Controller: &pb.Controller{
			Id: proto.String("meshtastic"),
		},
		Device: &pb.DeviceComponent{
			Category: proto.String("Network"),
			State:    state,
		},
		Metric: &pb.MetricComponent{Metrics: []*pb.Metric{
			{Kind: pb.MetricKind_MetricKindCount.Enum(), Unit: pb.MetricUnit_MetricUnitCount, Label: proto.String("active radios"), Id: proto.Uint32(1), Val: &pb.Metric_Uint64{Uint64: uint64(n)}},
		}},
	}); err != nil {
		logger.Error("Failed to push service state", "error", err)
	}
}

// buildRadioEntities creates a device entity for the connected radio,
// based on the config received during init.
func buildRadioEntities(cfg *RadioHandshake, deviceID, parentDeviceEntityID, configEntityID, label string) []*pb.Entity {
	meshDev := &pb.MeshtasticDevice{
		NodeNum:   &cfg.NodeNum,
		LongName:  proto.String(cfg.LongName),
		ShortName: proto.String(cfg.ShortName),
	}
	if len(cfg.PublicKey) > 0 {
		meshDev.PublicKey = cfg.PublicKey
	}
	dev := &pb.DeviceComponent{
		State:      pb.DeviceState_DeviceStateActive,
		Meshtastic: meshDev,
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
