import type { EntityPickerProps } from "@hydris/ui/layout/types";
import { LinkStatus } from "@projectqai/proto/world";
import { Activity } from "lucide-react-native";

import { getEntityName } from "../../../lib/api/use-track-utils";
import { EntityPickerList } from "../../aware/components/layout/entity-picker-list";
import { useEntityStore } from "../../aware/store/entity-store";
import { getReadingShape, getSensorKind } from "../adapter";
import { SENSOR_KIND_LABEL } from "../types";

const WIDGET_SHAPE: Record<string, string> = {
  "sensor:metric": "metric",
  "sensor:levels": "levels",
};

export function SensorEntityPicker({ widgetId, onSelect }: EntityPickerProps) {
  const entities = useEntityStore((state) => state.entities);
  const expectedShape = WIDGET_SHAPE[widgetId];

  const sensors = (() => {
    const result: { id: string; name: string; isOnline: boolean; subtitle?: string }[] = [];
    for (const entity of entities.values()) {
      const kind = getSensorKind(entity);
      if (!kind) continue;
      if (expectedShape && getReadingShape(entity) !== expectedShape) continue;

      result.push({
        id: entity.id,
        name: getEntityName(entity),
        isOnline: entity.link?.status === LinkStatus.LinkStatusConnected,
        subtitle: SENSOR_KIND_LABEL[kind],
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  })();

  return (
    <EntityPickerList
      entities={sensors}
      icon={Activity}
      emptyLabel="sensors"
      placeholder="Search sensors..."
      onSelect={(id) => onSelect({ type: "sensor", entityId: id, widgetId })}
    />
  );
}
