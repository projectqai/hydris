import { describe, expect, test } from "bun:test";
import { create, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
	DetectionComponentSchema,
	DeviceComponentSchema,
	EntitySchema,
	GeoSpatialComponentSchema,
	LifetimeSchema,
	LinkComponentSchema,
} from "@projectqai/proto/world";
import { decodeFrame, frameToEntities } from "./raw";

const encode = (e: ReturnType<typeof create<typeof EntitySchema>>) => {
	const body = toBinary(EntitySchema, e);
	const out = new Uint8Array(1 + body.length);
	out.set(body, 1);
	return out;
};
const now = new Date("2026-09-12T12:00:00Z");
const link = create(LinkComponentSchema, { rssiDbm: -97, snrDb: 8, via: "gw-1" });

describe("decodeFrame", () => {
	test("reads a flags byte then a protobuf entity", () => {
		const wire = decodeFrame(encode(create(EntitySchema, { id: "node-1" })));
		expect(wire?.id).toBe("node-1");
	});
	test("refuses the zlib flag and garbage", () => {
		const p = encode(create(EntitySchema, { id: "node-1" }));
		p[0] = 1;
		expect(decodeFrame(p)).toBeNull();
		expect(decodeFrame(new Uint8Array(0))).toBeNull();
		expect(decodeFrame(new Uint8Array([0, 0xff, 0xff, 0xff]))).toBeNull();
	});
});

describe("frameToEntities", () => {
	test("a detection attaches to its detector and touches the device", () => {
		const wire = create(EntitySchema, {
			id: "node-1.det",
			detection: create(DetectionComponentSchema, { detectorEntityId: "node-1", confidence: 0.7 }),
		});
		const out = frameToEntities(wire, "gw-1", link, now);
		expect(out.map((e) => e.id)).toEqual(["node-1.det", "node-1"]);
		const det = out[0];
		expect(det.pose?.parent).toBe("node-1");
		expect(det.detection?.detectorEntityId).toBe("node-1");
		expect(det.link?.rssiDbm).toBe(-97);
		expect(det.controller?.origin).toBe("gw-1");
		expect(det.controller?.id).toBe("unsafelora.actor");
		expect(Number(det.lifetime?.until?.seconds) - Number(det.lifetime?.from?.seconds)).toBe(120);
		expect(out[1].device).toBeUndefined();
		expect(out[1].controller?.id).toBe("unsafelora.actor");
	});

	test("a detection keeps the fresh its device stamped", () => {
		const fresh = create(TimestampSchema, { seconds: 1767225600n, nanos: 500000000 });
		const wire = create(EntitySchema, {
			id: "node-1.det",
			detection: create(DetectionComponentSchema, { detectorEntityId: "node-1" }),
			lifetime: create(LifetimeSchema, { fresh }),
		});
		const det = frameToEntities(wire, "gw-1", link, now)[0];
		expect(det.lifetime?.fresh).toEqual(fresh);
		expect(det.lifetime?.from).toBeDefined();
		expect(Number(det.lifetime?.until?.seconds)).toBe(Math.floor(now.getTime() / 1000) + 120);
	});

	test("a heartbeat becomes a tracked device with its position", () => {
		const wire = create(EntitySchema, { id: "node-1", geo: create(GeoSpatialComponentSchema, { latitude: 1, longitude: 2 }) });
		const out = frameToEntities(wire, "gw-1", link, now);
		expect(out).toHaveLength(1);
		expect(out[0].track?.tracker).toBe("gw-1");
		expect(out[0].geo?.latitude).toBe(1);
		expect(out[0].routing?.channels).toHaveLength(1);
	});

	test("everything on the wire is forwarded", () => {
		const wire = create(EntitySchema, {
			id: "node-1",
			label: "Sensor 3",
			device: create(DeviceComponentSchema, {}),
			geo: create(GeoSpatialComponentSchema, { latitude: 1, longitude: 2 }),
		});
		const out = frameToEntities(wire, "gw-1", link, now);
		expect(out).toHaveLength(1);
		expect(out[0].label).toBe("Sensor 3");
		expect(out[0].device).toBeDefined();
		expect(out[0].geo?.latitude).toBe(1);
		expect(out[0].track?.tracker).toBe("gw-1");
		expect(out[0].lifetime?.fresh).toBeDefined();
	});

	test("frames that name nothing are dropped", () => {
		expect(frameToEntities(create(EntitySchema, {}), "gw-1", link, now)).toEqual([]);
		expect(frameToEntities(create(EntitySchema, { detection: create(DetectionComponentSchema, { detectorEntityId: "node-1" }) }), "gw-1", link, now)).toEqual([]);
		expect(frameToEntities(create(EntitySchema, { id: "x", detection: create(DetectionComponentSchema, {}) }), "gw-1", link, now)).toEqual([]);
	});
});
