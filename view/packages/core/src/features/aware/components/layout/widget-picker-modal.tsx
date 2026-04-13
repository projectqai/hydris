import { ControlButton, ControlInput } from "@hydris/ui/controls";
import type { PaneContent, WidgetGroup } from "@hydris/ui/layout/types";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Globe,
  Info,
  Leaf,
  List,
  Map,
  MessageSquare,
  Radar,
  X,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, type TextInput, View } from "react-native";

import { Z } from "../../constants";

type WidgetOption = {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ size: number; strokeWidth: number; color: string }>;
};

const LAYOUT_WIDGETS: WidgetOption[] = [
  { id: "alerts", label: "Alerts", description: "Active alerts", icon: AlertTriangle },
  { id: "chat", label: "Chat", description: "Team messaging", icon: MessageSquare },
  { id: "contactReports", label: "Contacts", description: "Sensor detections", icon: Radar },
  { id: "entityDetails", label: "Details", description: "Selected entity", icon: Info },
  { id: "entityList", label: "List", description: "Entity browser", icon: List },
  { id: "mapPane", label: "Map", description: "Live entity map", icon: Map },
];

const MONITORING_WIDGETS: WidgetOption[] = [
  { id: "environment", label: "Environment", description: "Environmental metrics", icon: Leaf },
];

type Tab = string;

const BASE_TABS: { id: Tab; label: string }[] = [
  { id: "layout", label: "Layout" },
  { id: "monitoring", label: "Monitoring" },
  { id: "embed", label: "Embed" },
];

const TAB_WIDGETS: Record<string, WidgetOption[]> = {
  layout: LAYOUT_WIDGETS,
  monitoring: MONITORING_WIDGETS,
};

type WidgetPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (content: PaneContent) => void;
  currentContent?: PaneContent;
  additionalWidgets?: WidgetGroup[];
};

