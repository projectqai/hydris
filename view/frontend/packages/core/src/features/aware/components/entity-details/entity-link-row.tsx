import { useThemeColors } from "@hydris/ui/lib/theme";
import type { ComponentType } from "react";
import { Pressable, Text, View } from "react-native";

import { getEntityName } from "../../../../lib/api/use-track-utils";
import { useEntityStore } from "../../store/entity-store";
import { mapEngineActions } from "../../store/map-engine-store";
import { useSelectionStore } from "../../store/selection-store";

type EntityLinkRowProps = {
  icon?: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  entityId: string;
};

export function EntityLinkRow({ icon: Icon, label, entityId }: EntityLinkRowProps) {
  const t = useThemeColors();
  const linkedEntity = useEntityStore((s) => s.entities.get(entityId));
  const name = linkedEntity ? getEntityName(linkedEntity) : entityId.slice(0, 8);

  const handlePress = () => {
    useSelectionStore.getState().select(entityId);
    if (linkedEntity?.geo) {
      const currentZoom = mapEngineActions.getView()?.zoom ?? 10;
      mapEngineActions.flyTo(
        linkedEntity.geo.latitude,
        linkedEntity.geo.longitude,
        linkedEntity.geo.altitude ?? 0,
        1.5,
        Math.max(currentZoom, 14),
      );
    }
  };

  return (
    <View className="flex-row items-center gap-2 py-1.5">
      {Icon && (
        <View className="w-5 items-center">
          <Icon size={15} color={t.iconSubtle} strokeWidth={2} />
        </View>
      )}
      <View className="flex-1 flex-row items-center justify-between gap-2">
        <Text className="font-sans-medium text-foreground/75 text-xs">{label}</Text>
        <Pressable
          onPress={handlePress}
          accessibilityLabel={`Navigate to ${name}`}
          accessibilityRole="link"
          className="hover:opacity-70 active:opacity-50"
          hitSlop={8}
        >
          <Text numberOfLines={1} className="font-sans-medium text-foreground/90 text-xs underline">
            {name}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
