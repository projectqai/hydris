"use no memo";

import { memo } from "react";
import { View } from "react-native";

import { LeftPanelContent } from "../../left-panel-content";

function EntityListPaneComponent() {
  return (
    <View className="flex-1">
      <LeftPanelContent />
    </View>
  );
}

export const EntityListPane = memo(EntityListPaneComponent);
