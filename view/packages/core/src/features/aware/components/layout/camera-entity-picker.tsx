import type { EntityPickerProps } from "@hydris/ui/layout/types";
import { Video } from "lucide-react-native";

import { useEntityStore } from "../../store/entity-store";
import { buildEntityItems, EntityPickerList } from "./entity-picker-list";

export function CameraEntityPicker({ onSelect }: EntityPickerProps) {
  const entities = useEntityStore((state) => state.entities);

  const cameras = buildEntityItems(entities, {
    match: (entity) => (entity.camera?.streams?.length ?? 0) > 0,
  });

  return (
    <EntityPickerList
      entities={cameras}
      icon={Video}
      emptyLabel="cameras"
      placeholder="Search cameras..."
      onSelect={(id) => onSelect({ type: "camera", entityId: id })}
    />
  );
}
