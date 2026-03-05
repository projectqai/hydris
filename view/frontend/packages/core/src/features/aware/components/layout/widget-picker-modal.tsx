import { ControlButton, ControlInput } from "@hydris/ui/controls";
import type { PaneContent } from "@hydris/ui/layout/types";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import uFuzzy from "@leeoniya/ufuzzy";
import type { Entity } from "@projectqai/proto/world";
import {
  AlertTriangle,
  Camera,
  Globe,
  Info,
  List,
  Map,
  Search,
  Video,
  X,
} from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { getEntityName } from "../../../../lib/api/use-track-utils";
import { Z } from "../../constants";
import { useEntityStore } from "../../store/entity-store";

const uf = new uFuzzy({ intraMode: 1 });

const WIDGET_OPTIONS = [
  { id: "mapPane", label: "Map", description: "Live entity map", icon: Map },
  { id: "entityList", label: "List", description: "Entity browser", icon: List },
  { id: "entityDetails", label: "Details", description: "Selected entity", icon: Info },
  { id: "alerts", label: "Alerts", description: "Active alerts", icon: AlertTriangle },
] as const;

type Tab = "widgets" | "cameras" | "embed";

const TABS: { id: Tab; label: string }[] = [
  { id: "widgets", label: "Widgets" },
  { id: "cameras", label: "Cameras" },
  { id: "embed", label: "Embed" },
];

type WidgetPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (content: PaneContent) => void;
  currentContent?: PaneContent;
};

export function WidgetPickerModal({
  visible,
  onClose,
  onSelect,
  currentContent,
}: WidgetPickerModalProps) {
  const t = useThemeColors();
  const [activeTab, setActiveTab] = useState<Tab>("widgets");
  const [searchQuery, setSearchQuery] = useState("");
  const [embedUrl, setEmbedUrl] = useState("");

  const handleSelectWidget = (componentId: string) => {
    onSelect({ type: "component", componentId });
    onClose();
  };

  const handleSelectCamera = (entityId: string) => {
    onSelect({ type: "camera", entityId });
    onClose();
  };

  const handleSubmitEmbed = () => {
    if (embedUrl.trim()) {
      let url = embedUrl.trim();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = "https://" + url;
      }
      onSelect({ type: "iframe", url });
      onClose();
    }
  };

  const currentComponentId =
    currentContent?.type === "component" ? currentContent.componentId : null;
  const currentCameraEntityId = currentContent?.type === "camera" ? currentContent.entityId : null;

  if (!visible) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: Z.WIDGET_PICKER,
      }}
    >
      <Pressable
        onPress={onClose}
        aria-label="Close widget picker"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: t.backdrop,
        }}
      />

      <View
        role="dialog"
        aria-label="Widget picker"
        aria-modal={true}
        style={{
          alignSelf: "center",
          marginTop: "10%",
          width: "95%",
          maxWidth: 560,
          borderRadius: 10,
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: t.borderSubtle,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 24 },
          shadowOpacity: 0.7,
          shadowRadius: 48,
          overflow: "hidden",
        }}
      >
        <View className="flex-row items-center gap-2.5 px-4 py-3">
          <Text className="font-sans-medium text-foreground flex-1 text-sm">Choose Widget</Text>
          <Pressable onPress={onClose} aria-label="Close" tabIndex={-1} hitSlop={8} className="p-1">
            <X size={14} strokeWidth={2} color={t.iconMuted} />
          </Pressable>
        </View>
        <View className="bg-surface-overlay/6 h-px" />

        <View className="flex-row gap-1 px-4 py-2" accessibilityRole="tablist">
          {TABS.map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.id }}
              tabIndex={-1}
              className={cn(
                "rounded-full px-2.5 py-1.5",
                activeTab === tab.id
                  ? "bg-surface-overlay/10"
                  : "hover:bg-surface-overlay/5 bg-transparent",
              )}
            >
              <Text
                className={cn(
                  "font-sans-medium text-xs",
                  activeTab === tab.id ? "text-foreground/90" : "text-muted-foreground",
                )}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View className="bg-surface-overlay/6 h-px" />

        {activeTab === "widgets" && (
          <WidgetsTab currentComponentId={currentComponentId} onSelect={handleSelectWidget} />
        )}
        {activeTab === "cameras" && (
          <CamerasTab
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            currentEntityId={currentCameraEntityId}
            onSelect={handleSelectCamera}
          />
        )}
        {activeTab === "embed" && (
          <EmbedTab url={embedUrl} onUrlChange={setEmbedUrl} onSubmit={handleSubmitEmbed} />
        )}
      </View>
    </View>
  );
}

