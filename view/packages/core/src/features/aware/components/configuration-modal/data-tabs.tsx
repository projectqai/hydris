import type { Entity } from "@projectqai/proto/world";

import { MetricsSection } from "./metrics-section";
import { readStatus, StatusSection } from "./status-section";

export type DataTab = "metrics" | "status";

export function getDataTabs(entity: Entity, open?: DataTab): { id: DataTab; label: string }[] {
  return [
    ...(open === "metrics" || (entity.metric?.metrics.length ?? 0) > 0
      ? [{ id: "metrics" as const, label: "Metrics" }]
      : []),
    ...(open === "status" || readStatus(entity).length > 0
      ? [{ id: "status" as const, label: "Status" }]
      : []),
  ];
}

export function DataTabContent({
  tab,
  entity,
  sharedTimestamp,
}: {
  tab: DataTab;
  entity: Entity;
  sharedTimestamp: { seconds: bigint } | null;
}) {
  return tab === "metrics" ? (
    <MetricsSection entity={entity} sharedTimestamp={sharedTimestamp} />
  ) : (
    <StatusSection entity={entity} />
  );
}
