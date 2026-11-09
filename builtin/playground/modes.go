package playground

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"strings"
	"sync"
	"time"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/sdk"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Mode demo: a simulated remote sensor.
//
// Each of its modes is one taskable with TaskableTarget.mode: the options,
// the option in effect, and when it ends and what follows. Running the
// taskable with TaskExecutionTarget.mode requests an option, and the sensor
// reports in the TaskExecutionComponent how the request goes:
//
//   - Operating Mode: Patrol / Alert / Standby / Maintenance / Burst.
//     Maintenance is always rejected. Burst is temporary: it reports when it
//     ends and which mode follows, then the sensor goes back on its own.
//     Every few minutes the sensor drops into Failsafe, a mode it cannot be
//     switched to, for a known time; meanwhile the options are disabled.
//   - Camera: Visible / Infrared.
//   - Radio: Silent / Transmitting, a switch.
//
// A switch settles for a while before it takes effect, and reports when.
//
// "Capture Images" spawns an execution entity per run, so up to three bursts
// can run side by side; about half of them fail halfway through. "Sweep Area" is a command the sensor only accepts in Patrol and Alert;
// otherwise it is disabled with the reason. While they run, the sweep reports
// progress and when it will be done, a reset only when, and a fan purge only
// progress. "Reset Modes" makes the sensor
// put every mode back to its default on its own.
//
// Requests an earlier run left in flight, e.g. one settling when hydris
// stopped, are failed on start.

const (
	modeDemoClass       = "mode_demo"
	modeDemoFailsafe    = uint64(9)
	modeDemoFailsafeDur = 20 * time.Second
	modeDemoFailsafeGap = 3 * time.Minute
	// a capture burst, a task that spawns an execution per run
	modeDemoFrames      = 10
	modeDemoCaptureTime = 6 * time.Second
)

type modeValue struct {
	value    uint64
	label    string
	desc     string
	settable bool
	reject   string
	// set: the sensor leaves this value on its own after this long
	temporary time.Duration
}

// key is the TaskableTargetModeOption id of v
func (v modeValue) key() string { return strings.ToLower(v.label) }

type modeAxis struct {
	id       string // taskable entity id
	label    string
	on       string // option id that means on, for a switch
	values   []modeValue
	def      uint64
	active   uint64
	settle   time.Duration
	failsafe bool
	// what the sensor reports while a switch settles
	reportsEta, reportsProgress bool
	doing                       string

	// the request still settling: cancels its timer, and when it takes effect
	cancel   context.CancelFunc
	switchAt time.Time

	// while active is temporary: when it ends and the value that follows
	until  time.Time
	revert uint64
	// bumped on every change of active, so a stale revert does nothing
	gen int
}

func (a *modeAxis) valueOf(value uint64) (modeValue, bool) {
	for _, v := range a.values {
		if v.value == value {
			return v, true
		}
	}
	return modeValue{}, false
}

func (a *modeAxis) keyOf(value uint64) string {
	if v, ok := a.valueOf(value); ok {
		return v.key()
	}
	return ""
}

func (a *modeAxis) valueByKey(key string) (modeValue, bool) {
	for _, v := range a.values {
		if v.settable && v.key() == key {
			return v, true
		}
	}
	return modeValue{}, false
}

// plainTask is a taskable without mode: reset, sweep, purge.
type plainTask struct {
	id, label, effect string
	priority          uint32
	// how long the work takes
	takes time.Duration
	// what the sensor reports while it works: when it expects to be done, how far along it is
	reportsEta, reportsProgress bool
	// what the sensor says it is doing, by percent done
	doing func(percent uint32) string
	// finishes the work and returns what changed besides the execution. Caller holds d.mu.
	done func(d *modeDemo, ctx context.Context, push func(...*pb.Entity)) (reason string, changes []*pb.Entity)
}

type modeDemo struct {
	mu       sync.Mutex
	entityID string
	axes     []*modeAxis
	plain    []*plainTask
	failsafe bool
	resume   uint64
	// target of the current request, per taskable
	targets map[string]*pb.TaskExecutionTarget
}

