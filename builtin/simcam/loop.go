package simcam

import (
	"bytes"
	"context"
	"fmt"
	"image/jpeg"
	"math"
	"time"

	"github.com/projectqai/hydris/builtin"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	maxFPSLimit = 60
	// idleFrameInterval re-sends a frame while nothing changes so the clock
	// ticks and proxies don't drop the stream.
	idleFrameInterval = time.Second
	poseInterval      = 200 * time.Millisecond
	detectionInterval = 100 * time.Millisecond
	// detectionTTL is how long a detection lives without being renewed; it
	// is renewed at half that while in view.
	detectionTTL = 4 * time.Second
)

// run is the camera's event loop. It sleeps until something happens, then
// steps the gimbal, renders (only while someone is watching, capped at
// max_fps), runs detections and publishes the pose, each at its own rate.
// Input reaches the next frame immediately instead of waiting for a fixed
// tick.
func (cam *camera) run(ctx context.Context) error {
	conn, err := builtin.BuiltinClientConn(controllerName)
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = conn.Close() }()
	client := pb.NewWorldServiceClient(conn)

	frameInterval := time.Second / time.Duration(cam.cfg.MaxFPS)
	r := newRenderer(streamWidth, streamHeight, globalTiles, globalSprites)
	var buf bytes.Buffer
	jpegOpts := &jpeg.Options{Quality: jpegQuality}

	det := &detectionPublisher{cam: cam, client: client}
	defer det.expireAll()

	go cam.monitorFrames(ctx, client, frameInterval)

	var (
		lastStep, lastFrame, lastPose, lastDet time.Time
		needFrame, poseDirty                   = true, true
		detDirty                               = cam.cfg.EnableDetections
		published                              publishedPose
	)
	lastStep = time.Now()

	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-cam.dirty:
			needFrame, poseDirty, detDirty = true, true, cam.cfg.EnableDetections
		case <-cam.frames.joined:
			needFrame = true
		case <-globalTiles.loaded.wait():
			needFrame = true
		case <-globalSprites.loaded.wait():
			needFrame = true
		case <-timer.C:
		}

		now := time.Now()
		dt := min(now.Sub(lastStep), 2*frameInterval).Seconds()
		lastStep = now
		changed, moving := cam.state.advance(dt)
		if changed {
			needFrame, poseDirty, detDirty = true, true, cam.cfg.EnableDetections
		}

		viewers := cam.frames.hasViewers()
		if cam.cfg.EnableDetections && now.Sub(lastDet) >= detectionTTL/2 {
			detDirty = true // renew lifetimes
		}
		wantFrame := viewers && (needFrame || now.Sub(lastFrame) >= idleFrameInterval)
		wantDet := detDirty && now.Sub(lastDet) >= detectionInterval
		var in *frameInput
		if wantFrame && now.Sub(lastFrame) >= frameInterval || wantDet {
			in = cam.frameInput(now)
		}

		if in != nil && wantFrame && now.Sub(lastFrame) >= frameInterval {
			r.groundSamples = int(cam.quality.Load())
			start := time.Now()
			img := r.render(in)
			rendered := time.Now()
			buf.Reset()
			encoded := jpeg.Encode(&buf, img, jpegOpts) == nil
			cam.stats.record(rendered.Sub(start), time.Since(rendered))
			if encoded {
				cam.frames.put(bytes.Clone(buf.Bytes()))
			}
			// Detections come from the same snapshot as the frame. They are
			// published after it: they reach the viewer faster than the
			// encoded video does, so publishing first put the boxes a frame
			// ahead of the picture.
			if cam.cfg.EnableDetections {
				det.publish(ctx, computeDetections(cam.id, r.lastView, in, r.mesh))
				lastDet, detDirty, wantDet = now, false, false
			}
			lastFrame, needFrame = now, false
		}
		if wantDet {
			v := in.view(streamWidth, streamHeight)
			det.publish(ctx, computeDetections(cam.id, v, in, r.meshFor(in, v)))
			lastDet, detDirty = now, false
		}
		if poseDirty && now.Sub(lastPose) >= poseInterval {
			cam.publishPose(ctx, client, &published)
			lastPose, poseDirty = now, false
		}
		if ctx.Err() != nil {
			return nil
		}

		// Sleep until the earliest thing that is due.
		next := time.Duration(math.MaxInt64)
		due := func(at time.Time) { next = min(next, max(at.Sub(now), 0)) }
		if moving {
			due(now.Add(frameInterval))
		}
		if viewers {
			if needFrame {
				due(lastFrame.Add(frameInterval))
			} else {
				due(lastFrame.Add(idleFrameInterval))
			}
		}
		if detDirty {
			due(lastDet.Add(detectionInterval))
		} else if cam.cfg.EnableDetections {
			due(lastDet.Add(detectionTTL / 2))
		}
		if poseDirty {
			due(lastPose.Add(poseInterval))
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		if next != time.Duration(math.MaxInt64) {
			timer.Reset(next)
		}
	}
}

