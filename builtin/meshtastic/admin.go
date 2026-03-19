package meshtastic

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"time"

	"github.com/projectqai/hydris/builtin/meshtastic/meshpb"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// radioSettings holds the desired radio configuration extracted from a
// configurable's Value fields. nil pointers mean "not set by user".
type radioSettings struct {
	// lora
	region      *string
	modemPreset *string
	txPower     *int32
	txEnabled   *bool

	// device
	role            *string
	rebroadcastMode *string

	// position
	positionIntervalSecs *uint32
	positionSmart        *bool
	gpsMode              *string

	// owner
	ownerLongName  *string
	ownerShortName *string

	// channel (primary, index 0)
	channelPSK  *string // base64
	channelName *string
}

// parseRadioSettings extracts radio configuration fields from a config entity's
// Value, comparing against the radio's current state from the handshake.
// Only fields that are present in the config AND differ from the current
// radio state are returned as "desired". This prevents state feedback
// (e.g. readRadioState values that ended up in Config) from being
// re-applied as changes.
func parseRadioSettings(fields map[string]*structpb.Value, currentState map[string]interface{}) *radioSettings {
	if fields == nil {
		return nil
	}
	rs := &radioSettings{}
	any := false

	// sameStr checks if a config string field matches the current radio state.
	sameStr := func(key, val string) bool {
		if cur, ok := currentState[key]; ok {
			return cur == val
		}
		return false
	}
	// sameNum checks if a config number field matches the current radio state.
	sameNum := func(key string, val float64) bool {
		if cur, ok := currentState[key]; ok {
			if cf, ok := cur.(float64); ok {
				return cf == val
			}
		}
		return false
	}
	// sameBool checks if a config bool field matches the current radio state.
	sameBool := func(key string, val bool) bool {
		if cur, ok := currentState[key]; ok {
			if cb, ok := cur.(bool); ok {
				return cb == val
			}
		}
		return false
	}

	if v, ok := fields["radio_region"]; ok && v.GetStringValue() != "" {
		s := v.GetStringValue()
		if !sameStr("radio_region", s) {
			rs.region = &s
			any = true
		}
	}
	if v, ok := fields["radio_preset"]; ok && v.GetStringValue() != "" {
		s := v.GetStringValue()
		if !sameStr("radio_preset", s) {
			rs.modemPreset = &s
			any = true
		}
	}
	if v, ok := fields["radio_tx_power"]; ok {
		n := v.GetNumberValue()
		// Skip zero — the UI fills in 0 as a schema default for fields
		// the user never touched. Zero means "max legal default" anyway.
		if n != 0 && !sameNum("radio_tx_power", n) {
			n32 := int32(n)
			rs.txPower = &n32
			any = true
		}
	}
	if v, ok := fields["radio_tx_enabled"]; ok {
		b := v.GetBoolValue()
		// Only process when true — the UI fills in false as a default.
		// Disabling TX is destructive; require explicit true→false via
		// a config that already had tx_enabled=true previously.
		if b && !sameBool("radio_tx_enabled", b) {
			rs.txEnabled = &b
			any = true
		}
	}
	if v, ok := fields["device_role"]; ok && v.GetStringValue() != "" {
		s := v.GetStringValue()
		if !sameStr("device_role", s) {
			rs.role = &s
			any = true
		}
	}
	if v, ok := fields["device_rebroadcast"]; ok && v.GetStringValue() != "" {
		s := v.GetStringValue()
		if !sameStr("device_rebroadcast", s) {
			rs.rebroadcastMode = &s
			any = true
		}
	}
	if v, ok := fields["position_interval_secs"]; ok {
		n := v.GetNumberValue()
		// Skip zero — means "use default 15min", same as not setting it.
		if n != 0 && !sameNum("position_interval_secs", n) {
			n32 := uint32(n)
			rs.positionIntervalSecs = &n32
			any = true
		}
	}
	if v, ok := fields["position_smart"]; ok {
		b := v.GetBoolValue()
		// Only process when true — false is the proto default and the
		// UI fills it in for untouched fields.
		if b && !sameBool("position_smart", b) {
			rs.positionSmart = &b
			any = true
		}
	}
	if v, ok := fields["position_gps_mode"]; ok && v.GetStringValue() != "" {
		s := v.GetStringValue()
		if !sameStr("position_gps_mode", s) {
			rs.gpsMode = &s
			any = true
		}
	}
	if v, ok := fields["owner_long_name"]; ok && v.GetStringValue() != "" {
		s := v.GetStringValue()
		if !sameStr("owner_long_name", s) {
			rs.ownerLongName = &s
			any = true
		}
	}
	if v, ok := fields["owner_short_name"]; ok && v.GetStringValue() != "" {
		s := v.GetStringValue()
		if !sameStr("owner_short_name", s) {
			rs.ownerShortName = &s
			any = true
		}
	}
	if v, ok := fields["channel_psk"]; ok && v.GetStringValue() != "" {
		s := v.GetStringValue()
		if !sameStr("channel_psk", s) {
			rs.channelPSK = &s
			any = true
		}
	}
	if v, ok := fields["channel_name"]; ok && v.GetStringValue() != "" {
		s := v.GetStringValue()
		if !sameStr("channel_name", s) {
			rs.channelName = &s
			any = true
		}
	}

	if !any {
		return nil
	}
	return rs
}