func newModeDemo(entityID string) *modeDemo {
	d := &modeDemo{
		entityID: entityID,
		targets:  map[string]*pb.TaskExecutionTarget{},
		axes: []*modeAxis{
			{
				id: entityID + ".mode.1", label: "Operating Mode", def: 1, settle: 5 * time.Second, failsafe: true,
				reportsEta: true, reportsProgress: true, doing: "reconfiguring the detection pipeline",
				values: []modeValue{
					{value: 1, label: "Patrol", desc: "wide area detection, normal reporting rate", settable: true},
					{value: 2, label: "Alert", desc: "maximum sensitivity and reporting rate", settable: true},
					{value: 3, label: "Standby", desc: "detection off, heartbeat only", settable: true},
					{value: 4, label: "Maintenance", desc: "requires on-site access", settable: true, reject: "maintenance requires on-site access"},
					{value: 5, label: "Burst", desc: "maximum reporting rate for 30 seconds", settable: true, temporary: 30 * time.Second},
					{value: modeDemoFailsafe, label: "Failsafe", desc: "link watchdog tripped, holding position"},
				},
			},
			{
				id: entityID + ".mode.2", label: "Camera", def: 1, settle: 3 * time.Second,
				reportsProgress: true, doing: "swapping the filter",
				values: []modeValue{
					{value: 1, label: "Visible", desc: "daylight colour imaging", settable: true},
					{value: 2, label: "Infrared", desc: "thermal imaging for night and obscurants", settable: true},
				},
			},
			{
				id: entityID + ".mode.3", label: "Radio", on: "transmitting", def: 0, settle: 4 * time.Second,
				reportsEta: true, doing: "tuning the transmitter",
				values: []modeValue{
					{value: 0, label: "Silent", desc: "receive only, no emissions", settable: true},
					{value: 1, label: "Transmitting", desc: "reporting over the radio link", settable: true},
				},
			},
		},
	}
	for _, a := range d.axes {
		a.active = a.def
	}
	d.plain = []*plainTask{
		{id: d.resetID(), label: "Reset Modes", effect: "puts every mode of the sensor back to its default", priority: 40, takes: 6 * time.Second, reportsEta: true,
			doing: func(uint32) string { return "putting every mode back to its default" }, done: (*modeDemo).reset},
		{id: d.sweepID(), label: "Sweep Area", effect: "sweeps the area around the sensor once", priority: 20, takes: 8 * time.Second, reportsEta: true, reportsProgress: true,
			doing: func(p uint32) string { return fmt.Sprintf("sector %d of 8", min(8, 1+p*8/100)) }, done: (*modeDemo).sweep},
		{id: d.purgeID(), label: "Purge Fan", effect: "purges the cooling fan to bring the enclosure temperature down", takes: 10 * time.Second, reportsProgress: true,
			doing: func(p uint32) string { return fmt.Sprintf("fan at %d rpm", 1200+p*36) }, done: (*modeDemo).purge},
	}
	return d
}

func (d *modeDemo) resetID() string { return d.entityID + ".reset" }
func (d *modeDemo) sweepID() string { return d.entityID + ".sweep" }
func (d *modeDemo) purgeID() string { return d.entityID + ".thermal.purge" }

// captureID is the spawning taskable: every run is an execution entity of its own.
func (d *modeDemo) captureID() string { return d.entityID + ".capture" }

// ids are all the demo's taskables.
func (d *modeDemo) ids() []string {
	var out []string
	for _, a := range d.axes {
		out = append(out, a.id)
	}
	for _, p := range d.plain {
		out = append(out, p.id)
	}
	return append(out, d.captureID())
}

