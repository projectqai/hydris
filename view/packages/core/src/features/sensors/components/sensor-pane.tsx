import { EmptyState } from "@hydris/ui/empty-state";
import { MetricKind } from "@projectqai/proto/metrics";
import { Activity } from "lucide-react-native";
import { View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { PinButton } from "../../aware/components/layout/pane-pin-button";
import { usePaneEntity } from "../../aware/pane-entity-context";
import { useEntityStore } from "../../aware/store/entity-store";
import { formatCompactRelativeTime } from "../../aware/utils/format-metrics";
import { MetricTile, type MetricTileConfig } from "../../aware/widgets/metric-tile";
import { getSensorKind } from "../adapter";
import { RAD_DOSE_RATE_IDS } from "../metric-ids";
import { LevelsWidget } from "./levels-widget";
import { SensorWidgetShell } from "./sensor-widget-shell";
import { SensorHeaderMeta } from "./widget-card";

// only the cbrn hazard metrics show on the tile. Count-kind masks
// (errors/warnings) map to "general" and stay off.
const RADIATION_CONFIG: MetricTileConfig = {
  title: "Radiation",
  icon: Activity,
  categories: ["cbrn"],
  heroIds: RAD_DOSE_RATE_IDS,
  minRows: 3,
};

function RadiationSensorWidget({ entityId }: { entityId: string }) {
  return (
    <SensorWidgetShell entityId={entityId} headerless>
      {(data) => (
        <MetricTile
          config={RADIATION_CONFIG}
          entityId={entityId}
          header={{
            name: data.name,
            timestamp: data.measuredAt ? formatCompactRelativeTime(data.measuredAt) : "--:--",
            meta: (s) => (
              <SensorHeaderMeta
                connectionState={data.connectionState}
                signalStrength={data.signalStrength}
                isSilentMode={data.isSilent}
                hasSensorError={data.hasSensorError}
                textSize={s.text}
                iconSize={s.icon}
              />
            ),
          }}
        />
      )}
    </SensorWidgetShell>
  );
}

export function SensorPane({ entityId }: { entityId?: string }) {
  const { onPin } = usePaneEntity();
  const { exists, kind } = useEntityStore(
    useShallow((s) => {
      const entity = entityId ? s.entities.get(entityId) : undefined;
      return { exists: !!entity, kind: entity ? getSensorKind(entity) : null };
    }),
  );

  if (!kind || !entityId) {
    const subtitle = !entityId
      ? "Pin a sensor to view readings"
      : !exists
        ? "Pinned sensor unavailable"
        : "No sensor readings";
    return (
      <View className="flex-1 p-3">
        {onPin && (
          <View className="flex-row justify-end">
            <PinButton pinned={!!entityId} onPress={onPin} size={18} />
          </View>
        )}
        <View className="flex-1">
          <EmptyState icon={Activity} title="Sensor" subtitle={subtitle} />
        </View>
      </View>
    );
  }

  // route by what the sensor is, not by the pane's widget id. a stale binding
  // (chemical entity on a metric pane) otherwise renders an empty body.
  return kind === MetricKind.MetricKindChemicalHazard ? (
    <LevelsWidget entityId={entityId} />
  ) : (
    <RadiationSensorWidget entityId={entityId} />
  );
}