// applyRadioConfig sends admin messages to configure the radio based on the
// desired settings. It reads the current config from the handshake, merges
// user values, and sends only changed sections.
//
// LoRa config changes (region, preset, tx power, tx enabled) require a
// transactional edit (BeginEditSettings / CommitEditSettings) which causes
// the device firmware to save and reboot. All other changes (device role,
// position, owner, channel) are sent as individual admin messages and take
// effect without rebooting the device.
func applyRadioConfig(logger *slog.Logger, radio *Radio, handshake *RadioHandshake, desired *radioSettings) error {
	if desired == nil {
		return nil
	}

	nodeNum := handshake.NodeNum

	// Decode current config from handshake blobs.
	curLora := &meshpb.LoraConfig{}
	curDevice := &meshpb.DeviceConfig{}
	curPosition := &meshpb.PositionConfig{}
	for _, cfg := range handshake.Configs {
		switch {
		case cfg.GetLora() != nil:
			_ = proto.Unmarshal(cfg.GetLora(), curLora)
		case cfg.GetDevice() != nil:
			_ = proto.Unmarshal(cfg.GetDevice(), curDevice)
		case cfg.GetPosition() != nil:
			_ = proto.Unmarshal(cfg.GetPosition(), curPosition)
		}
	}

	// Separate LoRa changes (require transaction + device reboot) from
	// soft changes (can be applied individually without reboot).
	var loraMsgs []*meshpb.AdminMsg
	var softMsgs []*meshpb.AdminMsg

	if lora := mergeLora(logger, curLora, desired); lora != nil {
		loraMsgs = append(loraMsgs, &meshpb.AdminMsg{
			PayloadVariant: &meshpb.AdminMsg_SetConfig{
				SetConfig: &meshpb.CfgSet{
					PayloadVariant: &meshpb.CfgSet_Lora{Lora: lora},
				},
			},
		})
	}

	if dev := mergeDevice(logger, curDevice, desired); dev != nil {
		softMsgs = append(softMsgs, &meshpb.AdminMsg{
			PayloadVariant: &meshpb.AdminMsg_SetConfig{
				SetConfig: &meshpb.CfgSet{
					PayloadVariant: &meshpb.CfgSet_Device{Device: dev},
				},
			},
		})
	}

	if pos := mergePosition(logger, curPosition, desired); pos != nil {
		softMsgs = append(softMsgs, &meshpb.AdminMsg{
			PayloadVariant: &meshpb.AdminMsg_SetConfig{
				SetConfig: &meshpb.CfgSet{
					PayloadVariant: &meshpb.CfgSet_Position{Position: pos},
				},
			},
		})
	}

	if owner := buildOwner(logger, handshake, desired); owner != nil {
		softMsgs = append(softMsgs, &meshpb.AdminMsg{
			PayloadVariant: &meshpb.AdminMsg_SetOwner{SetOwner: owner},
		})
	}

	if ch := buildChannel(logger, handshake, desired); ch != nil {
		softMsgs = append(softMsgs, &meshpb.AdminMsg{
			PayloadVariant: &meshpb.AdminMsg_SetChannel{SetChannel: ch},
		})
	}

	if len(loraMsgs) == 0 && len(softMsgs) == 0 {
		logger.Info("No radio config changes to apply")
		return nil
	}

	// Apply soft changes individually — no transaction, no reboot.
	if len(softMsgs) > 0 {
		logger.Info("Applying soft radio config (no reboot)", "sections", len(softMsgs))
		for _, msg := range softMsgs {
			if err := sendAdminPacket(radio, nodeNum, msg); err != nil {
				return fmt.Errorf("send admin: %w", err)
			}
			time.Sleep(100 * time.Millisecond)
		}
	}

	// Apply LoRa changes in a transaction — device will save and reboot.
	if len(loraMsgs) > 0 {
		logger.Info("Applying LoRa config (device will reboot)", "sections", len(loraMsgs))

		if err := sendAdminPacket(radio, nodeNum, &meshpb.AdminMsg{
			PayloadVariant: &meshpb.AdminMsg_BeginEditSettings{BeginEditSettings: true},
		}); err != nil {
			return fmt.Errorf("begin edit: %w", err)
		}
		time.Sleep(100 * time.Millisecond)

		for _, msg := range loraMsgs {
			if err := sendAdminPacket(radio, nodeNum, msg); err != nil {
				return fmt.Errorf("send admin: %w", err)
			}
			time.Sleep(100 * time.Millisecond)
		}

		logger.Info("Committing LoRa config")
		if err := sendAdminPacket(radio, nodeNum, &meshpb.AdminMsg{
			PayloadVariant: &meshpb.AdminMsg_CommitEditSettings{CommitEditSettings: true},
		}); err != nil {
			return fmt.Errorf("commit edit: %w", err)
		}
	}

	logger.Info("Radio config applied successfully")
	return nil
}

