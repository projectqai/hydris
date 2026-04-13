import { EmptyState } from "@hydris/ui/empty-state";
import { MetricKind } from "@projectqai/proto/metrics";
import { Activity } from "lucide-react-native";

import { useEntityStore } from "../../aware/store/entity-store";
import { getSensorKind } from "../adapter";
import { LevelsWidget } from "./levels-widget";
import { MetricWidget } from "./metric-widget";

type MetricFormat = (value: number, unit: string) => { value: string; unit: string };

const formatDoseRate: MetricFormat = (microSv) => {
  if (microSv >= 1_000_000) return { value: (microSv / 1_000_000).toFixed(2), unit: "Sv/h" };
  if (microSv >= 1_000) return { value: (microSv / 1_000).toFixed(2), unit: "mSv/h" };
  return { value: microSv.toFixed(2), unit: "µSv/h" };
};

const formatAccumulatedDose: MetricFormat = (microSv) => {
  if (microSv >= 1_000_000) return { value: (microSv / 1_000_000).toFixed(2), unit: "Sv" };
  if (microSv >= 1_000) return { value: (microSv / 1_000).toFixed(2), unit: "mSv" };
  return { value: microSv.toFixed(2), unit: "µSv" };
};

export function SensorPane({ entityId, widgetId }: { entityId: string; widgetId: string }) {
  const kind = useEntityStore((s) => {
    const entity = s.entities.get(entityId);
    return entity ? getSensorKind(entity) : null;
  });

  if (!kind) {
    return <EmptyState icon={Activity} title="Sensor" subtitle="Entity not found" />;
  }

  if (widgetId === "sensor:levels") {
    return <LevelsWidget entityId={entityId} />;
  }

  switch (kind) {
    case MetricKind.MetricKindRadiationHazard:
      return (
        <MetricWidget
          entityId={entityId}
          formatPrimary={formatDoseRate}
          formatSecondary={formatAccumulatedDose}
        />
      );
    default:
      return <MetricWidget entityId={entityId} />;
  }
}
