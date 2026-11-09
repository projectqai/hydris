import { describe, expect, it } from "vitest";

import { drawingPreviewFeatures } from "./drawing-preview";
import {
  ShapeWorkerClient,
  type ShapeWorkerInput,
  type ShapeWorkerRequest,
  type ShapeWorkerResponse,
} from "./shape-worker-client";

const input: ShapeWorkerInput = {
  paths: [
    {
      id: "outline",
      kind: "rb-circle",
      rings: 3,
      vertices: [{ position: { lat: 70, lng: 19 } }, { position: { lat: 70.4, lng: 21.7 } }],
    },
  ],
  zoom: 7,
  viewport: { west: -34, east: 76, south: 51, north: 84 },
};

function response(request: ShapeWorkerRequest): ShapeWorkerResponse {
  return {
    type: "shape-features",
    id: request.id,
    offset: 0,
    features: request.paths.map((path) =>
      drawingPreviewFeatures({ path, zoom: request.zoom, viewport: request.viewport }),
    ),
    complete: true,
  };
}

describe("ShapeWorkerClient", () => {
  it("deduplicates unchanged inputs and starts newer cameras immediately", () => {
    const sent: ShapeWorkerRequest[] = [];
    const client = new ShapeWorkerClient((request) => sent.push(request));
    client.request(input);
    client.request({ ...input, paths: structuredClone(input.paths) });
    client.request({ ...input, zoom: 8 });
    client.request({ ...input, zoom: 9 });
    expect(sent.map((request) => request.zoom)).toEqual([7, 8, 9]);
    client.receive(response(sent[0]!));
    expect(client.prepared(input.paths[0]!, 7, input.viewport)).toBeUndefined();
    client.receive(response(sent[1]!));
    client.receive(response(sent[2]!));
    expect(client.prepared(input.paths[0]!, 8.2, input.viewport)).toBeDefined();
  });

  it("exposes each completed chunk before the full batch finishes", () => {
    const paths = [
      structuredClone(input.paths[0]!),
      { ...structuredClone(input.paths[0]!), id: "second-outline" },
    ];
    const sent: ShapeWorkerRequest[] = [];
    const client = new ShapeWorkerClient((request) => sent.push(request));
    client.request({ ...input, paths });
    const complete = response(sent[0]!);
    client.receive({ ...complete, features: complete.features.slice(0, 1), complete: false });
    expect(client.prepared(paths[0]!, 7, input.viewport)).toBeDefined();
    expect(client.prepared(paths[1]!, 7, input.viewport)).toBeUndefined();

    client.receive({ ...complete, offset: 1, features: complete.features.slice(1) });
    expect(client.prepared(paths[1]!, 7, input.viewport)).toBeDefined();
  });

  it("rejects superseded edit and deletion responses", () => {
    const sent: ShapeWorkerRequest[] = [];
    const client = new ShapeWorkerClient((request) => sent.push(request));
    const changed = { ...input, paths: [{ ...input.paths[0]!, rings: 4 }] };
    client.request(input);
    client.request(changed);
    client.receive(response(sent[0]!));
    expect(client.prepared(input.paths[0]!, 7, input.viewport)).toBeUndefined();
    client.request({ ...input, paths: [] });
    client.receive(response(sent[1]!));
    expect(client.prepared(changed.paths[0]!, 7, input.viewport)).toBeUndefined();
    expect(sent).toHaveLength(2);
  });

  it("revalidates the current path before the next request is submitted", () => {
    const sent: ShapeWorkerRequest[] = [];
    const client = new ShapeWorkerClient((request) => sent.push(request));
    client.request(input);
    client.receive(response(sent[0]!));
    const moved = structuredClone(input.paths[0]!);
    moved.vertices[0]!.position.lat = 71.3;
    expect(client.prepared(moved, 7, input.viewport)).toBeUndefined();
    expect(client.prepared({ ...input.paths[0]!, rings: 4 }, 7, input.viewport)).toBeUndefined();
    expect(
      client.prepared({ ...input.paths[0]!, id: "replacement" }, 7, input.viewport),
    ).toBeUndefined();
  });

  it("discards the completed batch when the camera request changes", () => {
    const sent: ShapeWorkerRequest[] = [];
    const client = new ShapeWorkerClient((request) => sent.push(request));
    client.request(input);
    client.receive(response(sent[0]!));
    const viewport = { west: 10, east: 32, south: 65, north: 76 };
    client.request({ ...input, viewport });

    expect(sent).toHaveLength(2);
    expect(client.prepared(input.paths[0]!, 6.3, viewport)).toBeUndefined();
    client.receive(response(sent[1]!));
    expect(client.prepared(input.paths[0]!, 6.3, viewport)).toBeDefined();
  });

  it("requires the target ceil zoom even for contained camera bounds", () => {
    const sent: ShapeWorkerRequest[] = [];
    const client = new ShapeWorkerClient((request) => sent.push(request));
    client.request(input);
    client.receive(response(sent[0]!));
    const viewport = { west: 10, east: 32, south: 65, north: 76 };
    expect(client.prepared(input.paths[0]!, 6.3, viewport)).toBeDefined();
    expect(client.prepared(input.paths[0]!, 7.01, viewport)).toBeUndefined();
    expect(client.prepared(input.paths[0]!, 6, viewport)).toBeUndefined();
  });

  it.each([{ west: -35 }, { east: 77 }, { south: 50 }, { north: 85 }])(
    "rejects a camera beyond sampled bounds: %j",
    (outside) => {
      const sent: ShapeWorkerRequest[] = [];
      const client = new ShapeWorkerClient((request) => sent.push(request));
      client.request(input);
      client.receive(response(sent[0]!));
      expect(
        client.prepared(input.paths[0]!, 6.3, { ...input.viewport, ...outside }),
      ).toBeUndefined();
    },
  );
});