func sendAdminPacket(radio *Radio, nodeNum uint32, msg *meshpb.AdminMsg) error {
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal admin: %w", err)
	}

	return radio.Send(&meshpb.ToRadio{
		Msg: &meshpb.ToRadio_Packet{
			Packet: &meshpb.Packet{
				Dst:      nodeNum,
				Ch:       0,
				HopLimit: 3,
				Id:       rand.Uint32(),
				WantAck:  true,
				Body: &meshpb.Packet_Decoded{
					Decoded: &meshpb.Payload{
						Data: data,
						Port: meshpb.Port_PORT_ADMIN,
					},
				},
			},
		},
	})
}

// --- merge helpers: return nil if nothing changed ---

// mergeLora returns a new LoraConfig only if desired values differ from current.
func mergeLora(logger *slog.Logger, cur *meshpb.LoraConfig, desired *radioSettings) *meshpb.LoraConfig {
	if desired.region == nil && desired.modemPreset == nil && desired.txPower == nil && desired.txEnabled == nil {
		return nil
	}

	out := proto.Clone(cur).(*meshpb.LoraConfig)
	changed := false

	if desired.region != nil {
		if v, ok := regionMap[*desired.region]; ok && v != cur.Region {
			logger.Info("Setting LoRa region", "region", *desired.region)
			out.Region = v
			changed = true
		}
	}
	if desired.modemPreset != nil {
		if v, ok := presetMap[*desired.modemPreset]; ok && v != cur.ModemPreset {
			logger.Info("Setting modem preset", "preset", *desired.modemPreset)
			out.UsePreset = true
			out.ModemPreset = v
			changed = true
		}
	}
	if desired.txPower != nil && *desired.txPower != cur.TxPower {
		logger.Info("Setting TX power", "from", cur.TxPower, "to", *desired.txPower)
		out.TxPower = *desired.txPower
		changed = true
	}
	if desired.txEnabled != nil && *desired.txEnabled != cur.TxEnabled {
		logger.Info("Setting TX enabled", "from", cur.TxEnabled, "to", *desired.txEnabled)
		out.TxEnabled = *desired.txEnabled
		changed = true
	}

	if !changed {
		return nil
	}
	return out
}

