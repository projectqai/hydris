package onvif

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
)

const WsDiscoveryAddr = "239.255.255.250:3702"

func wsDiscoveryProbeMessage() string {
	msgID := uuid.New().String()
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:%s</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`, msgID)
}

func ParseXAddrsFromResponse(data string) []string {
	var addrs []string
	for _, chunk := range strings.Split(data, "XAddrs>") {
		if !strings.Contains(chunk, "http") {
			continue
		}
		idx := strings.Index(chunk, "</")
		if idx < 0 {
			idx = len(chunk)
		}
		for _, addr := range strings.Fields(chunk[:idx]) {
			addr = strings.TrimSpace(addr)
			if strings.HasPrefix(addr, "http://") || strings.HasPrefix(addr, "https://") {
				addrs = append(addrs, addr)
			}
		}
	}
	return addrs
}

func ExtractIPFromXAddr(xaddr string) string {
	xaddr = strings.TrimPrefix(xaddr, "http://")
	xaddr = strings.TrimPrefix(xaddr, "https://")
	host, _, _ := net.SplitHostPort(xaddr)
	if host != "" {
		return host
	}
	if idx := strings.Index(xaddr, "/"); idx > 0 {
		return xaddr[:idx]
	}
	return xaddr
}

func ProbeDevices(ctx context.Context, logger *slog.Logger) []string {
	addr, err := net.ResolveUDPAddr("udp4", WsDiscoveryAddr)
	if err != nil {
		logger.Error("ws-discovery: resolve addr", "error", err)
		return nil
	}

	conn, err := net.ListenUDP("udp4", nil)
	if err != nil {
		logger.Error("ws-discovery: listen", "error", err)
		return nil
	}
	defer conn.Close() //nolint:errcheck

	msg := []byte(wsDiscoveryProbeMessage())
	if _, err := conn.WriteToUDP(msg, addr); err != nil {
		logger.Error("ws-discovery: send probe", "error", err)
		return nil
	}

	deadline := time.Now().Add(3 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetReadDeadline(deadline)

	seen := make(map[string]bool)
	var xaddrs []string
	buf := make([]byte, 8192)

	for {
		n, _, err := conn.ReadFromUDP(buf)
		if err != nil {
			break
		}
		for _, xaddr := range ParseXAddrsFromResponse(string(buf[:n])) {
			ip := ExtractIPFromXAddr(xaddr)
			if !seen[ip] {
				seen[ip] = true
				xaddrs = append(xaddrs, xaddr)
			}
		}
	}

	return xaddrs
}
