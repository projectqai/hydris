import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AFFILIATION_COLORS_RGB } from "../constants";
import type { DrawingKind } from "../types";
import { destinationDegrees } from "../utils/geodesic-circle";
import * as geojson from "../utils/shape-to-geojson";
import { drawingPreviewFeatures, drawingPreviewShape } from "./drawing-preview";
import {
  ShapeWorkerClient,
  type ShapeWorkerInput,
  type ShapeWorkerPath,
  type ShapeWorkerRequest,
  type ShapeWorkerResponse,
} from "./shape-worker-client";

const viewport = { west: -213, east: 231, south: -89, north: 89 };
const seam = { lat: 70, lng: 176 };

const paths: (ShapeWorkerPath & { kind: DrawingKind })[] = [
  {
    id: "seam-rectangle",
    kind: "rectangle",
    vertices: [
      seam,
      destinationDegrees(seam, 37, 900_000),
      destinationDegrees(seam, 127, 310_000),
    ].map((position) => ({ position })),
  },
  {
    id: "seam-rings",
    kind: "rb-circle",
    rings: 3,
    vertices: [{ position: seam }, { position: destinationDegrees(seam, 53, 470_000) }],
  },
];

let handleMessage: (event: MessageEvent<ShapeWorkerRequest>) => void;
const postMessage = vi.fn<(response: ShapeWorkerResponse) => void>();

beforeAll(async () => {
  vi.stubGlobal("addEventListener", (type: string, handler: typeof handleMessage) => {
    expect(type).toBe("message");
    handleMessage = handler;
  });
  vi.stubGlobal("postMessage", postMessage);
  await import("./shape-worker");
});

afterEach(() => {
  vi.restoreAllMocks();
  postMessage.mockClear();
});

afterAll(() => vi.unstubAllGlobals());

function response(request: ShapeWorkerRequest): ShapeWorkerResponse {
  handleMessage(new MessageEvent("message", { data: structuredClone(request) }));
  const posted = postMessage.mock.lastCall?.[0];
  if (!posted) throw new Error("Worker did not respond");
  return structuredClone(posted);
}