// axisTaskable is a's taskable with its mode as the sensor reports it. Caller holds d.mu.
func (d *modeDemo) axisTaskable(a *modeAxis) *pb.Entity {
	m := &pb.TaskableTargetMode{Active: proto.String(a.keyOf(a.active))}
	if a.on != "" {
		m.On = proto.String(a.on)
	}
	if !a.until.IsZero() {
		m.Until, m.Next = timestamppb.New(a.until), proto.String(a.keyOf(a.revert))
	}
	for _, v := range a.values {
		if !v.settable {
			continue // e.g. failsafe: reported, never requested
		}
		o := &pb.TaskableTargetModeOption{Id: v.key(), Label: proto.String(v.label)}
		if v.desc != "" {
			o.Description = proto.String(v.desc)
		}
		if d.failsafe && a.failsafe {
			o.Disabled = proto.String("sensor is in failsafe")
		}
		m.Options = append(m.Options, o)
	}
	return &pb.Entity{
		Id:         a.id,
		Controller: &pb.Controller{Id: proto.String(controllerName)},
		Taskable: &pb.TaskableComponent{
			Label:    proto.String(a.label),
			Effect:   proto.String("switch the sensor's " + a.label),
			Mode:     pb.TaskableMode_TaskableModeReconcile,
			Assignee: []*pb.TaskableAssignee{{EntityId: &d.entityID}},
			Target:   &pb.TaskableTarget{Mode: m},
			Taxonomy: &pb.TaskingTaxonomy{Kind: &pb.TaskingTaxonomy_Control{
				Control: &pb.TaskingTaxonomyControl{
					Kind: &pb.TaskingTaxonomyControl_ModeChange{ModeChange: &pb.TaskingTaxonomyModeChange{}},
				},
			}},
		},
	}
}

// sweepDisabled is why the sweep cannot run now, or "". Caller holds d.mu.
func (d *modeDemo) sweepDisabled() string {
	op := d.axes[0]
	if op.active == 1 || op.active == 2 {
		return ""
	}
	v, _ := op.valueOf(op.active)
	return "not available in " + v.label
}

// plainTaskable is p's taskable. Caller holds d.mu.
func (d *modeDemo) plainTaskable(p *plainTask) *pb.Entity {
	tc := &pb.TaskableComponent{
		Label:    proto.String(p.label),
		Priority: proto.Uint32(p.priority),
		Effect:   proto.String(p.effect),
		Mode:     pb.TaskableMode_TaskableModeExclusive,
		Assignee: []*pb.TaskableAssignee{{EntityId: &d.entityID}},
	}
	if why := d.sweepDisabled(); p.id == d.sweepID() && why != "" {
		tc.Disabled = proto.String(why)
	}
	return &pb.Entity{Id: p.id, Controller: &pb.Controller{Id: proto.String(controllerName)}, Taskable: tc}
}

func (d *modeDemo) plainByID(id string) *plainTask {
	for _, p := range d.plain {
		if p.id == id {
			return p
		}
	}
	return nil
}

func (d *modeDemo) axisByID(id string) *modeAxis {
	for _, a := range d.axes {
		if a.id == id {
			return a
		}
	}
	return nil
}

// taskables are all the demo's taskables as they are now. Caller holds d.mu.
func (d *modeDemo) taskables() []*pb.Entity {
	var out []*pb.Entity
	for _, a := range d.axes {
		out = append(out, d.axisTaskable(a))
	}
	for _, p := range d.plain {
		out = append(out, d.plainTaskable(p))
	}
	return append(out, &pb.Entity{
		Id:         d.captureID(),
		Controller: &pb.Controller{Id: proto.String(controllerName)},
		Taskable: &pb.TaskableComponent{
			Label:    proto.String("Capture Images"),
			Priority: proto.Uint32(10),
			Effect:   proto.String(fmt.Sprintf("captures a burst of %d images", modeDemoFrames)),
			Mode:     pb.TaskableMode_TaskableModeSpawn,
			// a fourth burst while three run is refused; finished ones make room
			MaxExecutions: proto.Uint32(3),
			Assignee:      []*pb.TaskableAssignee{{EntityId: &d.entityID}},
		},
	})
}

// watchCaptures carries out every capture run: each is an execution entity
// the engine spawned, and several can run at once.
func (d *modeDemo) watchCaptures(ctx context.Context, logger *slog.Logger, client pb.WorldServiceClient, push func(...*pb.Entity)) {
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{Component: []uint32{uint32(pb.EntityComponent_EntityComponentTaskExecution)}},
	})
	if err != nil {
		logger.Error("mode demo: watch captures", "error", err)
		return
	}
	started := map[string]bool{}
	for {
		event, err := stream.Recv()
		if err != nil {
			return
		}
		e := event.Entity
		ex := e.GetTaskExecution()
		if event.T != pb.EntityChange_EntityChangeUpdated || ex.GetTask() != d.captureID() || e.Id == d.captureID() ||
			ex.State != pb.TaskExecutionState_TaskExecutionStatePending || started[e.Id] {
			continue
		}
		started[e.Id] = true
		go d.capture(ctx, push, e.Id)
	}
}

