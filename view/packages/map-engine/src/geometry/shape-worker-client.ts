import type { LayerPath } from "../layers/path-logic";
import type { ShapeFeature } from "../types";
import type { GeodesicViewport } from "../utils/geodesic-path";

export type ShapeWorkerPath = {
  id: string;
  kind: LayerPath["kind"];
  rings?: number;
  vertices: { position: LayerPath["vertices"][number]["position"] }[];
};

export type ShapeWorkerInput = {
  paths: ShapeWorkerPath[];
  zoom: number;
  viewport: GeodesicViewport;
};

export type ShapeWorkerRequest = ShapeWorkerInput & { id: number };

export type ShapeWorkerResponse = {
  type: "shape-features";
  id: number;
  offset: number;
  features: ShapeFeature[][];
  complete: boolean;
};

function pathKey(path: ShapeWorkerPath): string {
  return JSON.stringify([path.kind, path.rings, path.vertices.map((vertex) => vertex.position)]);
}

type Batch = {
  request: ShapeWorkerRequest;
  keys: string[];
  features: Map<string, { key: string; features: ShapeFeature[] }>;
};

export class ShapeWorkerClient {
  private nextId = 0;
  private batch: Batch | null = null;

  constructor(private send: (request: ShapeWorkerRequest) => void) {}

  request(input: ShapeWorkerInput): void {
    const keys = input.paths.map(pathKey);
    const previous = this.batch;
    if (
      previous &&
      previous.request.zoom === input.zoom &&
      previous.request.viewport === input.viewport &&
      keys.length === previous.keys.length &&
      keys.every(
        (key, index) =>
          key === previous.keys[index] &&
          input.paths[index]?.id === previous.request.paths[index]?.id,
      )
    )
      return;
    const request = { ...input, id: ++this.nextId };
    this.batch = { request, keys, features: new Map() };
    if (input.paths.length > 0) this.send(request);
  }

  receive(response: ShapeWorkerResponse): boolean {
    const batch = this.batch;
    if (!batch || response.id !== batch.request.id || response.type !== "shape-features")
      return false;
    const end = response.offset + response.features.length;
    if (
      !Number.isInteger(response.offset) ||
      response.offset < 0 ||
      end > batch.request.paths.length ||
      (response.complete && end !== batch.request.paths.length)
    )
      return false;
    response.features.forEach((features, chunkIndex) => {
      const index = response.offset + chunkIndex;
      const path = batch.request.paths[index];
      const key = batch.keys[index];
      if (path && key !== undefined) batch.features.set(path.id, { key, features });
    });
    return true;
  }

  prepared(
    path: ShapeWorkerPath,
    zoom: number,
    viewport?: GeodesicViewport,
  ): ShapeFeature[] | undefined {
    const batch = this.batch;
    if (!batch || !viewport || batch.request.zoom !== Math.ceil(zoom)) return undefined;
    const sampled = batch.request.viewport;
    // Curves culled outside the sampled bounds must also be outside the requested bounds.
    if (
      !(
        sampled.west <= viewport.west &&
        sampled.east >= viewport.east &&
        sampled.south <= viewport.south &&
        sampled.north >= viewport.north
      )
    )
      return undefined;
    const result = batch.features.get(path.id);
    return result?.key === pathKey(path) ? result.features : undefined;
  }
}
