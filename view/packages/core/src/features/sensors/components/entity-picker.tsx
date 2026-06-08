import type { EntityPickerProps } from "@hydris/ui/layout/types";
import type { Entity } from "@projectqai/proto/world";
import { Activity } from "lucide-react-native";

import {
  buildEntityItems,
  EntityPickerList,
} from "../../aware/components/layout/entity-picker-list";
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

  const kindCache = new Map<Entity, ReturnType<typeof getSensorKind>>();
  const kindOf = (entity: Entity) => {
    if (!kindCache.has(entity)) kindCache.set(entity, getSensorKind(entity));
    return kindCache.get(entity)!;
  };

  const sensors = buildEntityItems(entities, {
    match: (entity) => {
      if (!kindOf(entity)) return false;
      return !expectedShape || getReadingShape(entity) === expectedShape;
    },
    subtitle: (entity) => {
      const kind = kindOf(entity);
      return kind != null ? SENSOR_KIND_LABEL[kind] : undefined;
    },
  });

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
