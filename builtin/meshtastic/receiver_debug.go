package meshtastic

import (
	"encoding/hex"
	"fmt"
	"log/slog"

	"github.com/projectqai/hydris/builtin/meshtastic/meshpb"
	"google.golang.org/protobuf/proto"
)

func debugFromRadio(logger *slog.Logger, msg *meshpb.FromRadio) {
	switch v := msg.GetMsg().(type) {
	case *meshpb.FromRadio_Packet:
		p := v.Packet
		decoded := p.GetDecoded()
		if decoded != nil {
			portName := decoded.GetPort().String()
			logger.Debug("FromRadio packet",
				"from", fmt.Sprintf("!%08x", p.GetSrc()),
				"to", fmt.Sprintf("!%08x", p.GetDst()),
				"id", p.GetId(),
				"channel", p.GetCh(),
				"hopLimit", p.GetHopLimit(),
				"hopStart", p.GetHopStart(),
				"rxSnr", p.GetRxSnr(),
				"rxRssi", p.GetRxRssi(),
				"port", portName,
				"payloadLen", len(decoded.GetData()),
				"payloadHex", hex.EncodeToString(decoded.GetData()),
			)
			debugDecodedPayload(logger, decoded)
		} else if enc := p.GetEncrypted(); len(enc) > 0 {
			logger.Debug("FromRadio encrypted packet",
				"from", fmt.Sprintf("!%08x", p.GetSrc()),
				"to", fmt.Sprintf("!%08x", p.GetDst()),
				"id", p.GetId(),
				"channel", p.GetCh(),
				"encLen", len(enc),
			)
		}
	case *meshpb.FromRadio_Self:
		logger.Debug("FromRadio MyInfo",
			"myNodeNum", fmt.Sprintf("!%08x", v.Self.GetNodeNum()),
		)
	case *meshpb.FromRadio_Node:
		info := v.Node
		attrs := []any{
			"num", fmt.Sprintf("!%08x", info.GetNum()),
			"lastHeard", info.GetLastHeard(),
		}
		if info.Peer != nil {
			attrs = append(attrs,
				"longName", info.Peer.GetLongName(),
				"shortName", info.Peer.GetShortName(),
				"macaddr", info.Peer.GetMac(),
				"hwModel", info.Peer.GetHw(),
			)
		}
		if info.Position != nil {
			attrs = append(attrs,
				"lat", float64(info.Position.GetLatI())*1e-7,
				"lon", float64(info.Position.GetLonI())*1e-7,
				"alt", info.Position.GetAlt(),
			)
		}
		logger.Debug("FromRadio NodeInfo", attrs...)
	case *meshpb.FromRadio_Config:
		logger.Debug("FromRadio Config", "config", fmt.Sprintf("%T", v.Config.GetSection()))
	case *meshpb.FromRadio_ModConfig:
		logger.Debug("FromRadio ModuleConfig", "config", fmt.Sprintf("%T", v.ModConfig.GetSection()))
	case *meshpb.FromRadio_Channel:
		ch := v.Channel
		logger.Debug("FromRadio Channel",
			"index", ch.GetIndex(),
			"role", ch.GetRole(),
		)
	case *meshpb.FromRadio_ConfigCompleteId:
		logger.Debug("FromRadio ConfigComplete", "id", v.ConfigCompleteId)
	case *meshpb.FromRadio_Log:
		logger.Debug("FromRadio Log", "message", v.Log.GetMessage(), "level", v.Log.GetLevel())
	case *meshpb.FromRadio_Queue:
		logger.Debug("FromRadio QueueStatus",
			"free", v.Queue.GetFree(),
			"maxlen", v.Queue.GetMaxlen(),
		)
	default:
		logger.Debug("FromRadio unknown variant", "type", fmt.Sprintf("%T", v))
	}
}

