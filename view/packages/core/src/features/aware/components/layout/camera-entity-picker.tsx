import type { EntityPickerProps } from "@hydris/ui/layout/types";
import { LinkStatus } from "@projectqai/proto/world";
import { Video } from "lucide-react-native";

import { getEntityName } from "../../../../lib/api/use-track-utils";
import { useEntityStore } from "../../store/entity-store";
import { EntityPickerList } from "./entity-picker-list";

export function CameraEntityPicker({ onSelect }: EntityPickerProps) {
  const entities = useEntityStore((state) => state.entities);

  const cameras = (() => {
    const result: { id: string; name: string; isOnline: boolean }[] = [];
    for (const entity of entities.values()) {
      if (entity.camera?.streams && entity.camera.streams.length > 0) {
        result.push({
          id: entity.id,
          name: getEntityName(entity),
          isOnline: entity.link?.status === LinkStatus.LinkStatusConnected,
        });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  })();

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
