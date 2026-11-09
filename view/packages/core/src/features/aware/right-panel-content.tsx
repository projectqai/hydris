import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import { Info } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { EntityDetails } from "./components/entity-details/details";
import { selectEntity, useEntityStore } from "./store/entity-store";
import { useSelectionStore } from "./store/selection-store";

type RightPanelContentProps = {
  headerActions?: ReactNode;
};

export function RightPanelContent({ headerActions }: RightPanelContentProps) {
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const selectedEntity = useEntityStore(selectEntity(selectedEntityId));

  if (!selectedEntity) {
    return (
      <Empty>
        <EmptyMedia icon={Info} />
        <EmptyTitle>No entity selected</EmptyTitle>
        <EmptyDescription>Click an entity on the map to view details</EmptyDescription>
      </Empty>
    );
  }

  return (
    <View className="flex-1">
      <EntityDetails.Root entity={selectedEntity}>
        <EntityDetails.Header />
        <EntityDetails.Body>
          {headerActions ? <View className="px-3 py-2.5">{headerActions}</View> : null}
          <EntityDetails.Tabs />
        </EntityDetails.Body>
      </EntityDetails.Root>
    </View>
  );
}
