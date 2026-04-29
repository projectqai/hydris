import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { FlashList } from "@shopify/flash-list";
import * as ExpoClipboard from "expo-clipboard";
import type { LucideIcon } from "lucide-react-native";
import { ChevronRight, Copy, MapPin, Settings } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { getEntityName } from "../../../../../lib/api/use-track-utils";
import { toast } from "../../../../../lib/sonner";
import { copyShareableLink, getShareableEntityUrl } from "../../../../../lib/use-url-params";
import { useEntityStore } from "../../../store/entity-store";
import { useMapEngine } from "../../../store/map-engine-store";
import { useSelectionStore } from "../../../store/selection-store";

type ActionItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  action: () => void;
  closePalette?: boolean;
  drills?: boolean;
};

export function EntityActionsView({
  entityId,
  onClose,
  dispatch,
}: {
  entityId: string;
  onClose: () => void;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const t = useThemeColors();
  const entity = useEntityStore((s) => s.entities.get(entityId));
  const select = useSelectionStore((s) => s.select);
  const mapEngine = useMapEngine();

  const actions: ActionItem[] = [];
  if (entity) {
    actions.push({
      id: "copy-id",
      label: "Copy ID",
      icon: Copy,
      action: () => {
        ExpoClipboard.setStringAsync(entity.id);
        toast.success("Copied ID");
      },
    });

    actions.push({
      id: "copy-name",
      label: "Copy name",
      icon: Copy,
      action: () => {
        ExpoClipboard.setStringAsync(getEntityName(entity));
        toast.success("Copied name");
      },
    });

    actions.push({
      id: "copy-link",
      label: "Copy link",
      icon: Copy,
      action: () => {
        const url = getShareableEntityUrl(entity.id);
        copyShareableLink(url);
      },
    });

    if (entity.device) {
      actions.push({
        id: "open-config",
        label: "Configure",
        icon: Settings,
        action: () => dispatch({ type: "push", mode: { kind: "config", entityId: entity.id } }),
        closePalette: false,
        drills: true,
      });
    }

    if (entity.geo) {
      actions.push({
        id: "fly-to",
        label: "Show on map",
        icon: MapPin,
        action: () => {
          select(entity.id);
          const currentZoom = mapEngine.getView()?.zoom ?? 10;
          const targetZoom = Math.max(currentZoom, 16);
          mapEngine.flyTo(
            entity.geo!.latitude,
            entity.geo!.longitude,
            entity.geo!.altitude ?? 0,
            1.5,
            targetZoom,
          );
        },
      });
    }
  }

  const handleActivate = (item: ActionItem) => {
    item.action();
    if (item.closePalette !== false) onClose();
  };

  const { highlightedIndex, listRef, setHighlightedEl, handleScroll } = useListNav({
    items: actions,
    onActivate: handleActivate,
    resetKey: entityId,
  });

  if (!entity) return null;

  return (
    <View className="flex-1">
      <FlashList
        ref={listRef}
        data={actions}
        onScroll={handleScroll}
        keyExtractor={(item: ActionItem) => item.id}
        renderItem={({ item, index }: { item: ActionItem; index: number }) => {
          const Icon = item.icon;
          const isHighlighted = index === highlightedIndex;
          return (
            <Pressable
              ref={isHighlighted ? setHighlightedEl : undefined}
              onPress={() => handleActivate(item)}
              tabIndex={-1}
              className={cn(
                "active:bg-surface-overlay/8 flex-row items-center gap-3 px-4 py-3",
                isHighlighted ? "bg-surface-overlay/8" : "hover:bg-surface-overlay/5",
              )}
            >
              <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
                <Icon size={16} strokeWidth={2} color={t.iconMuted} />
              </View>
              <Text className="font-sans-medium text-foreground flex-1 text-sm">{item.label}</Text>
              {item.drills && <ChevronRight size={14} strokeWidth={2} color={t.iconMuted} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
