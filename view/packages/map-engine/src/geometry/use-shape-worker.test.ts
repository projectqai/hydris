import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayerPath, PathLayerData } from "../layers/path-logic";
import { createShapeLayer } from "../layers/shape-layer";
import * as geojson from "../utils/shape-to-geojson";
import { drawingPreviewFeatures } from "./drawing-preview";
import type {
  ShapeWorkerClient,
  ShapeWorkerRequest,
  ShapeWorkerResponse,
} from "./shape-worker-client";
import { useShapeWorker } from "./use-shape-worker";

const harness = vi.hoisted(() => ({
  client: { current: null as ShapeWorkerClient | null },
  effects: [] as (() => void | (() => void))[],
  publish: vi.fn(),
}));

vi.mock("react", () => ({
  useRef: () => harness.client,
  useState: () => [null, harness.publish],
  useLayoutEffect: (effect: () => void | (() => void)) => harness.effects.push(effect),
}));

const worker = {
  onmessage: null as ((event: MessageEvent<ShapeWorkerResponse>) => void) | null,
  onerror: null as (() => void) | null,
  onmessageerror: null as (() => void) | null,
  postMessage: vi.fn<(request: ShapeWorkerRequest) => void>(),
  terminate: vi.fn(),
};

const fixture: LayerPath = {
  id: "outline",
  kind: "rb-circle",
  rings: 3,
  vertices: [
    { lat: 70, lng: 19 },
    { lat: 70.4, lng: 21.7 },
  ].map((position, sourceIndex) => ({
    position,
    sourceIndex,
    pathId: "outline",
    anchored: false,
    unresolved: false,
  })),
  segments: [],
  totals: [],
  closed: true,
  verticesWhenLocked: false,
};
const viewport = { west: -34, east: 76, south: 51, north: 84 };
let handleMessage: (event: MessageEvent<ShapeWorkerRequest>) => void;
const postMessage = vi.fn<(response: ShapeWorkerResponse) => void>();

beforeAll(async () => {
  vi.stubGlobal("addEventListener", (type: string, handler: typeof handleMessage) => {
    expect(type).toBe("message");
    handleMessage = handler;
  });
  await import("./shape-worker");
});

