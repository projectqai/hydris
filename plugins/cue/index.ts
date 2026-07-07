import {
	create,
	EntityFilterSchema,
	ListEntitiesRequestSchema,
	EntityChange,
	attach,
} from "@projectqai/proto/device";
import { RunTaskRequestSchema } from "@projectqai/proto/world";
import {
	TaskExecutionTargetSchema,
	TaskExecutionTargetEntitySchema,
} from "@projectqai/proto/tasking";

const Component = { Taskable: 23 } as const;

let trackedCount = 0n;

await attach({
	id: "cue.service",
	label: "Autocue",
	controller: "cue",
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
		// observe.track.* taskables (one per camera), each advertising the
		// tracks it accepts as targets. The observe controller keeps these
		// lists in sync with the live track set.
		const taskTargets = new Map<string, string[]>();
		let active = "";
		let slewTimer: ReturnType<typeof setTimeout> | null = null;

		signal.addEventListener("abort", () => {
			if (slewTimer) clearTimeout(slewTimer);
		}, { once: true });

		function aim(taskID: string, trackID: string) {
			client.runTask(create(RunTaskRequestSchema, {
				entityId: taskID,
				target: create(TaskExecutionTargetSchema, {
					kind: { case: "entity", value: create(TaskExecutionTargetEntitySchema, { entity: [trackID] }) },
				}),
			})).catch((err) => console.error(`cue: runTask ${taskID}:`, err));
		}

		function available(): string[] {
			const all = new Set<string>();
			for (const targets of taskTargets.values()) for (const t of targets) all.add(t);
			return [...all];
		}

		// pick a random track and aim every camera's track taskable at it.
		function pick() {
			const pool = available();
			if (pool.length === 0) { active = ""; return; }
			active = pool[Math.floor(Math.random() * pool.length)]!;
			trackedCount++;
			console.log(`cue: following track ${active}`);
			for (const id of taskTargets.keys()) aim(id, active);
		}

		function select() {
			if (slewTimer) return; // a selection is already pending
			const delayMs = (config.slew_delay ?? 0) * 1000;
			if (delayMs <= 0) pick();
			else slewTimer = setTimeout(() => { slewTimer = null; pick(); }, delayMs);
		}

		const stream = client.watchEntities(create(ListEntitiesRequestSchema, {
			filter: create(EntityFilterSchema, { component: [Component.Taskable] }),
		}), { signal });

		for await (const ev of stream) {
			const e = ev.entity;
			if (!e) continue;
			if (ev.t === EntityChange.EntityChangeUpdated) {
				const tax = e.taskable?.taxonomy;
				if (tax?.kind?.case !== "observe" || tax.kind.value.kind.case !== "track") continue;
				const isNew = !taskTargets.has(e.id);
				const targets = e.taskable?.target?.entity?.entity ?? [];
				taskTargets.set(e.id, targets);
				if (active && targets.includes(active)) {
					// late-joining camera follows the current selection
					if (isNew) aim(e.id, active);
				} else if (!active || !available().includes(active)) {
					select();
				}
			} else if (ev.t === EntityChange.EntityChangeExpired || ev.t === EntityChange.EntityChangeUnobserved) {
				if (!taskTargets.delete(e.id)) continue;
				if (active && !available().includes(active)) select();
			}
		}
	},

	health: () => ({
		1: { label: "tracks followed", value: trackedCount },
	}),
});
