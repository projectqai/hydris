import { generateSymbol } from "@hydris/map-engine/utils/symbol-atlas";
import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { Info } from "lucide-react-native";
import type { ReactNode } from "react";
import { Image, Text, View } from "react-native";

import { getEntityName } from "../../lib/api/use-track-utils";
import { EntityDetails } from "./components/entity-details/details";
import { selectEntity, useEntityStore } from "./store/entity-store";
import { useSelectionStore } from "./store/selection-store";

type RightPanelContentProps = {
  headerActions?: ReactNode;
};

export function CollapsedInfo() {
  const t = useThemeColors();
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const selectedEntity = useEntityStore(selectEntity(selectedEntityId));

  if (!selectedEntity) {
    return (
      <View className="flex-row items-center gap-1.5">
        <Info size={14} color={t.iconMuted} strokeWidth={2} />
        <Text className="font-sans-medium text-foreground/70 text-xs">No entity selected</Text>
      </View>
    );
  }

  const sidc = selectedEntity.symbol?.milStd2525C;

  return (
    <View className="flex-row items-center gap-1.5">
      {sidc ? (
        <Image
          source={{ uri: generateSymbol(sidc) }}
          className="size-5"
          accessibilityLabel="Entity symbol"
        />
      ) : (
        <Info size={14} color={t.iconMuted} strokeWidth={2} />
      )}
      <Text className="font-sans-medium text-foreground/80 text-xs">
        {getEntityName(selectedEntity)}
      </Text>
    </View>
  );
}

export function RightPanelContent({ headerActions }: RightPanelContentProps) {
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const selectedEntity = useEntityStore(selectEntity(selectedEntityId));

  if (!selectedEntity) {
    return (
      <EmptyState
        icon={Info}
        title="No entity selected"
        subtitle="Click an entity on the map to view details"
      />
    );
  }

  return (
    <View className="flex-1">
      <EntityDetails.Root entity={selectedEntity}>
        <EntityDetails.Header>{headerActions}</EntityDetails.Header>
        <EntityDetails.Tabs />
      </EntityDetails.Root>
    </View>
  );
}