export function WidgetPickerModal({
  visible,
  onClose,
  onSelect,
  currentContent,
  additionalWidgets,
}: WidgetPickerModalProps) {
  const t = useThemeColors();
  const [activeTab, setActiveTab] = useState<Tab>("layout");
  const [embedUrl, setEmbedUrl] = useState("");
  const [pendingEntityPicker, setPendingEntityPicker] = useState<{
    group: WidgetGroup;
    widgetId: string;
  } | null>(null);

  const tabs = (() => {
    if (!additionalWidgets?.length) return BASE_TABS;
    const extra = additionalWidgets.map((g) => ({ id: `group:${g.tab}`, label: g.tab }));
    const embedIdx = BASE_TABS.findIndex((t) => t.id === "embed");
    return [...BASE_TABS.slice(0, embedIdx), ...extra, ...BASE_TABS.slice(embedIdx)];
  })();

  const handleSelectWidget = (componentId: string) => {
    onSelect({ type: "component", componentId });
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

  const handleGroupWidgetSelect = (group: WidgetGroup, widgetId: string) => {
    if (group.EntityPicker) {
      setPendingEntityPicker({ group, widgetId });
    } else {
      handleSelectWidget(widgetId);
    }
  };

  const handleGroupTabClick = (group: WidgetGroup) => {
    if (group.EntityPicker && group.widgets.length <= 1) {
      setPendingEntityPicker({ group, widgetId: group.widgets[0]?.id ?? "" });
    }
  };

  const currentComponentId =
    currentContent?.type === "component" ? currentContent.componentId : null;

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
      {Platform.OS === "web" && (
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
      )}

      <View
        role="dialog"
        aria-label="Widget picker"
        aria-modal={true}
        style={
          Platform.OS === "web"
            ? {
                alignSelf: "center",
                marginTop: "10%",
                width: "95%",
                maxWidth: 640,
                maxHeight: "75%",
                borderRadius: 10,
                backgroundColor: t.card,
                borderWidth: 1,
                borderColor: t.borderSubtle,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 24 },
                shadowOpacity: 0.7,
                shadowRadius: 48,
                overflow: "hidden",
              }
            : {
                flex: 1,
                backgroundColor: t.card,
              }
        }
      >
        <View className="flex-row items-center gap-2.5 px-4 py-3">
          {pendingEntityPicker ? (
            <Pressable
              onPress={() => {
                if (pendingEntityPicker.group.widgets.length <= 1) {
                  setActiveTab("layout");
                }
                setPendingEntityPicker(null);
              }}
              hitSlop={8}
              className="p-1"
            >
              <ArrowLeft size={14} strokeWidth={2} color={t.iconMuted} />
            </Pressable>
          ) : null}
          <Text className="font-sans-medium text-foreground flex-1 text-sm">
            {pendingEntityPicker ? `Select ${pendingEntityPicker.group.tab}` : "Choose Widget"}
          </Text>
          <Pressable onPress={onClose} aria-label="Close" tabIndex={-1} hitSlop={8} className="p-1">
            <X size={14} strokeWidth={2} color={t.iconMuted} />
          </Pressable>
        </View>
        <View className="bg-surface-overlay/6 h-px" />

        {!pendingEntityPicker && (
          <>
            <View className="flex-row gap-1 px-4 py-2" accessibilityRole="tablist">
              {tabs.map((tab) => (
                <Pressable
                  key={tab.id}
                  onPress={() => {
                    setActiveTab(tab.id);
                    const group = additionalWidgets?.find((g) => `group:${g.tab}` === tab.id);
                    if (group) handleGroupTabClick(group);
                  }}
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
          </>
        )}

        <ScrollView style={{ flex: 1 }}>
          {pendingEntityPicker?.group.EntityPicker ? (
            <pendingEntityPicker.group.EntityPicker
              widgetId={pendingEntityPicker.widgetId}
              onSelect={(content) => {
                onSelect(content);
                onClose();
                setPendingEntityPicker(null);
              }}
            />
          ) : (
            <>
              {TAB_WIDGETS[activeTab] && (
                <WidgetGrid
                  widgets={TAB_WIDGETS[activeTab]!}
                  currentComponentId={currentComponentId}
                  onSelect={handleSelectWidget}
                />
              )}
              {additionalWidgets?.map((group) =>
                activeTab === `group:${group.tab}` ? (
                  <WidgetGrid
                    key={group.tab}
                    widgets={group.widgets.map((w) => ({
                      id: w.id,
                      label: w.label,
                      description: w.description,
                      icon: w.icon,
                    }))}
                    currentComponentId={currentComponentId}
                    onSelect={(widgetId) => handleGroupWidgetSelect(group, widgetId)}
                  />
                ) : null,
              )}
              {activeTab === "embed" && (
                <EmbedTab url={embedUrl} onUrlChange={setEmbedUrl} onSubmit={handleSubmitEmbed} />
              )}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function WidgetGrid({
  widgets,
  currentComponentId,
  onSelect,
}: {
  widgets: WidgetOption[];
  currentComponentId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useThemeColors();

  return (
    <View className="flex-row flex-wrap gap-2.5 p-4">
      {widgets.map((widget) => {
        const isActive = currentComponentId === widget.id;
        return (
          <Pressable
            key={widget.id}
            onPress={() => onSelect(widget.id)}
            tabIndex={-1}
            className={cn(
              "flex-[0_0_31%] items-center rounded-lg border py-5",
              isActive
                ? "border-surface-overlay/12 bg-surface-overlay/8"
                : "border-surface-overlay/6 bg-surface-overlay/2 hover:bg-surface-overlay/5 active:bg-surface-overlay/8",
            )}
          >
            <View
              className={cn(
                "mb-3 size-10 items-center justify-center rounded-lg",
                isActive ? "bg-surface-overlay/10" : "bg-surface-overlay/6",
              )}
            >
              <widget.icon
                size={20}
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
            <Text className="text-muted-foreground mt-0.5 text-center font-sans text-xs">
              {widget.description}
            </Text>
          </Pressable>
        );
      })}
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