// mergeDevice returns a new DeviceConfig only if desired values differ from current.
func mergeDevice(logger *slog.Logger, cur *meshpb.DeviceConfig, desired *radioSettings) *meshpb.DeviceConfig {
	if desired.role == nil && desired.rebroadcastMode == nil {
		return nil
	}

	out := proto.Clone(cur).(*meshpb.DeviceConfig)
	changed := false

	if desired.role != nil {
		if v, ok := roleMap[*desired.role]; ok && v != cur.Role {
			logger.Info("Setting device role", "role", *desired.role)
			out.Role = v
			changed = true
		}
	}
	if desired.rebroadcastMode != nil {
		if v, ok := rebroadcastMap[*desired.rebroadcastMode]; ok && v != cur.RebroadcastMode {
			logger.Info("Setting rebroadcast mode", "mode", *desired.rebroadcastMode)
			out.RebroadcastMode = v
			changed = true
		}
	}

	if !changed {
		return nil
	}
	return out
}

// mergePosition returns a new PositionConfig only if desired values differ from current.
func mergePosition(logger *slog.Logger, cur *meshpb.PositionConfig, desired *radioSettings) *meshpb.PositionConfig {
	if desired.positionIntervalSecs == nil && desired.positionSmart == nil && desired.gpsMode == nil {
		return nil
	}

	out := proto.Clone(cur).(*meshpb.PositionConfig)
	changed := false

	if desired.positionIntervalSecs != nil && *desired.positionIntervalSecs != cur.PositionBroadcastSecs {
		logger.Info("Setting position broadcast interval", "from", cur.PositionBroadcastSecs, "to", *desired.positionIntervalSecs)
		out.PositionBroadcastSecs = *desired.positionIntervalSecs
		changed = true
	}
	if desired.positionSmart != nil && *desired.positionSmart != cur.PositionBroadcastSmartEnabled {
		logger.Info("Setting smart position broadcast", "from", cur.PositionBroadcastSmartEnabled, "to", *desired.positionSmart)
		out.PositionBroadcastSmartEnabled = *desired.positionSmart
		changed = true
	}
	if desired.gpsMode != nil {
		if v, ok := gpsModeMap[*desired.gpsMode]; ok && v != cur.GpsMode {
			logger.Info("Setting GPS mode", "mode", *desired.gpsMode)
			out.GpsMode = v
			changed = true
		}
	}

	if !changed {
		return nil
	}
	return out
}

// buildOwner returns an Owner only if desired values differ from current handshake.
func buildOwner(logger *slog.Logger, handshake *RadioHandshake, desired *radioSettings) *meshpb.Owner {
	if desired.ownerLongName == nil && desired.ownerShortName == nil {
		return nil
	}

	longName := handshake.LongName
	shortName := handshake.ShortName
	changed := false

	if desired.ownerLongName != nil && *desired.ownerLongName != longName {
		logger.Info("Setting owner long name", "name", *desired.ownerLongName)
		longName = *desired.ownerLongName
		changed = true
	}
	if desired.ownerShortName != nil && *desired.ownerShortName != shortName {
		logger.Info("Setting owner short name", "name", *desired.ownerShortName)
		shortName = *desired.ownerShortName
		changed = true
	}

	if !changed {
		return nil
	}
	return &meshpb.Owner{
		Id:        fmt.Sprintf("!%08x", handshake.NodeNum),
		LongName:  longName,
		ShortName: shortName,
	}
}

