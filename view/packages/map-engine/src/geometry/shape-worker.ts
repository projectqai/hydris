import { drawingPreviewFeatures } from "./drawing-preview";
import type { ShapeWorkerRequest, ShapeWorkerResponse } from "./shape-worker-client";

const SHAPE_WORKER_CHUNK_SIZE = 16;

let latestRequestId = 0;

function processRequestChunk(request: ShapeWorkerRequest, offset: number): void {
  if (request.id !== latestRequestId) return;
  const end = Math.min(offset + SHAPE_WORKER_CHUNK_SIZE, request.paths.length);
  const response: ShapeWorkerResponse = {
    type: "shape-features",
    id: request.id,
    offset,
    features: request.paths
      .slice(offset, end)
      .map((path) =>
        drawingPreviewFeatures({ path, zoom: request.zoom, viewport: request.viewport }),
      ),
    complete: end === request.paths.length,
  };
  postMessage(response);
  if (!response.complete) setTimeout(() => processRequestChunk(request, end), 0);
}

addEventListener("message", ({ data }: MessageEvent<ShapeWorkerRequest>) => {
  latestRequestId = data.id;
  processRequestChunk(data, 0);
});
