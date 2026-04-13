package main

import (
	"context"
	"fmt"
	"math/rand"
	"net/http"
	_ "net/http/pprof"
	"os"
	"runtime"
	"time"

	"github.com/projectqai/hydris/engine"
	pb "github.com/projectqai/proto/go"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func heapMiB() uint64 {
	runtime.GC()
	runtime.GC()
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return m.HeapInuse / (1024 * 1024)
}

// randomEntity builds an entity with a random subset of components.
// Every component type and transformer path has a chance of being exercised.
func randomEntity(rng *rand.Rand, id string, parentID string) *pb.Entity {
	e := &pb.Entity{Id: id}

	if rng.Intn(2) == 0 {
		e.Label = proto.String(fmt.Sprintf("label-%d", rng.Intn(10000)))
	}

	// Geo — also with covariance to trigger AOUTransformer ellipse path
	if rng.Intn(2) == 0 {
		e.Geo = &pb.GeoSpatialComponent{
			Latitude:  rng.Float64()*180 - 90,
			Longitude: rng.Float64()*360 - 180,
			Altitude:  proto.Float64(rng.Float64() * 12000),
		}
		if rng.Intn(3) == 0 {
			e.Geo.Covariance = &pb.CovarianceMatrix{
				Mxx: proto.Float64(100 + rng.Float64()*500),
				Myy: proto.Float64(100 + rng.Float64()*500),
				Mzz: proto.Float64(10 + rng.Float64()*50),
			}
		}
	}

	// Symbol — triggers ClassificationTransformer
	if rng.Intn(2) == 0 {
		codes := []string{"SFAPMF--------*", "SHGPUCIZ------*", "SUGPUCI-------*", "SNAPMFQ-------*"}
		e.Symbol = &pb.SymbolComponent{MilStd2525C: codes[rng.Intn(len(codes))]}
	}

	// Track
	if rng.Intn(2) == 0 {
		e.Track = &pb.TrackComponent{
			Tracker: proto.String(fmt.Sprintf("tracker-%d", rng.Intn(100))),
		}
	}

	// Kinematics
	if rng.Intn(2) == 0 {
		e.Kinematics = &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				East:  proto.Float64(rng.Float64()*200 - 100),
				North: proto.Float64(rng.Float64()*200 - 100),
				Up:    proto.Float64(rng.Float64()*20 - 10),
			},
		}
	}

	// Bearing — combined with Detection triggers AOUTransformer LOB path
	if rng.Intn(2) == 0 {
		e.Bearing = &pb.BearingComponent{
			Azimuth:   proto.Float64(rng.Float64() * 360),
			Elevation: proto.Float64(rng.Float64()*180 - 90),
		}
	}

	// Classification
	if rng.Intn(3) == 0 {
		e.Classification = &pb.ClassificationComponent{
			Dimension: pb.ClassificationBattleDimension(rng.Intn(6)).Enum(),
			Identity:  pb.ClassificationIdentity(rng.Intn(7)).Enum(),
		}
	}

	// Transponder
	if rng.Intn(3) == 0 {
		e.Transponder = &pb.TransponderComponent{
			Adsb: &pb.TransponderADSB{
				IcaoAddress: proto.Uint32(uint32(rng.Intn(0xFFFFFF))),
				FlightId:    proto.String(fmt.Sprintf("FL%04d", rng.Intn(9999))),
			},
		}
	}

	// Administrative
	if rng.Intn(3) == 0 {
		e.Administrative = &pb.AdministrativeComponent{
			Id:           proto.String(fmt.Sprintf("REG-%06d", rng.Intn(999999))),
			Flag:         proto.String("DE"),
			Owner:        proto.String("test-owner"),
			Manufacturer: proto.String("test-mfr"),
		}
	}

	// Navigation
	if rng.Intn(3) == 0 {
		e.Navigation = &pb.NavigationComponent{
			Mode: pb.NavigationMode(rng.Intn(7)).Enum(),
		}
	}

	// Power
	if rng.Intn(3) == 0 {
		e.Power = &pb.PowerComponent{
			BatteryChargeRemaining: proto.Float32(rng.Float32()),
			Voltage:                proto.Float32(3.0 + rng.Float32()*9.0),
		}
	}

	// Link
	if rng.Intn(3) == 0 {
		e.Link = &pb.LinkComponent{
			RssiDbm: proto.Int32(-int32(rng.Intn(120))),
			SnrDb:   proto.Int32(int32(rng.Intn(30))),
		}
	}

	// Detection — triggers AOUTransformer
	if rng.Intn(3) == 0 {
		e.Detection = &pb.DetectionComponent{
			DetectorEntityId: proto.String(fmt.Sprintf("sensor-%d", rng.Intn(50))),
			Classification:   proto.String("vehicle"),
		}
	}

	// Camera with streams — triggers MediaTransformer and CameraTransformer
	if rng.Intn(4) == 0 {
		e.Camera = &pb.CameraComponent{
			Streams: []*pb.MediaStream{
				{Label: "main", Url: "rtsp://10.0.0.1/stream1", Protocol: pb.MediaStreamProtocol_MediaStreamProtocolRtsp},
			},
			Fov:      proto.Float64(60 + rng.Float64()*60),
			RangeMax: proto.Float64(100 + rng.Float64()*5000),
		}
	}

	// Orientation
	if rng.Intn(3) == 0 {
		e.Orientation = &pb.OrientationComponent{
			Orientation: &pb.Quaternion{
				X: rng.Float64(), Y: rng.Float64(),
				Z: rng.Float64(), W: rng.Float64(),
			},
		}
	}

	// Pose with parent — triggers PoseTransformer and PolarNormalizeTransformer
	if parentID != "" && rng.Intn(3) == 0 {
		e.Pose = &pb.PoseComponent{
			Parent: parentID,
		}
		if rng.Intn(2) == 0 {
			// Polar offset — triggers PolarNormalizeTransformer
			e.Pose.Offset = &pb.PoseComponent_Polar{
				Polar: &pb.PolarOffset{
					Azimuth:   rng.Float64() * 360,
					Elevation: proto.Float64(rng.Float64()*180 - 90),
					Range:     proto.Float64(rng.Float64() * 1000),
				},
			}
		} else {
			e.Pose.Offset = &pb.PoseComponent_Cartesian{
				Cartesian: &pb.CartesianOffset{
					EastM:  rng.Float64()*200 - 100,
					NorthM: rng.Float64()*200 - 100,
					UpM:    proto.Float64(rng.Float64()*50 - 25),
				},
			}
		}
	}

	// Chat — triggers ChatTransformer
	if rng.Intn(6) == 0 {
		e.Chat = &pb.ChatComponent{
			Sender:  proto.String(fmt.Sprintf("user-%d", rng.Intn(100))),
			Message: fmt.Sprintf("hello from %s", id),
		}
	}

	// Capture
	if rng.Intn(4) == 0 {
		e.Capture = &pb.CaptureComponent{
			Payload:     []byte(fmt.Sprintf("data-%d", rng.Intn(10000))),
			Port:        proto.Uint32(uint32(rng.Intn(65535))),
			ContentType: proto.String("application/octet-stream"),
		}
	}

	// Mission
	if rng.Intn(6) == 0 {
		e.Mission = &pb.MissionComponent{
			Description: proto.String("test mission"),
			Destination: proto.String("port alpha"),
		}
	}

	return e
}

