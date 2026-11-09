import { useLayoutEffect, useRef } from "react";

import type { PathLayerData } from "../layers/path-logic";
import type { GeodesicViewport } from "../utils/geodesic-path";
import { ShapeWorkerClient, type ShapeWorkerResponse } from "./shape-worker-client";
import { SHAPE_WORKER_CODE } from "./shape-worker-code";

export function useShapeWorker(
  data: PathLayerData | null,
  editablePathId: string | null,
  zoom: number,
  viewport?: GeodesicViewport,
): ShapeWorkerClient | null {
  const clientRef = useRef<ShapeWorkerClient | null>(null);

  useLayoutEffect(() => {
    if (typeof Worker === "undefined") return;
    const blob = new Blob([SHAPE_WORKER_CODE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      if (!(error instanceof DOMException)) throw error;
      console.warn("Shape worker unavailable; sampling synchronously.", error);
      return;
    }
    const client = new ShapeWorkerClient((request) => worker.postMessage(request));
    clientRef.current = client;
    const dispose = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      URL.revokeObjectURL(url);
      clientRef.current = null;
    };
    worker.onmessage = ({ data }: MessageEvent<ShapeWorkerResponse>) => client.receive(data);
    worker.onerror = worker.onmessageerror = () => {
      console.warn("Shape worker failed; sampling synchronously.");
      dispose();
    };
    return dispose;
  }, []);

  useLayoutEffect(() => {
    if (!viewport) return;
    clientRef.current?.request({
      paths: (data?.paths ?? [])
        .filter(
          (path) =>
            path.id !== data?.drawingId &&
            path.id !== editablePathId &&
            (path.kind === "circle" || path.kind === "rb-circle" || path.kind === "rectangle"),
        )
        .map(({ id, kind, rings, vertices }) => ({
          id,
          kind,
          rings,
          vertices: vertices.map(({ position }) => ({ position })),
        })),
      zoom: Math.ceil(zoom) + 1,
      viewport,
    });
  }, [data, editablePathId, zoom, viewport]);

  // Completion prepares a later render; it must not trigger a layer rebuild by itself.
  return clientRef.current;
}