// ofCapture marks a capture run's execution as one of the capture taskable:
// a spawned execution lives on its own entity, its task names the taskable.
func (d *modeDemo) ofCapture(e *pb.Entity) *pb.Entity {
	e.TaskExecution.Task = d.captureID()
	return e
}

// captureFailures are why a capture run gives up, picked at random.
var captureFailures = []string{"lens obstructed", "storage write error", "lost the target"}

// capture is one capture run on the execution entity id. About half of the
// runs fail somewhere in the middle of the burst.
func (d *modeDemo) capture(ctx context.Context, push func(...*pb.Entity), id string) {
	failAt := 0 // frame the run fails at; 0: it does not
	if rand.IntN(2) == 0 {
		failAt = 3 + rand.IntN(5) // frames 3 to 7 of 10
	}
	start := time.Now()
	eta := start.Add(modeDemoCaptureTime)
	for time.Now().Before(eta) {
		frame := 1 + int(time.Since(start)*modeDemoFrames/modeDemoCaptureTime)
		if failAt != 0 && frame >= failAt {
			why := captureFailures[rand.IntN(len(captureFailures))]
			d.mu.Lock()
			push(d.ofCapture(d.answer(id, pb.TaskExecutionState_TaskExecutionStateFailed,
				fmt.Sprintf("%s at frame %d of %d, %d frames saved", why, frame, modeDemoFrames, frame-1))))
			d.mu.Unlock()
			return
		}
		percent := uint32(min(100, 100*time.Since(start)/modeDemoCaptureTime))
		d.mu.Lock()
		push(d.ofCapture(d.running(id, fmt.Sprintf("frame %d of %d", frame, modeDemoFrames), eta, proto.Uint32(percent))))
		d.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	push(d.ofCapture(d.answer(id, pb.TaskExecutionState_TaskExecutionStateCompleted, fmt.Sprintf("%d frames saved", modeDemoFrames))))
}

// answer reports how the current request on taskable id goes. Caller holds d.mu.
func (d *modeDemo) answer(id string, state pb.TaskExecutionState, reason string) *pb.Entity {
	ex := &pb.TaskExecutionComponent{Task: id, State: state, Target: d.targets[id]}
	if reason != "" {
		ex.Reason = proto.String(reason)
	}
	return &pb.Entity{Id: id, TaskExecution: ex}
}

// running reports the current request on taskable id as running: doing
// what, done at eta unless zero, progress percent along unless nil. Caller holds d.mu.
func (d *modeDemo) running(id, doing string, eta time.Time, progress *uint32) *pb.Entity {
	e := d.answer(id, pb.TaskExecutionState_TaskExecutionStateRunning, doing)
	if !eta.IsZero() {
		e.TaskExecution.Eta = timestamppb.New(eta)
	}
	e.TaskExecution.Progress = progress
	return e
}

func runModeDemo(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	grpcConn, err := builtin.BuiltinClientConn(controllerName)
	if err != nil {
		return fmt.Errorf("grpc connect: %w", err)
	}
	defer func() { _ = grpcConn.Close() }()
	client := pb.NewWorldServiceClient(grpcConn)

	d := newModeDemo(entity.Id)
	push := func(entities ...*pb.Entity) {
		pctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if _, err := client.Push(pctx, &pb.EntityChangeRequest{Changes: entities}); err != nil {
			logger.Error("mode demo: push", "error", err)
		}
	}

	d.mu.Lock()
	sensor := &pb.Entity{Id: d.entityID, Sensor: &pb.SensorComponent{}}
	push(append([]*pb.Entity{sensor}, d.taskables()...)...)
	d.mu.Unlock()

	// a request an earlier run left open, e.g. one that was settling when
	// hydris stopped, cannot finish any more
	if err := sdk.FailInterrupted(ctx, client, d.ids(), "interrupted: the sensor restarted"); err != nil {
		logger.Error("mode demo: fail interrupted requests", "error", err)
	}
	ready()

	defer func() {
		ectx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		for _, id := range d.ids() {
			_, _ = client.ExpireEntity(ectx, &pb.ExpireEntityRequest{Id: id})
		}
	}()

	go d.failsafeLoop(ctx, logger, push)
	go d.watchCaptures(ctx, logger, client, push)

	var filters []*pb.EntityFilter
	for _, id := range d.ids() {
		filters = append(filters, &pb.EntityFilter{Id: proto.String(id)})
	}
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Or:        filters,
			Component: []uint32{uint32(pb.EntityComponent_EntityComponentTaskExecution)},
		},
	})
	if err != nil {
		return fmt.Errorf("watch executions: %w", err)
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("recv: %w", err)
		}
		if event.Entity == nil || event.T != pb.EntityChange_EntityChangeUpdated {
			continue
		}
		ex := event.Entity.TaskExecution
		if ex == nil || ex.State != pb.TaskExecutionState_TaskExecutionStatePending {
			continue
		}
		d.mu.Lock()
		d.handle(ctx, logger, push, event.Entity.Id, ex)
		d.mu.Unlock()
	}
}

