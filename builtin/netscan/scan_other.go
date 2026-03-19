//go:build !linux && !windows

package netscan

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin/devices"
)

var arpLineRe = regexp.MustCompile(`\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]+)`)

// scanNetwork reads the existing ARP table immediately, then sweeps the subnet
// and reads again. Results are sent on the returned channel: the first value
// arrives instantly from cached ARP entries, the second after the sweep.
func scanNetwork(ctx context.Context, logger *slog.Logger, progress progressFunc) <-chan map[string]devices.DeviceInfo {
	ch := make(chan map[string]devices.DeviceInfo, 2)

	go func() {
		defer close(ch)

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

		pingSweep(ctx, logger, subnets, progress)
		if ctx.Err() != nil {
			return
		}
		ch <- readARPTable(logger)
	}()

	return ch
}

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
			hostBits = 10
		}
		numHosts := (1 << hostBits) - 2
		if numHosts <= 0 {
			continue
		}

		ip := subnet.IP.To4()
		mask := net.IP(subnet.Mask).To4()
		var networkInt uint32
		for i := 0; i < 4; i++ {
			networkInt = (networkInt << 8) | uint32(ip[i]&mask[i])
		}

		logger.Debug("sweeping subnet", "subnet", subnet.String(), "hosts", numHosts)

		// Throttle to 10 probes per second.
		limiter := time.NewTicker(100 * time.Millisecond)

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

			n := networkInt + uint32(i)
			target := fmt.Sprintf("%d.%d.%d.%d", (n>>24)&0xff, (n>>16)&0xff, (n>>8)&0xff, n&0xff)

			wg.Add(1)
			go func(t string) {
				defer wg.Done()
				probeHost(t)
			}(target)

			probed++
			if totalHosts > 0 && progress != nil {
				progress(float64(probed) / float64(totalHosts))
			}
		}
		limiter.Stop()
	}

	wg.Wait()
	time.Sleep(500 * time.Millisecond)
}

func probeHost(ip string) {
	conn, err := net.DialTimeout("udp4", ip+":0", 200*time.Millisecond)
	if err != nil {
		return
	}
	_, _ = conn.Write([]byte{0})
	_ = conn.Close()
}

// readARPTable parses output of `arp -a` which is available on macOS, Windows,
// and most Unix systems.
func readARPTable(logger *slog.Logger) map[string]devices.DeviceInfo {
	out, err := exec.Command("arp", "-a").Output()
	if err != nil {
		logger.Error("arp -a failed", "error", err)
		return nil
	}

	result := make(map[string]devices.DeviceInfo)
	for _, line := range strings.Split(string(out), "\n") {
		m := arpLineRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		ip := m[1]
		mac := m[2]

		if mac == "ff:ff:ff:ff:ff:ff" || mac == "(incomplete)" {
			continue
		}

		key := strings.ReplaceAll(strings.ReplaceAll(mac, ":", ""), "-", "")
		vendor := lookupOUI(mac)

		label := ip
		if vendor != "" {
			label = vendor + " " + ip
		}

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