// buildChannel returns a ChanCfg only if desired values differ from current handshake.
func buildChannel(logger *slog.Logger, handshake *RadioHandshake, desired *radioSettings) *meshpb.ChanCfg {
	if desired.channelPSK == nil && desired.channelName == nil {
		return nil
	}

	// Decode current primary channel settings.
	var curSettings meshpb.ChanSettings
	for _, ch := range handshake.Channels {
		if ch.Index == 0 {
			_ = proto.Unmarshal(ch.Settings, &curSettings)
			break
		}
	}

	changed := false
	settings := &meshpb.ChanSettings{
		Psk:  curSettings.Psk,
		Name: curSettings.Name,
	}

	if desired.channelName != nil && *desired.channelName != curSettings.Name {
		logger.Info("Setting channel name", "name", *desired.channelName)
		settings.Name = *desired.channelName
		changed = true
	}
	if desired.channelPSK != nil {
		if psk, err := base64.StdEncoding.DecodeString(*desired.channelPSK); err == nil {
			if base64.StdEncoding.EncodeToString(curSettings.Psk) != *desired.channelPSK {
				logger.Info("Setting channel PSK")
				settings.Psk = psk
				changed = true
			}
		}
	}

	if !changed {
		return nil
	}
	return &meshpb.ChanCfg{
		Index:    0,
		Role:     meshpb.ChannelRole_CH_PRIMARY,
		Settings: settings,
	}
}

// --- string-to-enum maps ---

var regionMap = map[string]meshpb.RegionCode{
	"US":      meshpb.RegionCode_REGION_US,
	"EU_433":  meshpb.RegionCode_REGION_EU_433,
	"EU_868":  meshpb.RegionCode_REGION_EU_868,
	"CN":      meshpb.RegionCode_REGION_CN,
	"JP":      meshpb.RegionCode_REGION_JP,
	"ANZ":     meshpb.RegionCode_REGION_ANZ,
	"KR":      meshpb.RegionCode_REGION_KR,
	"TW":      meshpb.RegionCode_REGION_TW,
	"RU":      meshpb.RegionCode_REGION_RU,
	"IN":      meshpb.RegionCode_REGION_IN,
	"NZ_865":  meshpb.RegionCode_REGION_NZ_865,
	"TH":      meshpb.RegionCode_REGION_TH,
	"LORA_24": meshpb.RegionCode_REGION_LORA_24,
	"UA_433":  meshpb.RegionCode_REGION_UA_433,
	"UA_868":  meshpb.RegionCode_REGION_UA_868,
	"MY_433":  meshpb.RegionCode_REGION_MY_433,
	"MY_919":  meshpb.RegionCode_REGION_MY_919,
	"SG_923":  meshpb.RegionCode_REGION_SG_923,
	"PH_433":  meshpb.RegionCode_REGION_PH_433,
	"PH_868":  meshpb.RegionCode_REGION_PH_868,
	"PH_915":  meshpb.RegionCode_REGION_PH_915,
}

var presetMap = map[string]meshpb.ModemPreset{
	"long_fast":     meshpb.ModemPreset_MODEM_LONG_FAST,
	"medium_slow":   meshpb.ModemPreset_MODEM_MEDIUM_SLOW,
	"medium_fast":   meshpb.ModemPreset_MODEM_MEDIUM_FAST,
	"short_slow":    meshpb.ModemPreset_MODEM_SHORT_SLOW,
	"short_fast":    meshpb.ModemPreset_MODEM_SHORT_FAST,
	"long_moderate": meshpb.ModemPreset_MODEM_LONG_MODERATE,
	"short_turbo":   meshpb.ModemPreset_MODEM_SHORT_TURBO,
	"long_turbo":    meshpb.ModemPreset_MODEM_LONG_TURBO,
}

var roleMap = map[string]meshpb.DeviceRole{
	"client":        meshpb.DeviceRole_ROLE_CLIENT,
	"client_mute":   meshpb.DeviceRole_ROLE_CLIENT_MUTE,
	"router":        meshpb.DeviceRole_ROLE_ROUTER,
	"tracker":       meshpb.DeviceRole_ROLE_TRACKER,
	"sensor":        meshpb.DeviceRole_ROLE_SENSOR,
	"tak":           meshpb.DeviceRole_ROLE_TAK,
	"client_hidden": meshpb.DeviceRole_ROLE_CLIENT_HIDDEN,
	"tak_tracker":   meshpb.DeviceRole_ROLE_TAK_TRACKER,
	"router_late":   meshpb.DeviceRole_ROLE_ROUTER_LATE,
}