// handle starts on a new request. Caller holds d.mu.
func (d *modeDemo) handle(ctx context.Context, logger *slog.Logger, push func(...*pb.Entity), id string, ex *pb.TaskExecutionComponent) {
	d.targets[id] = ex.GetTarget()
	if a := d.axisByID(id); a != nil {
		d.handleSwitch(ctx, logger, push, a, ex.GetTarget().GetMode())
		return
	}
	p := d.plainByID(id)
	if p == nil {
		return
	}
	if why := d.sweepDisabled(); id == d.sweepID() && why != "" {
		push(d.answer(id, pb.TaskExecutionState_TaskExecutionStateFailed, why))
		return
	}
	go d.work(ctx, push, p)
}

// work carries out p, reporting its progress once a second until it is done.
func (d *modeDemo) work(ctx context.Context, push func(...*pb.Entity), p *plainTask) {
	start := time.Now()
	eta := start.Add(p.takes)
	for {
		percent := uint32(min(100, 100*time.Since(start)/p.takes))
		var reportEta time.Time
		var progress *uint32
		if p.reportsEta {
			reportEta = eta
		}
		if p.reportsProgress {
			progress = proto.Uint32(percent)
		}
		d.mu.Lock()
		push(d.running(p.id, p.doing(percent), reportEta, progress))
		d.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
		if !time.Now().Before(eta) {
			break
		}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	reason, changes := p.done(d, ctx, push)
	push(append(changes, d.answer(p.id, pb.TaskExecutionState_TaskExecutionStateCompleted, reason))...)
}

// interrupt fails the switch still settling on a. Caller holds d.mu.
func (d *modeDemo) interrupt(a *modeAxis, push func(...*pb.Entity), reason string) {
	if a.cancel == nil {
		return
	}
	a.cancel()
	a.cancel = nil
	a.switchAt = time.Time{}
	push(d.answer(a.id, pb.TaskExecutionState_TaskExecutionStateFailed, reason), d.axisTaskable(a))
}

// handleSwitch requests option key on a. Caller holds d.mu.
func (d *modeDemo) handleSwitch(ctx context.Context, logger *slog.Logger, push func(...*pb.Entity), a *modeAxis, key string) {
	fail := func(reason string) {
		logger.Info("mode demo: rejected", "axis", a.label, "option", key, "reason", reason)
		push(d.answer(a.id, pb.TaskExecutionState_TaskExecutionStateFailed, reason))
	}
	v, ok := a.valueByKey(key)
	switch {
	case key == "":
		fail("no mode requested")
		return
	case !ok:
		fail("unknown mode " + key)
		return
	case v.reject != "":
		fail(v.reject)
		return
	case d.failsafe && a.failsafe:
		fail("sensor is in failsafe")
		return
	}

	// the new request replaced the one still settling, there is nothing left to answer for it
	if a.cancel != nil {
		a.cancel()
	}
	sctx, cancel := context.WithCancel(ctx)
	a.cancel = cancel
	start := time.Now()
	a.switchAt = start.Add(a.settle)
	// the switch takes effect after the settle time, reported as the axis does
	report := func() *pb.Entity {
		var eta time.Time
		var progress *uint32
		if a.reportsEta {
			eta = a.switchAt
		}
		if a.reportsProgress {
			progress = proto.Uint32(uint32(min(100, 100*time.Since(start)/a.settle)))
		}
		return d.running(a.id, a.doing, eta, progress)
	}
	push(report())
	logger.Info("mode demo: switching", "axis", a.label, "option", v.label)

	go func() {
		for {
			select {
			case <-sctx.Done():
				return
			case <-time.After(time.Second):
			}
			d.mu.Lock()
			if sctx.Err() != nil {
				d.mu.Unlock()
				return
			}
			if time.Now().Before(a.switchAt) {
				push(report())
				d.mu.Unlock()
				continue
			}
			cancel()
			a.cancel = nil
			a.switchAt = time.Time{}
			d.setActive(ctx, push, a, v.value, d.answer(a.id, pb.TaskExecutionState_TaskExecutionStateCompleted, "switched to "+v.label))
			d.mu.Unlock()
			return
		}
	}()
}

// setActive puts a into value and pushes the change. A temporary value
// starts its countdown back to the value before it. Caller holds d.mu.
func (d *modeDemo) setActive(ctx context.Context, push func(...*pb.Entity), a *modeAxis, value uint64, extra ...*pb.Entity) {
	prev := a.active
	a.active = value
	a.gen++
	a.until, a.revert = time.Time{}, 0
	if v, ok := a.valueOf(value); ok && v.temporary > 0 {
		a.until, a.revert = time.Now().Add(v.temporary), prev
		gen := a.gen
		time.AfterFunc(v.temporary, func() {
			d.mu.Lock()
			defer d.mu.Unlock()
			if ctx.Err() != nil || a.gen != gen {
				return
			}
			d.setActive(ctx, push, a, a.revert)
		})
	}
	changes := append([]*pb.Entity{d.axisTaskable(a)}, extra...)
	if a == d.axes[0] {
		// the sweep's availability follows the operating mode
		changes = append(changes, d.plainTaskable(d.plainByID(d.sweepID())))
	}
	push(changes...)
}

func (d *modeDemo) reset(ctx context.Context, push func(...*pb.Entity)) (string, []*pb.Entity) {
	d.failsafe = false
	for _, a := range d.axes {
		d.interrupt(a, push, "interrupted by reset")
		d.setActive(ctx, push, a, a.def)
	}
	return "", nil
}

func (d *modeDemo) sweep(context.Context, func(...*pb.Entity)) (string, []*pb.Entity) {
	return "", nil
}

func (d *modeDemo) purge(context.Context, func(...*pb.Entity)) (string, []*pb.Entity) {
	return "fan purged", nil
}

// failsafeLoop periodically drops the operating mode into Failsafe, a value
// no request can set, for a known time, then recovers to the mode before.
// The device changes its mode on its own.
func (d *modeDemo) failsafeLoop(ctx context.Context, logger *slog.Logger, push func(...*pb.Entity)) {
	op := d.axes[0]
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(modeDemoFailsafeGap):
		}
		d.mu.Lock()
		d.interrupt(op, push, "interrupted by failsafe")
		d.failsafe = true
		resume := op.active
		if v, _ := op.valueOf(resume); v.temporary > 0 {
			resume = op.revert // a temporary mode would have ended meanwhile
		}
		d.resume = resume
		d.setActive(ctx, push, op, modeDemoFailsafe)
		// the failsafe ends at a known time, back in the mode before it
		op.until, op.revert = time.Now().Add(modeDemoFailsafeDur), resume
		push(d.axisTaskable(op))
		d.mu.Unlock()
		logger.Info("mode demo: entered failsafe")

		select {
		case <-ctx.Done():
			return
		case <-time.After(modeDemoFailsafeDur):
		}
		d.mu.Lock()
		// a reset may already have ended the failsafe
		if d.failsafe {
			d.failsafe = false
			d.setActive(ctx, push, op, d.resume)
			logger.Info("mode demo: recovered from failsafe")
		}
		d.mu.Unlock()
	}
}
