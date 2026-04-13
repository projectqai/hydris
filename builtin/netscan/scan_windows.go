//go:build windows

package netscan

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

var (
	iphlpapi        = syscall.NewLazyDLL("iphlpapi.dll")
	pGetIpNetTable2 = iphlpapi.NewProc("GetIpNetTable2")
	pFreeMibTable   = iphlpapi.NewProc("FreeMibTable")
)

const (
	afINET = 2 // AF_INET (IPv4)

	// NL_NEIGHBOR_STATE values
	nlnsReachable = 4
	nlnsStale     = 5
	nlnsDelay     = 6
	nlnsProbe     = 7
	nlnsPermanent = 8
)

// MIB_IPNET_ROW2 simplified for IPv4 only.
// Full struct is 88 bytes on 64-bit Windows.
type mibIPNetRow2 struct {
	// SOCKADDR_INET Address (28 bytes)
	addressFamily uint16
	port          uint16
	addr          [4]byte // IPv4 address
	_pad1         [20]byte

	interfaceIndex uint32
	interfaceLUID  uint64

	physicalAddress    [32]byte
	physicalAddressLen uint32

	state uint32
	flags uint32

	lastReachable   uint32
	lastUnreachable uint32
}

const sizeofMibIPNetRow2 = 88

func scanNetwork(ctx context.Context, logger *slog.Logger, progress progressFunc) <-chan map[string]*pb.Entity {
	ch := make(chan map[string]*pb.Entity, 2)

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

// mibIPNetTable2 is the header of the MIB_IPNET_TABLE2 structure.
type mibIPNetTable2 struct {
	NumEntries uint32
	_          uint32 // padding for 8-byte alignment
	// Followed by NumEntries × mibIPNetRow2
}

// readARPTable uses the Windows IP Helper API (GetIpNetTable2) to read
// the system ARP table without spawning a subprocess.
func readARPTable(logger *slog.Logger) map[string]*pb.Entity {
	var tablePtr *mibIPNetTable2
	ret, _, _ := pGetIpNetTable2.Call(afINET, uintptr(unsafe.Pointer(&tablePtr)))
	if ret != 0 {
		logger.Error("GetIpNetTable2 failed", "error", syscall.Errno(ret))
		return nil
	}
	defer pFreeMibTable.Call(uintptr(unsafe.Pointer(tablePtr)))

	numEntries := tablePtr.NumEntries
	rows := unsafe.Slice((*mibIPNetRow2)(unsafe.Add(unsafe.Pointer(tablePtr), unsafe.Sizeof(*tablePtr))), numEntries)

	result := make(map[string]*pb.Entity)
	for i := uint32(0); i < numEntries; i++ {
		row := &rows[i]

		// Only include reachable/stale/delay/probe/permanent entries.
		switch row.state {
		case nlnsReachable, nlnsStale, nlnsDelay, nlnsProbe, nlnsPermanent:
		default:
			continue
		}

		if row.physicalAddressLen == 0 {
			continue
		}

		ip := fmt.Sprintf("%d.%d.%d.%d", row.addr[0], row.addr[1], row.addr[2], row.addr[3])

		// Format MAC from raw bytes.
		macParts := make([]string, row.physicalAddressLen)
		for j := uint32(0); j < row.physicalAddressLen; j++ {
			macParts[j] = fmt.Sprintf("%02x", row.physicalAddress[j])
		}
		mac := strings.Join(macParts, ":")

		if mac == "ff:ff:ff:ff:ff:ff" {
			continue
		}

		key := strings.ReplaceAll(mac, ":", "")
		vendor := lookupOUI(mac)

		label := ip
		if vendor != "" {
			label = vendor + " " + ip
		}

		dev := &pb.DeviceComponent{
			Ip:       &pb.IpDevice{Host: proto.String(ip)},
			Ethernet: &pb.EthernetDevice{MacAddress: proto.String(mac)},
		}
		if vendor != "" {
			dev.Ethernet.Vendor = proto.String(vendor)
		}

		result[key] = &pb.Entity{
			Label:  proto.String(label),
			Device: dev,
		}
	}

	return result
}