beforeEach(() => {
  harness.client.current = null;
  harness.effects = [];
  harness.publish.mockClear();
  worker.postMessage.mockClear();
  worker.terminate.mockClear();
  postMessage.mockClear();
  vi.stubGlobal("postMessage", postMessage);
  vi.stubGlobal(
    "Worker",
    vi.fn(function () {
      return worker;
    }),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shape-worker-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useShapeWorker", () => {
  it("prefetches only the next bucket and retains worker geometry through later shape renders without publication", () => {
    const path = structuredClone(fixture);
    const data: PathLayerData = {
      paths: [path, { ...path, id: "editing" }, { ...path, id: "drawing" }],
      drawingId: "drawing",
    };
    const zoom = 6.3;
    expect(useShapeWorker(data, "editing", zoom, viewport)).toBeNull();
    const fallback = drawingPreviewFeatures({ path, zoom, viewport });
    const dispose = harness.effects[0]!();
    try {
      harness.effects[1]!();
      expect(worker.postMessage).toHaveBeenCalledOnce();
      const request = worker.postMessage.mock.calls[0]![0];
      expect(request.zoom).toBe(8);
      expect(request.viewport).toBe(viewport);
      expect(request.paths.map(({ id }) => id)).toEqual(["outline"]);
      handleMessage(new MessageEvent("message", { data: structuredClone(request) }));
      expect(postMessage).toHaveBeenCalledOnce();
      const reply = structuredClone(postMessage.mock.calls[0]![0]);
      expect(reply.features[0]).not.toEqual(fallback);
      worker.onmessage?.(new MessageEvent("message", { data: { ...reply, id: request.id - 1 } }));
      worker.onmessage?.(new MessageEvent("message", { data: { ...reply, offset: -1 } }));
      expect(harness.client.current?.prepared(path, 7.1, viewport)).toBeUndefined();
      worker.onmessage?.(new MessageEvent("message", { data: reply }));
      expect(harness.publish).not.toHaveBeenCalled();

      // A render in the same bucket still uses current geometry, not the finer prefetch.
      harness.effects = [];
      const currentClient = useShapeWorker(data, "editing", 6.7, viewport);
      const current = drawingPreviewFeatures(
        { path, zoom: 6.7, viewport },
        currentClient?.prepared(path, 6.7, viewport),
      );
      expect(current[0]!.geometry).toBe(fallback[0]!.geometry);
      harness.effects[1]!();
      expect(worker.postMessage).toHaveBeenCalledOnce();

      // A new ceil bucket produces fresh buffered bounds; a centered zoom-in fits the old ones.
      const nextZoom = 7.2;
      const nextViewport = { west: -24, east: 66, south: 54, north: 81 };
      harness.effects = [];
      const client = useShapeWorker(data, "editing", nextZoom, nextViewport);
      const convert = vi.spyOn(geojson, "shapeToFeatures");
      const features = drawingPreviewFeatures(
        { path, zoom: nextZoom, viewport: nextViewport },
        client?.prepared(path, nextZoom, nextViewport),
      );
      expect(convert).not.toHaveBeenCalled();
      expect(features.length).toBeGreaterThan(1);
      features.forEach((feature, index) => {
        expect(feature.geometry).toBe(reply.features[0]![index]!.geometry);
        expect(feature.geometry).not.toBe(fallback[index]!.geometry);
      });
      const layers = createShapeLayer({
        data: features,
        visible: true,
        selectedId: null,
        drawnColor: [11, 37, 83, 255],
      });
      const outlines = layers.find((layer) => layer.id === "shapes")?.props.data;
      expect(outlines).toEqual(features);
      if (!Array.isArray(outlines)) throw new Error("Expected shape outlines");
      expect(outlines[0]!.geometry).toBe(reply.features[0]![0]!.geometry);

      harness.effects[1]!();
      expect(worker.postMessage.mock.calls.map(([request]) => request.zoom)).toEqual([8, 9]);
      expect(client?.prepared(path, nextZoom, nextViewport)).toBeUndefined();
      const retained = drawingPreviewFeatures(
        { path, zoom: nextZoom, viewport: nextViewport },
        client?.prepared(path, nextZoom, nextViewport),
      );
      expect(convert).not.toHaveBeenCalled();
      retained.forEach((feature, index) =>
        expect(feature.geometry).toBe(features[index]!.geometry),
      );
      expect(harness.publish).not.toHaveBeenCalled();
    } finally {
      if (typeof dispose === "function") dispose();
    }
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:shape-worker-test");
    expect(harness.client.current).toBeNull();
    expect(worker.onmessage).toBeNull();
  });

  it.each(["unavailable", "creation-error", "error", "message-error"])(
    "renders current fallback without publication when the worker is %s",
    (failure) => {
      if (failure === "unavailable") vi.stubGlobal("Worker", undefined);
      if (failure === "creation-error") {
        vi.stubGlobal(
          "Worker",
          vi.fn(function () {
            throw new DOMException("Worker blocked", "SecurityError");
          }),
        );
      }
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const path = structuredClone(fixture);
      const data: PathLayerData = { paths: [path], drawingId: null };
      expect(useShapeWorker(data, null, 6.3, viewport)).toBeNull();
      harness.effects[0]!();
      harness.effects[1]!();
      if (failure === "error") worker.onerror?.();
      if (failure === "message-error") worker.onmessageerror?.();
      const client = useShapeWorker(data, null, 7.1, viewport);
      expect(client).toBeNull();
      const convert = vi.spyOn(geojson, "shapeToFeatures");
      const fallback = drawingPreviewFeatures(
        { path, zoom: 7.1, viewport },
        client?.prepared(path, 7.1, viewport),
      );
      expect(convert).toHaveBeenCalledOnce();
      expect(fallback.length).toBeGreaterThan(1);
      expect(harness.publish).not.toHaveBeenCalled();
      if (failure !== "unavailable") {
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:shape-worker-test");
      }
      if (failure === "error" || failure === "message-error") {
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(worker.onmessage).toBeNull();
      }
    },
  );
});