var rebroadcastMap = map[string]meshpb.RebroadcastMode{
	"all":        meshpb.RebroadcastMode_REBROADCAST_ALL,
	"local_only": meshpb.RebroadcastMode_REBROADCAST_LOCAL_ONLY,
	"known_only": meshpb.RebroadcastMode_REBROADCAST_KNOWN_ONLY,
	"none":       meshpb.RebroadcastMode_REBROADCAST_NONE,
}

var gpsModeMap = map[string]meshpb.GpsMode{
	"disabled":    meshpb.GpsMode_GPS_DISABLED,
	"enabled":     meshpb.GpsMode_GPS_ENABLED,
	"not_present": meshpb.GpsMode_GPS_NOT_PRESENT,
}

// --- reverse maps (enum → config string) ---

func reverseRegion(v meshpb.RegionCode) string {
	for k, rv := range regionMap {
		if rv == v {
			return k
		}
	}
	return ""
}

func reversePreset(v meshpb.ModemPreset) string {
	for k, rv := range presetMap {
		if rv == v {
			return k
		}
	}
	return ""
}

func reverseRole(v meshpb.DeviceRole) string {
	for k, rv := range roleMap {
		if rv == v {
			return k
		}
	}
	return ""
}

func reverseRebroadcast(v meshpb.RebroadcastMode) string {
	for k, rv := range rebroadcastMap {
		if rv == v {
			return k
		}
	}
	return ""
}

func reverseGpsMode(v meshpb.GpsMode) string {
	for k, rv := range gpsModeMap {
		if rv == v {
			return k
		}
	}
	return ""
}

// readRadioState decodes the device's current config from the handshake and
// returns it as a flat map suitable for structpb.NewStruct. This allows the
// UI to display what the radio currently has configured.
func readRadioState(handshake *RadioHandshake) map[string]interface{} {
	m := map[string]interface{}{}

	// Decode config blobs.
	lora := &meshpb.LoraConfig{}
	dev := &meshpb.DeviceConfig{}
	pos := &meshpb.PositionConfig{}
	for _, cfg := range handshake.Configs {
		switch {
		case cfg.GetLora() != nil:
			_ = proto.Unmarshal(cfg.GetLora(), lora)
		case cfg.GetDevice() != nil:
			_ = proto.Unmarshal(cfg.GetDevice(), dev)
		case cfg.GetPosition() != nil:
			_ = proto.Unmarshal(cfg.GetPosition(), pos)
		}
	}

	// Lora.
	if s := reverseRegion(lora.Region); s != "" {
		m["radio_region"] = s
	}
	if s := reversePreset(lora.ModemPreset); s != "" {
		m["radio_preset"] = s
	}
	m["radio_tx_power"] = float64(lora.TxPower)
	m["radio_tx_enabled"] = lora.TxEnabled

	// Device.
	if s := reverseRole(dev.Role); s != "" {
		m["device_role"] = s
	}
	if s := reverseRebroadcast(dev.RebroadcastMode); s != "" {
		m["device_rebroadcast"] = s
	}

	// Position.
	m["position_interval_secs"] = float64(pos.PositionBroadcastSecs)
	m["position_smart"] = pos.PositionBroadcastSmartEnabled
	if s := reverseGpsMode(pos.GpsMode); s != "" {
		m["position_gps_mode"] = s
	}

	// Owner (from handshake peer info, not a config blob).
	if handshake.LongName != "" {
		m["owner_long_name"] = handshake.LongName
	}
	if handshake.ShortName != "" {
		m["owner_short_name"] = handshake.ShortName
	}

	// Channel (primary, index 0).
	for _, ch := range handshake.Channels {
		if ch.Index == 0 {
			settings := &meshpb.ChanSettings{}
			if err := proto.Unmarshal(ch.Settings, settings); err == nil {
				if settings.Name != "" {
					m["channel_name"] = settings.Name
				}
				if len(settings.Psk) > 0 {
					m["channel_psk"] = base64.StdEncoding.EncodeToString(settings.Psk)
				}
			}
			break
		}
	}

	return m
}