func (cam *camera) frameInput(now time.Time) *frameInput {
	lat, lon, alt := cam.state.position()
	return &frameInput{
		pose:     cam.state.snapshot(),
		lat:      lat,
		lon:      lon,
		alt:      alt,
		entities: cam.world.snapshot(),
		shapes:   cam.shapes.snapshot(),
		occlude:  !cam.cfg.RenderBehindWall,
		now:      now,
	}
}

type publishedPose struct {
	pan, tilt, zoom float64
	valid           bool
}

// publishPose pushes the focal point and FOV, and the camera position when
// direct drive moved it, skipping insignificant changes.
func (cam *camera) publishPose(ctx context.Context, client pb.WorldServiceClient, last *publishedPose) {
	pan, tilt, zoom := cam.state.pose()
	lat, lon, alt := cam.state.position()
	var changes []*pb.Entity
	if !last.valid || math.Abs(wrapSigned(pan-last.pan)) >= 0.1 || math.Abs(tilt-last.tilt) >= 0.1 || math.Abs(zoom-last.zoom) >= 0.05 {
		changes = append(changes,
			&pb.Entity{Id: cam.fpID, Pose: cam.focalPoint(pan, tilt, zoom)},
			&pb.Entity{Id: cam.id, Camera: cam.cameraComponent(effectiveFovDeg(zoom, cam.cfg.FovWide, cam.cfg.FovTele, cam.cfg.RangeMax))},
		)
		last.pan, last.tilt, last.zoom = pan, tilt, zoom
	}
	if cam.state.takeDriven() {
		changes = append(changes, &pb.Entity{Id: cam.id, Geo: &pb.GeoSpatialComponent{
			Latitude: lat, Longitude: lon, Altitude: proto.Float64(alt),
		}})
	}
	last.valid = true
	if len(changes) == 0 {
		return
	}
	if _, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: changes}); err != nil && ctx.Err() == nil {
		cam.logger.Warn("simcam: push pose", "error", err)
	}
}

// detectionPublisher pushes detections whose box changed and expires the
// ones that left view, so a static scene costs nothing per frame.
//
// Every detection carries a short lifetime that is renewed while it stays
// in view, so one whose expire call was lost, or whose camera died, goes
// away on its own instead of sticking on screen.
type detectionPublisher struct {
	cam    *camera
	client pb.WorldServiceClient
	active map[string]detectionState // pushed successfully, still in view
	stale  map[string]struct{}       // left view, expire not yet confirmed
}

type detectionKey struct {
	x, y, w, h uint32
	label      string
}

type detectionState struct {
	key      detectionKey
	pushedAt time.Time
}

func (d *detectionPublisher) publish(ctx context.Context, dets []*pb.Entity) {
	now := time.Now()
	seen := make(map[string]detectionKey, len(dets))
	var changed []*pb.Entity
	for _, e := range dets {
		b := e.Detection.ImageBbox
		k := detectionKey{b.X, b.Y, b.Width, b.Height, e.GetLabel()}
		seen[e.Id] = k
		prev, ok := d.active[e.Id]
		if !ok || prev.key != k || now.Sub(prev.pushedAt) >= detectionTTL/2 {
			e.Lifetime = &pb.Lifetime{Until: timestamppb.New(now.Add(detectionTTL))}
			changed = append(changed, e)
		}
	}
	if d.active == nil {
		d.active = make(map[string]detectionState)
	}
	if len(changed) > 0 {
		if _, err := d.client.Push(ctx, &pb.EntityChangeRequest{Changes: changed}); err != nil {
			if ctx.Err() == nil {
				d.cam.logger.Warn("simcam: push detections", "error", err)
			}
		} else {
			for _, e := range changed {
				d.active[e.Id] = detectionState{key: seen[e.Id], pushedAt: now}
				delete(d.stale, e.Id)
			}
		}
	}
	for id := range d.active {
		if _, ok := seen[id]; !ok {
			delete(d.active, id)
			d.markStale(id)
		}
	}
	d.expireStale(ctx)
}

func (d *detectionPublisher) markStale(id string) {
	if d.stale == nil {
		d.stale = make(map[string]struct{})
	}
	d.stale[id] = struct{}{}
}

// expireStale retries until the world confirms; the lifetime is the
// backstop if it never does.
func (d *detectionPublisher) expireStale(ctx context.Context) {
	for id := range d.stale {
		if _, err := d.client.ExpireEntity(ctx, &pb.ExpireEntityRequest{Id: id}); err == nil || ctx.Err() != nil {
			delete(d.stale, id)
		}
	}
}

func (d *detectionPublisher) expireAll() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for id := range d.active {
		d.markStale(id)
	}
	d.active = nil
	d.expireStale(ctx)
}