describe("shape worker features", () => {
  it("yields between chunks and abandons superseded work", async () => {
    vi.useFakeTimers();
    try {
      const chunkedPaths = Array.from({ length: 33 }, (_, index) => ({
        ...structuredClone(paths[0]!),
        id: `chunked-${index}`,
      }));
      const first: ShapeWorkerRequest = { id: 100, paths: chunkedPaths, zoom: 7, viewport };
      handleMessage(new MessageEvent("message", { data: first }));
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
        id: first.id,
        offset: 0,
        complete: false,
      });
      expect(postMessage.mock.calls[0]?.[0].features.length).toBeLessThan(chunkedPaths.length);

      const replacement: ShapeWorkerRequest = {
        id: 101,
        paths: [structuredClone(paths[1]!)],
        zoom: 6,
        viewport,
      };
      handleMessage(new MessageEvent("message", { data: replacement }));
      await vi.runAllTimersAsync();
      expect(postMessage.mock.calls.filter(([reply]) => reply.id === first.id)).toHaveLength(1);
      expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
        id: replacement.id,
        offset: 0,
        complete: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(paths)("converts, consumes and retains exact $id features", (fixture) => {
    const path = structuredClone(fixture);
    const input: ShapeWorkerInput = { paths: [path], zoom: 7, viewport };
    const sent: ShapeWorkerRequest[] = [];
    const client = new ShapeWorkerClient((request) => sent.push(request));
    client.request(input);
    const reply = response(sent[0]!);
    client.receive(reply);

    const shape = drawingPreviewShape(
      path.kind,
      path.vertices.map((vertex) => vertex.position),
      path.rings,
      input.zoom,
      viewport,
    );
    const expected = shape ? geojson.shapeToFeatures(path.id, shape, "red", true, true) : [];
    expect(expected.some((feature) => feature.properties.fillOnly)).toBe(true);
    expect(expected.some((feature) => feature.geometry.type === "LineString")).toBe(true);
    const convert = vi.spyOn(geojson, "shapeToFeatures");
    const prepared = client.prepared(path, 6.3, viewport);
    expect(prepared).toBe(reply.features[0]);
    const first = drawingPreviewFeatures(
      { path, zoom: 6.3, viewport, affiliation: "red" },
      prepared,
    );
    expect(first).toEqual(expected);
    first.forEach((feature, index) =>
      expect(feature.geometry).toBe(reply.features[0]?.[index]?.geometry),
    );
    expect(convert).not.toHaveBeenCalled();

    client.request({ ...input, zoom: 8 });
    client.receive(response(sent[1]!));
    client.request({ ...input, paths: [], zoom: 8 });
    expect(client.prepared(path, 6.3, viewport)).toBeUndefined();
    convert.mockClear();
    const retained = drawingPreviewFeatures(
      { path, zoom: 6.3, viewport, affiliation: "red" },
      client.prepared(path, 6.3, viewport),
    );
    expect(retained).toEqual(expected);
    retained.forEach((feature, index) => expect(feature.geometry).toBe(first[index]?.geometry));
    expect(convert).not.toHaveBeenCalled();
  });

  it("applies current identity and affiliation without changing cached worker properties", () => {
    const path = structuredClone(paths[1]!);
    const client = new ShapeWorkerClient((request) => client.receive(response(request)));
    client.request({ paths: [path], zoom: 7, viewport });
    const prepared = client.prepared(path, 6.3, viewport);
    expect(prepared?.length).toBeGreaterThan(1);
    const first = drawingPreviewFeatures(
      { path, zoom: 6.3, viewport, affiliation: "red" },
      prepared,
    );
    const renamed = { ...path, id: "current-identity" };
    const current = drawingPreviewFeatures({
      path: renamed,
      zoom: 6.3,
      viewport,
      affiliation: "blue",
    });
    expect(current).toHaveLength(first.length);
    current.forEach((feature, index) => {
      expect(feature.geometry).toBe(first[index]?.geometry);
      expect(feature.properties).toEqual({
        ...prepared?.[index]?.properties,
        id: renamed.id,
        affiliation: "blue",
        color: AFFILIATION_COLORS_RGB.blue,
      });
      expect(first[index]?.properties.affiliation).toBe("red");
      expect(prepared?.[index]?.properties).toMatchObject({
        id: path.id,
        affiliation: "unclassified",
        color: AFFILIATION_COLORS_RGB.unclassified,
        collectionMember: true,
        drawn: true,
      });
    });
  });

  it.each(["coordinates", "rings", "kind", "zoom", "viewport"])(
    "invalidates current features for changed %s",
    (changed) => {
      const path = structuredClone(paths[1]!);
      const sampledViewport =
        changed === "viewport" ? { west: -15, east: -13, south: 15, north: 17 } : viewport;
      const client = new ShapeWorkerClient((request) => client.receive(response(request)));
      client.request({ paths: [path], zoom: 7, viewport: sampledViewport });
      const before = drawingPreviewFeatures(
        { path, zoom: 6.3, viewport: sampledViewport },
        client.prepared(path, 6.3, sampledViewport),
      );
      const convert = vi.spyOn(geojson, "shapeToFeatures");
      if (changed === "coordinates") path.vertices[1]!.position.lng += 3.7;
      if (changed === "rings") path.rings = 2;
      if (changed === "kind") path.kind = "rectangle";
      const zoom = changed === "zoom" ? 8.2 : 6.3;
      const actual = drawingPreviewFeatures(
        { path, zoom, viewport },
        client.prepared(path, zoom, viewport),
      );
      expect(convert).toHaveBeenCalledTimes(1);
      expect(actual).not.toEqual(before);
      const points = path.vertices.map((vertex) => vertex.position);
      const shape = drawingPreviewShape(path.kind, points, path.rings, zoom, viewport);
      expect(actual).toEqual(
        shape ? geojson.shapeToFeatures(path.id, shape, "unclassified", true, true) : [],
      );
    },
  );
});
