import { getPaneEntityId } from "@hydris/ui/layout/tree-utils";
import type { PaneContent } from "@hydris/ui/layout/types";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { X } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useEntityStore } from "../../store/entity-store";
import { useSelectionStore } from "../../store/selection-store";
import { buildEntityItems, EntityPickerList } from "./entity-picker-list";
import { paneEntityMeta } from "./pane-entity";
import { PickerModalShell } from "./picker-modal-shell";

export function PaneEntityPickerModal({
  content,
  onSelect,
  onClear,
  onClose,
}: {
  content: PaneContent;
  onSelect: (entityId: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const entities = useEntityStore((s) => s.entities);
  const selectedOnMap = useSelectionStore((s) => s.selectedEntityId);
  const meta = paneEntityMeta(content);
  if (!meta) return null;

  const items = buildEntityItems(entities, { match: meta.match });
  const pinnedId = getPaneEntityId(content);
  const Icon = meta.icon;

  return (
    <PickerModalShell ariaLabel={meta.title} onClose={onClose}>
      <View className="flex-row items-center gap-2.5 px-4 py-3">
        <Icon aria-hidden size={16} strokeWidth={2} color={t.iconMuted} />
        <Text className="font-sans-medium text-foreground flex-1 text-sm">{meta.title}</Text>
        <Pressable onPress={onClose} aria-label="Close" hitSlop={8} className="p-1">
          <X aria-hidden size={14} strokeWidth={2} color={t.iconMuted} />
        </Pressable>
      </View>
      <View className="bg-surface-overlay/6 h-px" />

      <ScrollView style={{ flex: 1 }}>
        <EntityPickerList
          entities={items}
          icon={meta.icon}
          emptyLabel={meta.noun}
          placeholder={`Search ${meta.noun}…`}
          onSelect={(id) => (id === pinnedId ? onClear() : onSelect(id))}
          selectable
          selectedId={pinnedId}
          followsId={selectedOnMap ?? undefined}
          autoFocus
        />
      </ScrollView>
    </PickerModalShell>
  );
}