func main() {
	const (
		batchSize  = 5_000
		totalWaves = 2_000 // 5k * 2000 = 10M entities total
		maxHeap    = 512   // MiB — abort if exceeded
	)

	go func() {
		fmt.Println("pprof: http://localhost:6060/debug/pprof/")
		fmt.Println("  cpu:  go tool pprof http://localhost:6060/debug/pprof/profile?seconds=10")
		fmt.Println("  heap: go tool pprof http://localhost:6060/debug/pprof/heap")
		fmt.Println()
		_ = http.ListenAndServe("localhost:6060", nil)
	}()

	w := engine.NewWorldServer()
	ctx := context.Background()
	rng := rand.New(rand.NewSource(42))
	baseline := heapMiB()

	fmt.Printf("memory leak test: %d waves x %d entities = %dM total\n",
		totalWaves, batchSize, totalWaves*batchSize/1_000_000)
	fmt.Printf("baseline heap: %d MiB\n\n", baseline)

	for wave := 0; wave < totalWaves; wave++ {
		now := time.Now()
		expiredUntil := now.Add(-time.Second)  // already expired
		longUntil := now.Add(10 * time.Second) // survives into next waves

		// Push a "parent" entity first so Pose references resolve.
		parentID := fmt.Sprintf("parent-%d", wave)
		parentReq := connect.NewRequest(&pb.EntityChangeRequest{
			Changes: []*pb.Entity{
				{
					Id: parentID,
					Geo: &pb.GeoSpatialComponent{
						Latitude:  48.0 + rng.Float64(),
						Longitude: 11.0 + rng.Float64(),
						Altitude:  proto.Float64(500),
					},
					Orientation: &pb.OrientationComponent{
						Orientation: &pb.Quaternion{X: 0, Y: 0, Z: 0, W: 1},
					},
					Lifetime: &pb.Lifetime{
						From:  timestamppb.New(now),
						Until: timestamppb.New(longUntil),
						Fresh: timestamppb.New(now),
					},
				},
			},
		})
		if _, err := w.Push(ctx, parentReq); err != nil {
			fmt.Fprintf(os.Stderr, "wave %d: parent push failed: %v\n", wave, err)
			os.Exit(1)
		}

		for i := 0; i < batchSize; i++ {
			e := randomEntity(rng, fmt.Sprintf("e-%d", i), parentID)

			// Half expire immediately, half survive into subsequent waves.
			until := expiredUntil
			if i%2 == 0 {
				until = longUntil
			}
			e.Lifetime = &pb.Lifetime{
				From:  timestamppb.New(now),
				Until: timestamppb.New(until),
				Fresh: timestamppb.New(now),
			}

			req := connect.NewRequest(&pb.EntityChangeRequest{
				Changes: []*pb.Entity{e},
			})
			if _, err := w.Push(ctx, req); err != nil {
				fmt.Fprintf(os.Stderr, "wave %d entity %d: push failed: %v\n", wave, i, err)
				os.Exit(1)
			}
		}

		w.GC()

		if (wave+1)%100 == 0 {
			current := heapMiB()
			pushed := uint64(wave+1) * batchSize
			fmt.Printf("wave %5d  %4dM pushed  heap %4d MiB\n",
				wave+1, pushed/1_000_000, current)

			if current > maxHeap {
				fmt.Fprintf(os.Stderr, "\nFAIL: memory leak detected — heap %d MiB after %dM entities (limit %d MiB)\n",
					current, pushed/1_000_000, maxHeap)
				os.Exit(1)
			}
		}
	}

	// Wait for long-lived entities to expire, then drain.
	fmt.Printf("\nwaiting for long-lived entities to expire...\n")
	time.Sleep(11 * time.Second)
	w.GC()

	final := heapMiB()
	fmt.Printf("done: %d MiB final (baseline %d MiB)\n", final, baseline)

	const maxRetained = 50
	if final > baseline+maxRetained {
		fmt.Fprintf(os.Stderr, "FAIL: retained %d MiB above baseline (max %d MiB)\n",
			final-baseline, maxRetained)
		os.Exit(1)
	}

	fmt.Println("PASS")
}