func debugDecodedPayload(logger *slog.Logger, decoded *meshpb.Payload) {
	payload := decoded.GetData()
	switch decoded.GetPort() {
	case meshpb.Port_PORT_TAK:
		var tp meshpb.TAKPacket
		if err := proto.Unmarshal(payload, &tp); err != nil {
			logger.Debug("  ATAK_PLUGIN unmarshal failed", "error", err)
			return
		}
		attrs := []any{}
		if tp.Contact != nil {
			attrs = append(attrs, "callsign", tp.Contact.GetCallsign(), "deviceCallsign", tp.Contact.GetDeviceCallsign())
		}
		if tp.Group != nil {
			attrs = append(attrs, "role", tp.Group.GetRole(), "team", tp.Group.GetTeam())
		}
		if tp.Status != nil {
			attrs = append(attrs, "battery", tp.Status.GetBattery())
		}
		if pli := tp.GetPli(); pli != nil {
			attrs = append(attrs,
				"variant", "PLI",
				"lat", float64(pli.GetLatI())*1e-7,
				"lon", float64(pli.GetLonI())*1e-7,
				"alt", pli.GetAlt(),
				"speed", pli.GetSpeed(),
				"course", pli.GetCourse(),
			)
		} else if chat := tp.GetChat(); chat != nil {
			attrs = append(attrs,
				"variant", "GeoChat",
				"message", chat.GetMessage(),
				"to", chat.GetTo(),
			)
		} else {
			attrs = append(attrs, "variant", "unknown")
		}
		logger.Debug("  ATAK_PLUGIN decoded", attrs...)

	case meshpb.Port_PORT_POSITION:
		var pos meshpb.Pos
		if err := proto.Unmarshal(payload, &pos); err != nil {
			logger.Debug("  POSITION_APP unmarshal failed", "error", err)
			return
		}
		logger.Debug("  POSITION_APP decoded",
			"lat", float64(pos.GetLatI())*1e-7,
			"lon", float64(pos.GetLonI())*1e-7,
			"alt", pos.GetAlt(),
			"time", pos.GetTime(),
			"satsInView", pos.GetSats(),
		)

	case meshpb.Port_PORT_NODEINFO:
		var user meshpb.Peer
		if err := proto.Unmarshal(payload, &user); err != nil {
			logger.Debug("  NODEINFO_APP unmarshal failed", "error", err)
			return
		}
		logger.Debug("  NODEINFO_APP decoded",
			"longName", user.GetLongName(),
			"shortName", user.GetShortName(),
			"hwModel", user.GetHw(),
			"role", user.GetRole(),
		)

	case meshpb.Port_PORT_TEXT:
		logger.Debug("  TEXT_MESSAGE_APP decoded", "text", string(payload))

	case meshpb.Port_PORT_TELEMETRY:
		var tel meshpb.Telem
		if err := proto.Unmarshal(payload, &tel); err != nil {
			logger.Debug("  TELEMETRY_APP unmarshal failed", "error", err)
			return
		}
		if dm := tel.GetDevice(); dm != nil {
			logger.Debug("  TELEMETRY_APP DeviceMetrics",
				"batteryLevel", dm.GetBatteryLevel(),
				"voltage", dm.GetVoltage(),
				"channelUtilization", dm.GetChUtil(),
				"airUtilTx", dm.GetAirUtilTx(),
				"uptimeSeconds", dm.GetUptime(),
			)
		} else {
			logger.Debug("  TELEMETRY_APP decoded", "variant", fmt.Sprintf("%T", tel.GetReading()))
		}

	case meshpb.Port_PORT_TAK_FORWARDER:
		if isFTNPacket(payload) {
			block, err := parseFTNDataBlock(payload)
			if err != nil {
				logger.Debug("  ATAK_FORWARDER FTN parse failed", "error", err)
				return
			}
			logger.Debug("  ATAK_FORWARDER FTN block",
				"xferID", block.transferID,
				"seed", block.seed,
				"K", block.sourceBlockCount,
				"totalLen", block.totalLength,
				"payloadLen", len(block.payload),
			)
		} else {
			logger.Debug("  ATAK_FORWARDER non-FTN", "len", len(payload), "hex", hex.EncodeToString(payload))
		}

	default:
		logger.Debug("  payload not decoded", "port", decoded.GetPort().String(), "len", len(payload))
	}
}
