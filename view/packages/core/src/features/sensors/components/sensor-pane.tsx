import { EmptyState } from "@hydris/ui/empty-state";
import { MetricKind } from "@projectqai/proto/metrics";
import { Activity, ShieldAlert } from "lucide-react-native";

import { useEntityStore } from "../../aware/store/entity-store";
import {
  MetricCategoryWidget,
  type MetricCategoryWidgetConfig,
} from "../../aware/widgets/metric-category-widget";
import { getSensorKind } from "../adapter";
import { RAD_DOSE_RATE_IDS } from "../metric-ids";
import { LevelsWidget } from "./levels-widget";
import { MetricWidget } from "./metric-widget";
import { SensorWidgetShell } from "./sensor-widget-shell";

const RADIATION_CONFIG: MetricCategoryWidgetConfig = {
  title: "Radiation",
  icon: ShieldAlert,
  categories: ["cbrn"],
  heroIds: RAD_DOSE_RATE_IDS,
  supportingPerPage: 3,
};

function RadiationSensorWidget({ entityId }: { entityId: string }) {
  return (
    <SensorWidgetShell entityId={entityId}>
      {() => (
        <MetricCategoryWidget config={RADIATION_CONFIG} entityId={entityId} showHeader={false} />
      )}
    </SensorWidgetShell>
  );
}

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
      return <RadiationSensorWidget entityId={entityId} />;
    default:
      return <MetricWidget entityId={entityId} />;
  }
}
