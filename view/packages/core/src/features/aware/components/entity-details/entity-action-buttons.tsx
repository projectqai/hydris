import { ControlButton } from "@hydris/ui/controls";
import { Eye, Settings } from "lucide-react-native";
import { useContext } from "react";
import { View } from "react-native";

import { PaletteContext } from "../../palette-context";
import { selectEntity, useEntityStore } from "../../store/entity-store";
import { useSelectionStore } from "../../store/selection-store";
import { ActionsSection } from "./actions-section";

export function EntityActionButtons() {
  const palette = useContext(PaletteContext);
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const selectedEntity = useEntityStore(selectEntity(selectedEntityId));
  const isFollowingEntity = useSelectionStore((s) => s.isFollowing);
  const toggleFollowEntity = useSelectionStore((s) => s.toggleFollow);

  const isTrack = !!selectedEntity?.track;
  const isDevice = !!selectedEntity?.device;

  return (
    <View className="gap-1.5">
      {isDevice && (
        <ControlButton
          onPress={() => palette.open({ kind: "config", entityId: selectedEntity.id })}
          icon={Settings}
          iconSize={14}
          iconStrokeWidth={2}
          label="Configure"
          labelClassName="text-xs leading-none"
          size="md"
          fullWidth
          accessibilityLabel="Configure device"
        />
      )}
      {isTrack && (
        <ControlButton
          onPress={toggleFollowEntity}
          icon={Eye}
          iconSize={14}
          iconStrokeWidth={2}
          label={isFollowingEntity ? "Following" : "Follow"}
          labelClassName="text-xs leading-none"
          variant={isFollowingEntity ? "success" : "default"}
          size="md"
          fullWidth
          accessibilityLabel={isFollowingEntity ? "Stop following entity" : "Follow entity"}
        />
      )}
      <ActionsSection />
    </View>
  );
}
