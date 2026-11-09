import type { Entity } from "@projectqai/proto/world";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEntityStore } from "../store/entity-store";

const EMPTY_EVIDENCE: string[] = [];

export type EvidenceEntry =
  | { id: string; status: "resolved"; entity: Entity }
  | { id: string; status: "loading" }
  | { id: string; status: "failed"; retrying: boolean };

export function useEvidence(entity: Entity): {
  entries: EvidenceEntry[];
  retry: (id: string) => void;
} {
  const detectionEvidence = entity.detection?.evidence ?? EMPTY_EVIDENCE;
  const trackEvidence = entity.track?.evidence ?? EMPTY_EVIDENCE;
  const evidenceIds = useMemo(() => {
    if (trackEvidence.length === 0) return detectionEvidence;
    if (detectionEvidence.length === 0) return trackEvidence;
    return [...new Set([...detectionEvidence, ...trackEvidence])];
  }, [detectionEvidence, trackEvidence]);

  const inFlightIds = useRef(new Set<string>());
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [retryingIds, setRetryingIds] = useState<Set<string>>(() => new Set());
  const fetchEntity = useEntityStore((s) => s.fetchEntity);
  const resolvedEntities = useEntityStore(
    useShallow((s) => evidenceIds.map((id) => s.entities.get(id))),
  );

  const loadEntities = useCallback(
    (ids: string[]) => {
      const entities = useEntityStore.getState().entities;
      const pending = ids.filter((id) => !entities.has(id) && !inFlightIds.current.has(id));
      if (pending.length === 0) return;

      for (const id of pending) inFlightIds.current.add(id);

      const markFailed = (id: string) => {
        setFailedIds((current) => {
          if (current.has(id)) return current;
          const next = new Set(current);
          next.add(id);
          return next;
        });
      };

      for (const id of pending) {
        void fetchEntity(id)
          .then(
            (resolved) => {
              if (!resolved) markFailed(id);
            },
            () => markFailed(id),
          )
          .finally(() => {
            inFlightIds.current.delete(id);
            setRetryingIds((current) => {
              if (!current.has(id)) return current;

              const next = new Set(current);
              next.delete(id);

              return next;
            });
          });
      }
    },
    [fetchEntity],
  );

  useEffect(() => {
    loadEntities(evidenceIds.filter((id) => !failedIds.has(id)));
  }, [evidenceIds, failedIds, loadEntities]);

  // The failed entry stays shown while it retries, so the row keeps its content and size.
  const retry = useCallback(
    (id: string) => {
      setRetryingIds((current) => new Set(current).add(id));
      loadEntities([id]);
    },
    [loadEntities],
  );

  const entries = evidenceIds.map<EvidenceEntry>((id, index) => {
    const resolved = resolvedEntities[index];

    if (resolved) return { id, status: "resolved", entity: resolved };

    if (failedIds.has(id)) return { id, status: "failed", retrying: retryingIds.has(id) };

    return { id, status: "loading" };
  });

  return { entries, retry };
}
