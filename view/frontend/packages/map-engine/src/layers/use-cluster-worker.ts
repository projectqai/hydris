import { useEffect, useRef, useState } from "react";

import type { EntityData, EntityFilter } from "../types";
import type { ClusterOutput, FilterInput } from "./cluster-logic";
import { AFFILIATION_CODE } from "./cluster-logic";
import { CLUSTER_WORKER_CODE } from "./cluster-worker-code";

const MIN_UPDATE_INTERVAL_MS = 200;

export type ClusterWorkerResult = {
  clusters: ClusterOutput[];
  version: number;
};

type UseClusterWorkerOptions = {
  entityMap: Map<string, EntityData>;
  filter: EntityFilter;
  zoom: number;
  version: number;
  geoChanged: boolean;
};

export function useClusterWorker(options: UseClusterWorkerOptions): ClusterWorkerResult | null {
  const { entityMap, filter, zoom, version, geoChanged } = options;
  const [result, setResult] = useState<ClusterWorkerResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastSentVersionRef = useRef<number>(-1);
  const lastZoomRef = useRef<number>(-1);
  const lastFilterRef = useRef<string>("");
  const lastUpdateTimeRef = useRef<number>(0);
  const pendingUpdateRef = useRef<number | null>(null);
  const latestVersionRef = useRef<number>(-1);

  const latestRef = useRef({ entityMap, filter, zoom, version, geoChanged });
  latestRef.current = { entityMap, filter, zoom, version, geoChanged };

  useEffect(() => {
    const blob = new Blob([CLUSTER_WORKER_CODE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    worker.onmessage = ({ data }: MessageEvent<{ clusters: ClusterOutput[]; version: number }>) => {
      if (data.version === latestVersionRef.current) {
        setResult({ clusters: data.clusters, version: data.version });
      }
    };

    worker.onerror = () => {};

    workerRef.current = worker;

    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!workerRef.current) return;

    const integerZoom = Math.floor(zoom);
    const zoomChanged = integerZoom !== Math.floor(lastZoomRef.current);
    const versionChanged = version !== lastSentVersionRef.current;
    const filterJson = JSON.stringify(filter.tracks);
    const filterChanged = filterJson !== lastFilterRef.current;

    if (!versionChanged && !zoomChanged && !filterChanged) return;

    const now = performance.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

    const doUpdate = () => {
      if (!workerRef.current) return;

      const { entityMap: map, filter: f, zoom: z, version: v, geoChanged: geo } = latestRef.current;

      const dataUnchanged = v === lastSentVersionRef.current;

      const filterInput: FilterInput = {
        blue: f.tracks.blue,
        red: f.tracks.red,
        neutral: f.tracks.neutral,
        unknown: f.tracks.unknown,
      };
      const currentFilterJson = JSON.stringify(f.tracks);
      const filterOnly = dataUnchanged && currentFilterJson !== lastFilterRef.current;

      lastSentVersionRef.current = v;
      lastZoomRef.current = z;
      lastFilterRef.current = currentFilterJson;
      lastUpdateTimeRef.current = performance.now();
      latestVersionRef.current = v;

      if (filterOnly) {
        workerRef.current.postMessage({ filter: filterInput, zoom: z, version: v });
        return;
      }

      if (dataUnchanged) {
        workerRef.current.postMessage({ zoom: z, version: v });
        return;
      }

      const count = map.size;
      const positions = new Float64Array(count * 2);
      const affiliations = new Uint8Array(count);
      const ids: string[] = [];
      const symbols: (string | null)[] = [];

      let i = 0;
      for (const e of map.values()) {
        positions[i * 2] = e.position.lat;
        positions[i * 2 + 1] = e.position.lng;
        affiliations[i] = AFFILIATION_CODE[e.affiliation ?? "unknown"];
        ids.push(e.id);
        symbols.push(e.symbol ?? null);
        i++;
      }

      workerRef.current.postMessage(
        {
          positions,
          affiliations,
          ids,
          symbols,
          count,
          filter: filterInput,
          zoom: z,
          geoChanged: geo,
          version: v,
        },
        [positions.buffer, affiliations.buffer],
      );
    };

    if (timeSinceLastUpdate >= MIN_UPDATE_INTERVAL_MS) {
      if (pendingUpdateRef.current) {
        cancelAnimationFrame(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
      doUpdate();
    } else if (!pendingUpdateRef.current) {
      pendingUpdateRef.current = requestAnimationFrame(() => {
        pendingUpdateRef.current = null;
        doUpdate();
      });
    }

    return () => {
      if (pendingUpdateRef.current) {
        cancelAnimationFrame(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    };
  }, [entityMap, filter, zoom, version, geoChanged]);

  return result;
}

export type { ClusterOutput };
