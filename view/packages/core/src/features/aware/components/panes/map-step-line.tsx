import { cn } from "@hydris/ui/lib/utils";
import { Text, View } from "react-native";

import { LIGHT_LAYERS } from "../../map-search";
import { usePlacement } from "../../placement-context";
import { useBullseyeStore } from "../../store/bullseye-store";
import { useEditStore } from "../../store/edit-store";
import { useMapEngineStore } from "../../store/map-engine-store";
import { useMapStore } from "../../store/map-store";
import { selectPathKind, selectPathPointCount, usePathStore } from "../../store/path-store";
import { resolveMapStepLine } from "./resolve-map-step-line";

export function MapStepLine() {
  const { isPlacing } = usePlacement();
  const editEntityId = useEditStore((state) => state.entityId);
  const editKind = useEditStore((state) => state.kind);
  const isTouchInput = useMapEngineStore((state) => state.pointerType === "touch");
  const isBullseyePlacing = useBullseyeStore((state) => state.isPlacing);
  const pathKind = usePathStore(selectPathKind);
  const pathPointCount = usePathStore(selectPathPointCount);
  const baseLayer = useMapStore((state) => state.layer);
  const line = resolveMapStepLine({
    isPlacing,
    editEntityId,
    editKind,
    isTouchInput,
    isBullseyePlacing,
    pathKind,
    pathPointCount,
  });

  if (!line) return null;

  const isLight = LIGHT_LAYERS.has(baseLayer);
  return (
    <View
      pointerEvents="none"
      className={cn(
        "absolute top-3 left-3 z-10 max-w-[65%] rounded-md px-3 py-2",
        isLight ? "bg-white/80" : "bg-black/80",
      )}
    >
      <Text
        selectable={false}
        className={cn("font-sans-medium text-12", isLight ? "text-black" : "text-white")}
      >
        {line}
      </Text>
    </View>
  );
}
