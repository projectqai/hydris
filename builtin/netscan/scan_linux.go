//go:build linux

package netscan

import (
	"bufio"
	"context"
	"encoding/binary"
	"log/slog"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin/devices"
)

// scanNetwork reads the existing ARP table immediately, then sweeps the subnet
// and reads again. Results are sent on the returned channel: the first value
// arrives instantly from cached ARP entries, the second after the sweep.
func scanNetwork(ctx context.Context, logger *slog.Logger, progress progressFunc) <-chan map[string]devices.DeviceInfo {
	ch := make(chan map[string]devices.DeviceInfo, 2)

	go func() {
		defer close(ch)

		// Send cached ARP entries immediately so devices appear instantly.
		ch <- readARPTable(logger)

		subnets := localSubnets(logger)
		if len(subnets) == 0 {
			logger.Info("no scannable subnets found")
			return
		}

		ranges := make([]string, len(subnets))
		for i, s := range subnets {
			ranges[i] = s.String()
		}
		logger.Info("scanning subnets", "ranges", ranges)

		// Sweep the subnet to trigger ARP resolution, then read again.
		pingSweep(ctx, logger, subnets, progress)
		if ctx.Err() != nil {
			return
		}

		ch <- readARPTable(logger)
	}()

	return ch
}

// localSubnets returns the IPv4 subnets for all non-loopback, up interfaces.
func localSubnets(logger *slog.Logger) []*net.IPNet {
	ifaces, err := net.Interfaces()
	if err != nil {
		logger.Error("cannot list interfaces", "error", err)
		return nil
	}

	var nets []*net.IPNet
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok || ipnet.IP.To4() == nil {
				continue
			}
			ones, bits := ipnet.Mask.Size()
			if bits-ones < 1 || bits-ones > 8 {
				logger.Debug("skipping subnet (not between /24 and /31)", "subnet", ipnet.String())
				continue
			}
			nets = append(nets, ipnet)
		}
	}
	return nets
}

// pingSweep sends a UDP probe to every host in each subnet to trigger ARP
// resolution. We use UDP port 0 which will get an ICMP port-unreachable but
// that's fine — we just need the kernel to ARP the host.
func pingSweep(ctx context.Context, logger *slog.Logger, subnets []*net.IPNet, progress progressFunc) {
	var wg sync.WaitGroup

	// Count total hosts across all subnets for progress reporting.
	var totalHosts, probed int
	for _, subnet := range subnets {
		ones, bits := subnet.Mask.Size()
		hostBits := bits - ones
		if hostBits > 10 {
			hostBits = 10
		}
		n := (1 << hostBits) - 2
		if n > 0 {
			totalHosts += n
		}
	}

	for _, subnet := range subnets {
		ones, bits := subnet.Mask.Size()
		hostBits := bits - ones
		if hostBits > 10 {
			// Cap at /22 (1024 hosts) to avoid sweeping huge subnets.
			hostBits = 10
		}
		numHosts := (1 << hostBits) - 2 // exclude network and broadcast
		if numHosts <= 0 {
			continue
		}

		ip := subnet.IP.To4()
		networkInt := binary.BigEndian.Uint32(ip) & binary.BigEndian.Uint32(net.IP(subnet.Mask).To4())

		logger.Debug("sweeping subnet", "subnet", subnet.String(), "hosts", numHosts)

		// Throttle to 10 probes per second.
		limiter := time.NewTicker(100 * time.Millisecond)

		// Start from host 100 and wrap around, since most home DHCPs
		// assign from .100 onwards.
		start := 100
		if start > numHosts {
			start = 1
		}
		for j := 0; j < numHosts; j++ {
			i := (start+j-1)%numHosts + 1
			select {
			case <-ctx.Done():
				limiter.Stop()
				wg.Wait()
				return
			case <-limiter.C:
			}

			hostIP := make(net.IP, 4)
			binary.BigEndian.PutUint32(hostIP, networkInt+uint32(i))

			wg.Add(1)
			go func(target string) {
				defer wg.Done()
				probeHost(target)
			}(hostIP.String())

			probed++
			if totalHosts > 0 && progress != nil {
				progress(float64(probed) / float64(totalHosts))
			}
		}
		limiter.Stop()
	}

	wg.Wait()
	// Give the kernel a moment to populate ARP entries.
	time.Sleep(500 * time.Millisecond)
}

// probeHost sends a single UDP packet to trigger ARP resolution.
func probeHost(ip string) {
	conn, err := net.DialTimeout("udp4", ip+":0", 200*time.Millisecond)
	if err != nil {
		return
	}
	_, _ = conn.Write([]byte{0})
	_ = conn.Close()
}

// readARPTable parses /proc/net/arp and returns reachable hosts.
// Format: IP address  HW type  Flags  HW address            Mask  Device
func readARPTable(logger *slog.Logger) map[string]devices.DeviceInfo {
	f, err := os.Open("/proc/net/arp")
	if err != nil {
		logger.Error("cannot read ARP table", "error", err)
		return nil
	}
	defer f.Close()

	result := make(map[string]devices.DeviceInfo)
	scanner := bufio.NewScanner(f)
	scanner.Scan() // skip header

	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 6 {
			continue
		}
		ip := fields[0]
		flags := fields[2]
		mac := fields[3]

		// Flags 0x2 means reachable. Skip incomplete entries (0x0).
		if flags == "0x0" || mac == "00:00:00:00:00:00" {
			continue
		}

		// Use MAC as stable key since IPs can change (DHCP).
		key := strings.ReplaceAll(mac, ":", "")
		vendor := lookupOUI(mac)

		// Only emit devices with a known MAC vendor to filter out
		// random infrastructure (routers, switches, etc.).
		if vendor == "" {
			continue
		}

		label := vendor + " " + ip

		result[key] = devices.DeviceInfo{
			Name:  key,
			Label: label,
			IP: &devices.IPDescriptor{
				Host: ip,
			},
			Ethernet: &devices.EthernetDescriptor{
				MACAddress: mac,
				Vendor:     vendor,
			},
		}
	}

	return result
}
