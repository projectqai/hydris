import { generateSymbol } from "@hydris/map-engine/utils/symbol-atlas";
import { useThemeColors } from "@hydris/ui/lib/theme";
import type { Entity } from "@projectqai/proto/world";
import { Image } from "expo-image";
import { ArrowRight, Radio } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable } from "react-native";

import { getEntityName } from "../../../../lib/api/use-track-utils";
import { getEntityIcon } from "../../utils/entity-helpers";
import { focusEntity } from "../../utils/focus-entity";
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from "./item";

export function EvidenceLinkRow({ entity }: { entity: Entity }) {
  const t = useThemeColors();
  const name = getEntityName(entity);
  const isDetection = !!entity.detection;
  const sidc = entity.symbol?.milStd2525C;
  const symbolUri = useMemo(() => (sidc ? generateSymbol(sidc) : null), [sidc]);
  const Icon = isDetection ? Radio : getEntityIcon(entity);
  const kind = isDetection ? "Detection" : "Entity";

  return (
    <Pressable
      onPress={() => focusEntity(entity.id)}
      accessibilityRole="link"
      accessibilityLabel={`Navigate to ${name}`}
      className="border-surface-overlay/8 bg-surface-overlay/[.02] hover:bg-surface-overlay/[.03] web:focus-visible:ring-foreground/30 web:focus-visible:ring-2 mb-2 min-h-[45px] flex-row items-center gap-2 rounded-lg border px-3 py-2.5 outline-none select-none"
    >
      {symbolUri ? (
        <ItemMedia className="p-1.5">
          <Image
            source={{ uri: symbolUri }}
            accessibilityLabel={`${name} symbol`}
            contentFit="contain"
            style={{ width: "100%", height: "100%" }}
          />
        </ItemMedia>
      ) : (
        <ItemMedia>
          <Icon aria-hidden size={16} strokeWidth={2} color={t.iconSubtle} />
        </ItemMedia>
      )}
      <ItemContent>
        <ItemTitle>{name}</ItemTitle>
        <ItemDescription>{kind}</ItemDescription>
      </ItemContent>
      <ArrowRight aria-hidden size={14} strokeWidth={2} color={t.controlFg} />
    </Pressable>
  );
}
