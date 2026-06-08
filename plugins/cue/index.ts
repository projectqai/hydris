import {
	create,
	EntitySchema,
	EntityFilterSchema,
	ListEntitiesRequestSchema,
	EntityChange,
	attach,
	push,
	type WorldClient,
	type Entity,
} from "@projectqai/proto/device";
import {
	TaskableComponentSchema,
	TaskableContextSchema,
	TaskableMode,
	TaskExecutionComponentSchema,
	TaskExecutionState,
	ControllerSchema,
	ExpireEntityRequestSchema,
	RunTaskRequestSchema,
} from "@projectqai/proto/world";
import {
	TaskExecutionTargetSchema,
	TaskExecutionTargetEntitySchema,
} from "@projectqai/proto/tasking";

const CONTROLLER = "cue";
const CYCLE_TASK = "cue.cycle";

const Component = { Track: 21, Taskable: 23, TaskExecution: 41 } as const;

let trackedCount = 0n;

// watch an entity stream, dispatching updates and disappearances until aborted.
async function watch(
	client: WorldClient,
	signal: AbortSignal,
	filter: { id?: string; component?: number[] },
	onUpdate: (e: Entity) => void | Promise<void>,
	onGone?: (id: string) => void,
) {
	const stream = client.watchEntities(create(ListEntitiesRequestSchema, {
		filter: create(EntityFilterSchema, filter),
	}), { signal });

	for await (const ev of stream) {
		if (!ev.entity) continue;
		if (ev.t === EntityChange.EntityChangeUpdated) {
			await onUpdate(ev.entity);
		} else if (ev.t === EntityChange.EntityChangeExpired || ev.t === EntityChange.EntityChangeUnobserved) {
			onGone?.(ev.entity.id);
		}
	}
}

await attach({
	id: "cue.service",
	label: "Autocue",
	controller: CONTROLLER,
	device: { category: "Mission" },
	icon: "video",
	schema: {
		slew_delay: {
			type: "number",
			title: "Slew Delay (s)",
			description: "Delay before forwarding target selection to cameras. The camera lags behind the track by this amount.",
			default: 0,
		},
	} as const,
	config: {
		slew_delay: 0,
	},

	run: async (client, config, signal) => {
		const observeTasks = new Set<string>(); // observe.track.* taskables, one per camera
		const tracks = new Set<string>();
		const trackLocks = new Map<string, string>(); // trackID -> our lock taskable id
		const ourTasks = new Set<string>(); // taskables we created, expired on shutdown
		let activeTrack = "";
		let slewTimer: ReturnType<typeof setTimeout> | null = null;

		function expire(id: string) {
			client.expireEntity(create(ExpireEntityRequestSchema, { id }))
				.catch((err) => console.error(`cue: expire ${id}:`, err));
		}

		function pushExec(id: string, state: TaskExecutionState) {
			return push(client, create(EntitySchema, {
				id,
				taskExecution: create(TaskExecutionComponentSchema, { task: id, state }),
			}));
		}

		// publish a reconcile taskable and drive its pending->running->completed handshake.
		function provide(id: string, label: string, icon: string, effect: string, onRun: () => void, context?: string) {
			ourTasks.add(id);
			push(client, create(EntitySchema, {
				id,
				controller: create(ControllerSchema, { id: CONTROLLER }),
				taskable: create(TaskableComponentSchema, {
					label,
					icon,
					effect,
					mode: TaskableMode.TaskableModeReconcile,
					context: context ? [create(TaskableContextSchema, { entityId: context })] : [],
				}),
			})).catch((err) => console.error(`cue: push ${id}:`, err));

			watch(client, signal, { id, component: [Component.TaskExecution] }, async (e) => {
				if (e.taskExecution?.state !== TaskExecutionState.TaskExecutionStatePending) return;
				try {
					await pushExec(id, TaskExecutionState.TaskExecutionStateRunning);
					onRun();
					await pushExec(id, TaskExecutionState.TaskExecutionStateCompleted);
				} catch (err) { console.error(`cue: task ${id}:`, err); }
			}).catch((err) => { if (!signal.aborted) console.error(`cue: watch task ${id}:`, err); });
		}

		// aim one camera's observe-task at a track. Targets only taskables we have
		// observed, so the entity is guaranteed to exist.
		function aim(taskID: string, trackID: string) {
			client.runTask(create(RunTaskRequestSchema, {
				entityId: taskID,
				target: create(TaskExecutionTargetSchema, {
					kind: { case: "entity", value: create(TaskExecutionTargetEntitySchema, { entity: [trackID] }) },
				}),
			})).catch((err) => console.error(`cue: runTask ${taskID}:`, err));
		}

		function aimAll(trackID: string) {
			if (slewTimer) clearTimeout(slewTimer);
			const run = () => { for (const id of observeTasks) aim(id, trackID); };
			const delayMs = (config.slew_delay ?? 0) * 1000;
			if (delayMs <= 0) run();
			else slewTimer = setTimeout(() => { slewTimer = null; run(); }, delayMs);
		}

		function setActiveTrack(trackID: string) {
			activeTrack = trackID;
			if (!trackID) return;
			trackedCount++;
			console.log(`cue: following track ${trackID}`);
			aimAll(trackID);
		}

		function fallbackTarget() {
			for (const id of tracks) {
				if (id !== activeTrack) { setActiveTrack(id); return; }
			}
			setActiveTrack("");
		}

		function cycleTarget() {
			if (tracks.size === 0) { setActiveTrack(""); return; }
			const sorted = [...tracks].sort();
			setActiveTrack(sorted[(sorted.indexOf(activeTrack) + 1) % sorted.length]);
		}

		provide(CYCLE_TASK, "Next Target", "skip-forward", "Switch all cameras to the next available track", cycleTarget);

		signal.addEventListener("abort", () => {
			if (slewTimer) clearTimeout(slewTimer);
			for (const id of ourTasks) expire(id);
		}, { once: true });

		await Promise.all([
			// observe.track.* taskables — one per aim-ready camera, created by the observe controller.
			watch(client, signal, { component: [Component.Taskable] }, (e) => {
				const tax = e.taskable?.taxonomy;
				if (tax?.kind?.case !== "observe" || tax.kind.value.kind.case !== "track") return;
				if (observeTasks.has(e.id)) return;
				observeTasks.add(e.id);
				if (activeTrack) aim(e.id, activeTrack);
			}, (id) => observeTasks.delete(id)).catch((err) => { if (!signal.aborted) console.error("cue: watch observe tasks:", err); }),

			// tracks — each gets a lock taskable so the operator can pin all cameras to it.
			watch(client, signal, { component: [Component.Track] }, (e) => {
				if (tracks.has(e.id)) return;
				tracks.add(e.id);
				const lock = `cue.lock.${e.id}`;
				trackLocks.set(e.id, lock);
				provide(lock, "Camera Lock", "crosshair", "Make all cameras follow this track", () => setActiveTrack(e.id), e.id);
				if (!activeTrack) setActiveTrack(e.id);
			}, (id) => {
				tracks.delete(id);
				const lock = trackLocks.get(id);
				if (lock) { expire(lock); trackLocks.delete(id); }
				if (activeTrack === id) fallbackTarget();
			}).catch((err) => { if (!signal.aborted) console.error("cue: watch tracks:", err); }),
		]);
	},

	health: () => ({
		1: { label: "tracks followed", value: trackedCount },
	}),
});