function WidgetsTab({
  currentComponentId,
  onSelect,
}: {
  currentComponentId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row flex-wrap gap-3 p-4">
      {WIDGET_OPTIONS.map((widget) => {
        const isActive = currentComponentId === widget.id;
        return (
          <Pressable
            key={widget.id}
            onPress={() => onSelect(widget.id)}
            tabIndex={-1}
            className={cn(
              "max-w-[50%] flex-[1_1_47%] items-center rounded-lg border pt-7 pb-5",
              isActive
                ? "border-surface-overlay/12 bg-surface-overlay/8"
                : "border-surface-overlay/6 bg-surface-overlay/2 hover:bg-surface-overlay/5 active:bg-surface-overlay/8",
            )}
          >
            <View
              className={cn(
                "mb-4 size-12 items-center justify-center rounded-lg",
                isActive ? "bg-surface-overlay/10" : "bg-surface-overlay/6",
              )}
            >
              <widget.icon
                size={24}
                strokeWidth={1.5}
                color={isActive ? t.controlFgActive : t.iconMuted}
              />
            </View>
            <Text
              className={cn(
                "font-sans-medium text-sm",
                isActive ? "text-foreground" : "text-foreground/80",
              )}
            >
              {widget.label}
            </Text>
            <Text className="text-muted-foreground mt-1 text-center font-sans text-xs">
              {widget.description}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CamerasTab({
  searchQuery,
  onSearchChange,
  currentEntityId,
  onSelect,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  currentEntityId: string | null;
  onSelect: (entityId: string) => void;
}) {
  const t = useThemeColors();
  const entities = useEntityStore((state) => state.entities);

  const camerasEntities = (() => {
    const result: Entity[] = [];
    for (const entity of entities.values()) {
      if (entity.camera?.streams && entity.camera.streams.length > 0) {
        result.push(entity);
      }
    }
    return result.sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)));
  })();

  const filteredCameras = (() => {
    const q = searchQuery.trim();
    if (!q) return camerasEntities;
    const haystack = camerasEntities.map((e) => getEntityName(e));
    const idxs = uf.filter(haystack, q);
    if (!idxs || idxs.length === 0) return [];
    const info = uf.info(idxs, haystack, q);
    const order = uf.sort(info, haystack, q);
    return order.map((i) => camerasEntities[info.idx[i]!]!);
  })();

  return (
    <View>
      <View className="h-12 flex-row items-center gap-2.5 px-4">
        <Search size={18} strokeWidth={2} color={t.iconMuted} />
        <TextInput
          value={searchQuery}
          onChangeText={onSearchChange}
          placeholder="Search cameras..."
          placeholderTextColor={t.placeholder}
          aria-label="Search cameras"
          autoCapitalize="none"
          autoCorrect={false}
          className="text-foreground flex-1 font-sans text-sm"
          // @ts-expect-error outlineStyle is a React Native Web prop
          style={{ outlineStyle: "none" }}
        />
      </View>
      <View className="bg-surface-overlay/6 h-px" />

      <ScrollView className="max-h-80">
        {filteredCameras.length === 0 ? (
          <View className="items-center justify-center py-10">
            <Camera size={32} strokeWidth={1} color={t.iconMuted} />
            <Text className="text-muted-foreground mt-2 font-sans text-sm">
              {camerasEntities.length === 0 ? "No cameras available" : "No matches found"}
            </Text>
          </View>
        ) : (
          filteredCameras.map((entity) => {
            const isActive = currentEntityId === entity.id;
            const name = getEntityName(entity);
            const isOnline = (entity.camera?.streams ?? []).some((s) => !!s.url);

            return (
              <Pressable
                key={entity.id}
                onPress={() => onSelect(entity.id)}
                tabIndex={-1}
                className={cn(
                  "active:bg-surface-overlay/8 flex-row items-center gap-3 px-4 py-3",
                  isActive ? "bg-surface-overlay/8" : "hover:bg-surface-overlay/5",
                )}
              >
                <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
                  <Video size={16} strokeWidth={2} color={t.iconMuted} />
                </View>
                <Text
                  className={cn(
                    "font-sans-medium flex-1 text-sm",
                    isActive ? "text-foreground" : "text-foreground/80",
                  )}
                >
                  {name}
                </Text>
                <View className="flex-row items-center gap-1.5">
                  <View
                    className={cn(
                      "size-1.5 rounded-full",
                      isOnline ? "bg-green" : "bg-foreground/60",
                    )}
                  />
                  <Text className="text-muted-foreground font-mono text-xs">
                    {isOnline ? "online" : "offline"}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function EmbedTab({
  url,
  onUrlChange,
  onSubmit,
}: {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: () => void;
}) {
  const t = useThemeColors();
  const inputRef = useRef<TextInput>(null);
  const hasUrl = url.trim().length > 0;

  return (
    <View className="px-4 py-4">
      <View className="gap-1.5">
        <Pressable onPress={() => inputRef.current?.focus()}>
          <Text className="font-sans-medium text-foreground text-sm">URL</Text>
        </Pressable>
        <ControlInput
          ref={inputRef}
          value={url}
          onChangeText={onUrlChange}
          placeholder="https://example.com"
          keyboardType="url"
          accessibilityLabel="Embed URL"
          onSubmitEditing={onSubmit}
          suffix={
            <View className="pr-3">
              <Globe size={16} strokeWidth={2} color={t.controlFg} />
            </View>
          }
        />
        <Text className="text-muted-foreground font-mono text-xs">
          Paste any URL to embed in this pane
        </Text>
      </View>

      <ControlButton
        onPress={onSubmit}
        label="Embed"
        variant={hasUrl ? "success" : "default"}
        disabled={!hasUrl}
        size="lg"
        fullWidth
        labelClassName="font-mono text-xs font-semibold uppercase"
        className="mt-3"
        accessibilityLabel="Embed URL"
      />
    </View>
  );
}
