"use no memo";

import { memo } from "react";
import { View } from "react-native";

import { RightPanelContent } from "../../right-panel-content";
import { EntityActionButtons } from "../entity-details/entity-action-buttons";

function EntityDetailsPaneComponent() {
  return (
    <View className="flex-1">
      <RightPanelContent headerActions={<EntityActionButtons />} />
    </View>
  );
}

export const EntityDetailsPane = memo(EntityDetailsPaneComponent);
