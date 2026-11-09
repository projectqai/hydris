"use no memo";

import type { ActiveTool } from "@hydris/map-engine/adapters/maplibre";
import type { BaseLayer, DrawingKind } from "@hydris/map-engine/types";
import type { OverlayCategoryOption } from "@hydris/ui/controls";
import { ControlIconButton, ControlSlider, OverlayCategory } from "@hydris/ui/controls";
import { ExpandingIconGroup } from "@hydris/ui/controls/expanding-icon-group";
import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { GRADIENT_PROPS, useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import {
  ExternalLink,
  Eye,
  Group,
  Hexagon,
  Layers,
  Link2,
  Map,
  Radar,
  Radius,
  Route,
  RulerDimensionLine,
  Satellite,
  Shapes,
  ZoomIn,
  ZoomOut,
} from "lucide-react-native";
import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ViewStyle } from "react-native";
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView, ScrollView } from "react-native-gesture-handler";
import Animated, { FadeIn } from "react-native-reanimated";
import { useShallow } from "zustand/react/shallow";

import { toast } from "../../../../lib/sonner";
import {
  buildShareViewUrl,
  copyShareableLink,
  getShareableEntityUrl,
  getShareableLocationUrl,
  useUrlParams,
} from "../../../../lib/use-url-params";
import { FEATURE_SHAPE_DRAWING } from "../../constants";
import type { MapViewRef } from "../../map-view";
import { useBullseyeStore } from "../../store/bullseye-store";
import { useEditStore } from "../../store/edit-store";
import { useEntityStore } from "../../store/entity-store";
import { mapEngineActions } from "../../store/map-engine-store";
import { useMapStore } from "../../store/map-store";
import { useOverlayStore } from "../../store/overlay-store";
import { selectPathKind, usePathStore } from "../../store/path-store";
import { saveEdit } from "../../store/save-edit";
import { savePath } from "../../store/save-path";
import { useSelectionStore } from "../../store/selection-store";
import { TOOL } from "../../utils/map-paths";
import { shareViewUrlDeps } from "../../utils/share-view-url-deps";
import { TOOL_ICON } from "../tool-icons";

// Portals menus to document.body so they escape pane overflow clipping.
// Lazy-initialized to avoid Metro resolving react-dom for native bundles.
let portalTo: ((children: React.ReactNode, container: Element) => React.ReactPortal) | null = null;
function getPortalTo() {
  if (portalTo === null && process.env.EXPO_OS === "web") {
    portalTo = require("react-dom").createPortal;
  }
  return portalTo;
}

const ICON_SIZE = 16;

function isOfflineMap(e: Entity): boolean {
  return e.mapLayer?.source.case === "tiles" && e.mapLayer.source.value.url.startsWith("/tiles/");
}

function isTextInputFocused(): boolean {
  if (process.env.EXPO_OS !== "web") return false;
  const element = document.activeElement;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    (element as HTMLElement).isContentEditable
  );
}

type LayerOption = {
  id: BaseLayer;
  label: string;
  icon: typeof Layers;
};

const LAYER_OPTIONS: LayerOption[] = [
  { id: "dark", label: "Dark", icon: Layers },
  { id: "satellite", label: "Satellite", icon: Satellite },
  { id: "street", label: "Street", icon: Map },
];

const LAYER_ICONS: Record<BaseLayer, typeof Layers> = {
  dark: Layers,
  satellite: Satellite,
  street: Map,
};

const TRACK_OPTIONS = [
  { id: "red", label: "Red", color: "red" },
  { id: "neutral", label: "Neutral", color: "green" },
  { id: "unknown", label: "Unknown", color: "yellow" },
  { id: "blue", label: "Blue", color: "blue" },
  { id: "unclassified", label: "Unclassified", color: "gray" },
] as const satisfies readonly OverlayCategoryOption[];

const SENSOR_OPTIONS = [
  { id: "online", label: "Online", color: "green" },
  { id: "degraded", label: "Degraded", color: "yellow" },
] as const satisfies readonly OverlayCategoryOption[];

const NETWORK_OPTIONS = [
  { id: "datalinks", label: "Datalinks", color: "blue" },
] as const satisfies readonly OverlayCategoryOption[];

const VISUALIZATION_OPTIONS = [
  { id: "coverage", label: "Coverage Area", icon: Radius },
  { id: "shapes", label: "Geoshapes", icon: Hexagon },
  { id: "detections", label: "Detections", icon: Radar },
  { id: "trackHistory", label: "Track Lines", icon: Route },
  { id: "clustering", label: "Clustering", icon: Group },
] as const satisfies readonly OverlayCategoryOption[];

type ViewState = { lat: number; lng: number; zoom: number };

type MapControlsProps = {
  mapRef?: RefObject<MapViewRef | null>;
  viewRef?: RefObject<ViewState>;
};

const MENU_GAP = 8;
const VIEWPORT_PAD = 8;

// position: "fixed" is valid on RN Web but not in RN types
function fixedStyle(props: Record<string, number>): ViewStyle {
  return { position: "fixed", ...props } as unknown as ViewStyle;
}

function ControlMenu({
  visible,
  children,
  anchorRef,
  onClose,
}: {
  visible: boolean;
  children: React.ReactNode;
  anchorRef: RefObject<View | null>;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [ready, setReady] = useState(false);
  const menuRef = useRef<View>(null);
  const anchorRectRef = useRef<Pick<DOMRect, "left" | "top" | "right" | "bottom"> | null>(null);

  // Phase 1: rough position from anchor (gets menu into the DOM for measurement)
  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      setReady(false);
      anchorRectRef.current = null;
      return;
    }
    if (process.env.EXPO_OS === "web") {
      const rect = (anchorRef.current as unknown as HTMLElement)?.getBoundingClientRect();
      if (rect) {
        anchorRectRef.current = rect;
        setPos({ top: rect.top, left: rect.left - MENU_GAP });
        setReady(false);
      }
    } else {
      anchorRef.current?.measureInWindow((x, y, w, h) => {
        anchorRectRef.current = { left: x, top: y, right: x + w, bottom: y + h };
        setPos({ top: y, left: x - MENU_GAP });
        setReady(false);
      });
    }
  }, [visible, anchorRef]);

  // Phase 2 (web): correct position using actual menu dimensions
  useLayoutEffect(() => {
    if (!pos || ready || process.env.EXPO_OS !== "web") return;
    const menuEl = menuRef.current as unknown as HTMLElement;
    const anchor = anchorRectRef.current;
    if (!menuEl || !anchor) return;

    const menu = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchor.left - menu.width - MENU_GAP;
    if (left < VIEWPORT_PAD) left = anchor.right + MENU_GAP;
    if (left + menu.width > vw - VIEWPORT_PAD) left = VIEWPORT_PAD;

    let top = anchor.top;
    if (top + menu.height > vh - VIEWPORT_PAD) {
      top = Math.max(VIEWPORT_PAD, vh - menu.height - VIEWPORT_PAD);
    }

    setPos({ top, left });
    setReady(true);
  }, [pos, ready]);

  // Phase 2 (native): clamp to screen bounds via onLayout measurement
  const handleNativeMenuLayout = (e: {
    nativeEvent: { layout: { width: number; height: number } };
  }) => {
    if (ready || !anchorRectRef.current) return;
    const { width: mw, height: mh } = e.nativeEvent.layout;
    const anchor = anchorRectRef.current;
    const { width: sw, height: sh } = Dimensions.get("window");

    let left = anchor.left - mw - MENU_GAP;
    if (left < VIEWPORT_PAD) left = anchor.right + MENU_GAP;
    if (left + mw > sw - VIEWPORT_PAD) left = VIEWPORT_PAD;

    let top = anchor.top;
    if (top + mh > sh - VIEWPORT_PAD) {
      top = Math.max(VIEWPORT_PAD, sh - mh - VIEWPORT_PAD);
    }

    setPos({ top, left });
    setReady(true);
  };

  if (!visible) return null;

  const portal = getPortalTo();
  if (portal) {
    if (!pos) return null;
    return portal(
      <>
        <Pressable
          style={fixedStyle({ top: 0, left: 0, right: 0, bottom: 0, zIndex: 99998 })}
          onPress={onClose}
          accessibilityLabel="Close menu"
        />
        <Animated.View
          ref={menuRef}
          entering={ready ? FadeIn.duration(150) : undefined}
          style={[
            fixedStyle({ top: pos.top, left: pos.left, zIndex: 99999 }),
            !ready && ({ opacity: 0 } as ViewStyle),
          ]}
        >
          {children}
        </Animated.View>
      </>,
      document.body,
    );
  }

  // Native: Modal escapes pane overflow, same as web portal
  if (!pos) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close menu"
        />
        <Animated.View
          onLayout={handleNativeMenuLayout}
          entering={ready ? FadeIn.duration(150) : undefined}
          style={[{ position: "absolute", top: pos.top, left: pos.left }, !ready && { opacity: 0 }]}
        >
          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export function MapControls({ mapRef, viewRef }: MapControlsProps) {
  const t = useThemeColors();
  const { params } = useUrlParams();
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const currentLayer = useMapStore((state) => state.layer);
  const setLayerStore = useMapStore((state) => state.setLayer);
  const offlineBasemapId = useMapStore((state) => state.offlineBasemapId);
  const setOfflineBasemap = useMapStore((state) => state.setOfflineBasemap);
  const tracks = useOverlayStore((state) => state.tracks);
  const sensors = useOverlayStore((state) => state.sensors);
  const network = useOverlayStore((state) => state.network);
  const visualization = useOverlayStore((state) => state.visualization);
  const hiddenLayers = useOverlayStore((state) => state.hiddenLayers);
  const toggleOverlayStore = useOverlayStore((state) => state.toggle);
  const toggleLayer = useOverlayStore((state) => state.toggleLayer);
  const layerOpacity = useOverlayStore((state) => state.layerOpacity);
  const setLayerOpacity = useOverlayStore((state) => state.setLayerOpacity);
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);
  const mapLayerEntities = useEntityStore(
    useShallow((s) => Array.from(s.entities.values()).filter((e) => e.mapLayer)),
  );
  const offlineBasemapOptions = mapLayerEntities.filter(isOfflineMap);
  const pluginMapLayers = mapLayerEntities.filter((e) => !isOfflineMap(e));
  const expandedLayer = pluginMapLayers.find((e) => e.id === expandedLayerId);
  // handles proto3 zero-default for opacity
  const expandedOpacity =
    expandedLayer?.mapLayer != null
      ? (layerOpacity[expandedLayer.id] ?? (expandedLayer.mapLayer.opacity || 1))
      : 1;
  const bullseyePlacing = useBullseyeStore((s) => s.isPlacing);
  const bullseyeCenter = useBullseyeStore((s) => s.center);
  const toggleBullseye = useBullseyeStore((s) => s.togglePlacing);
  const bullseyeActive = bullseyePlacing || bullseyeCenter != null;
  const pathKind = usePathStore(selectPathKind);
  const rangeActive = pathKind === "range";
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showRangeTools, setShowRangeTools] = useState(false);
  const [showDrawTools, setShowDrawTools] = useState(false);
  const drawingKind = pathKind === "range" ? null : pathKind;
  const layerBtnRef = useRef<View>(null);
  const overlayBtnRef = useRef<View>(null);
  const shareBtnRef = useRef<View>(null);

  const anyMenuOpen =
    showLayerMenu || showOverlayMenu || showShareMenu || showRangeTools || showDrawTools;

  const closeAllMenus = () => {
    setShowLayerMenu(false);
    setShowOverlayMenu(false);
    setShowShareMenu(false);
    setShowRangeTools(false);
    setShowDrawTools(false);
  };

  const toggleDrawing = (kind: DrawingKind) => {
    closeAllMenus();
    useEditStore.getState().cancel();
    const state = usePathStore.getState();
    if (selectPathKind(state) === "range") void savePath(state.toggleActive());
    useBullseyeStore.getState().clear();
    const current = usePathStore.getState();
    if (selectPathKind(current) === kind) current.cancel();
    else current.start(kind);
  };

  const drawingOption = (id: DrawingKind, icon: LucideIcon, label: string) => ({
    id,
    icon,
    label,
    active: drawingKind === id,
    iconColor: drawingKind === id ? t.activeGreen : undefined,
    arm: () => toggleDrawing(id),
  });

  const toolOption = (
    id: Exclude<ActiveTool, "none">,
    icon: LucideIcon,
    label: string,
    active: boolean,
  ) => ({
    id,
    icon,
    label,
    active,
    iconColor: active ? t.activeGreen : undefined,
    arm: () => toggleTool(id),
  });

  const toggleTool = (tool: Exclude<ActiveTool, "none">) => {
    closeAllMenus();
    useEditStore.getState().cancel();
    const path = usePathStore.getState();
    if (selectPathKind(path) !== "range") path.cancel();
    if (tool === "range") {
      useBullseyeStore.getState().clear();
      void savePath(usePathStore.getState().toggleActive());
    } else {
      if (rangeActive) void savePath(usePathStore.getState().toggleActive());
      toggleBullseye();
    }
  };

  useKeyboardShortcut(
    "Escape",
    () => {
      if (useEditStore.getState().entityId) {
        useEditStore.getState().cancel();
        return true;
      }
      if (drawingKind) {
        usePathStore.getState().cancel();
        return true;
      }
      if (bullseyeActive) {
        useBullseyeStore.getState().clear();
        return true;
      }
      if (anyMenuOpen) {
        closeAllMenus();
        return true;
      }
      return false;
    },
    { priority: 100 },
  );

  // Enter is whatever the mode bar's primary button is: end the edit, finish
  // the shape, finish the measurement.
  useKeyboardShortcut(
    "Enter",
    () => {
      if (isTextInputFocused()) return false;
      const edit = useEditStore.getState();
      if (edit.entityId) {
        void saveEdit(edit.end());
        return true;
      }
      const path = usePathStore.getState();
      if (!path.drawingId) return false;
      void savePath(path.finish());
      return true;
    },
    { priority: 150 },
  );

  useKeyboardShortcut(
    "Backspace",
    () => {
      if (isTextInputFocused()) return false;
      if (useEditStore.getState().entityId) {
        useEditStore.getState().undo();
        return true;
      }
      if (!pathKind) return false;
      usePathStore.getState().undo();
      return true;
    },
    { priority: 200 },
  );

  const handleLayerSelect = (layer: BaseLayer) => {
    setLayerStore(layer);
    setShowLayerMenu(false);
  };

  const handleOfflineSelect = (id: string) => {
    setOfflineBasemap(id);
    setShowLayerMenu(false);
  };

  const offlineActive = offlineBasemapOptions.some((e) => e.id === offlineBasemapId);
  const basemapOptions = [
    ...LAYER_OPTIONS.map((o) => ({
      key: o.id,
      label: o.label,
      icon: o.icon,
      isSelected: !offlineActive && currentLayer === o.id,
      onPress: () => handleLayerSelect(o.id),
    })),
    ...offlineBasemapOptions.map((e) => ({
      key: e.id,
      label: e.label || e.id,
      icon: Map,
      isSelected: offlineBasemapId === e.id,
      onPress: () => handleOfflineSelect(e.id),
    })),
  ];

  const handleZoomIn = () => {
    if (mapRef?.current) {
      mapRef.current.zoomIn();
    } else {
      mapEngineActions.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapRef?.current) {
      mapRef.current.zoomOut();
    } else {
      mapEngineActions.zoomOut();
    }
  };

  const getBaseShareUrl = () => {
    const selectedEntityId = useSelectionStore.getState().selectedEntityId;
    const view = viewRef?.current ?? mapEngineActions.getView();
    const currentParams = paramsRef.current;
    if (!view) return null;
    if (selectedEntityId) {
      return getShareableEntityUrl(selectedEntityId, {
        tab: currentParams.tab,
        zoom: view.zoom,
        lat: view.lat,
        lng: view.lng,
      });
    }
    return getShareableLocationUrl(view.lat, view.lng, { zoom: view.zoom });
  };

  const handleCopyLink = () => {
    const url = getBaseShareUrl();
    if (url) copyShareableLink(url);
    setShowShareMenu(false);
  };

  const handleCopyLinkWithLayout = () => {
    const fullUrl = buildShareViewUrl(
      shareViewUrlDeps({
        getMapView: () => viewRef?.current ?? mapEngineActions.getView(),
        getTab: () => paramsRef.current.tab,
      }),
    );
    if (!fullUrl) return;

    if (fullUrl.length > 2000) {
      toast.warning("URL is very long and may not work in all browsers");
    }

    copyShareableLink(fullUrl);
    setShowShareMenu(false);
  };

  const rangeTools = [
    toolOption("range", TOOL_ICON.range, TOOL.range.label, rangeActive),
    ...(FEATURE_SHAPE_DRAWING
      ? [drawingOption("rb-circle", TOOL_ICON["rb-circle"], TOOL["rb-circle"].label)]
      : []),
    toolOption("bullseye", TOOL_ICON.bullseye, "Bullseye", bullseyeActive),
  ];

  const drawingTools = [
    drawingOption("circle", TOOL_ICON.circle, TOOL.circle.label),
    drawingOption("rectangle", TOOL_ICON.rectangle, TOOL.rectangle.label),
    drawingOption("freeform", TOOL_ICON.freeform, TOOL.freeform.label),
  ];

  return (
    <>
      {!getPortalTo() && anyMenuOpen && (
        <Pressable
          className="absolute inset-0 z-9"
          onPress={closeAllMenus}
          accessibilityLabel="Close menu"
        />
      )}
      <View className="absolute top-3 right-3 z-10 gap-2" pointerEvents="box-none">
        <View ref={layerBtnRef} className="relative">
          <ControlIconButton
            icon={LAYER_ICONS[currentLayer]}
            iconSize={ICON_SIZE}
            onPress={() => {
              setShowLayerMenu(!showLayerMenu);
              setShowOverlayMenu(false);
              setShowShareMenu(false);
            }}
            variant={showLayerMenu ? "active" : "default"}
            size="lg"
            accessibilityLabel="Base layer"
          />

          <ControlMenu visible={showLayerMenu} anchorRef={layerBtnRef} onClose={closeAllMenus}>
            <LinearGradient
              colors={t.gradients.default}
              {...GRADIENT_PROPS}
              className="border-border/40 gap-0.5 self-start overflow-hidden rounded-lg border p-1"
            >
              {basemapOptions.map(({ key, label, icon: Icon, isSelected, onPress }) => (
                <Pressable
                  key={key}
                  onPress={onPress}
                  accessibilityRole="radio"
                  aria-checked={isSelected}
                  className={cn(
                    "hover:bg-surface-overlay/10 active:bg-surface-overlay/15 min-w-28 rounded",
                    isSelected && "bg-surface-overlay/15 hover:bg-surface-overlay/15",
                  )}
                >
                  <View className="flex-row items-center gap-2.5 px-3 py-2.5 select-none">
                    <Icon size={ICON_SIZE} color={isSelected ? t.iconActive : t.iconDefault} />
                    <Text
                      selectable={false}
                      className={cn(
                        "font-sans-medium text-sm",
                        isSelected ? "text-foreground" : "text-on-surface/70",
                      )}
                    >
                      {label}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </LinearGradient>
          </ControlMenu>
        </View>

        <View ref={overlayBtnRef} className="relative">
          <ControlIconButton
            icon={Eye}
            iconSize={ICON_SIZE}
            onPress={() => {
              setShowOverlayMenu(!showOverlayMenu);
              setShowLayerMenu(false);
              setShowShareMenu(false);
            }}
            variant={showOverlayMenu ? "active" : "default"}
            size="lg"
            accessibilityLabel="Overlays"
          />

          <ControlMenu visible={showOverlayMenu} anchorRef={overlayBtnRef} onClose={closeAllMenus}>
            <LinearGradient
              colors={t.gradients.default}
              {...GRADIENT_PROPS}
              className="border-border/40 w-[290px] overflow-hidden rounded-lg border"
            >
              <ScrollView className="max-h-[80vh]">
                <View className="gap-2.5 p-2.5">
                  <OverlayCategory
                    title="Tracks"
                    options={TRACK_OPTIONS}
                    activeStates={tracks}
                    onToggle={(id) => toggleOverlayStore("tracks", id)}
                  />

                  <OverlayCategory
                    title="Sensors"
                    options={SENSOR_OPTIONS}
                    activeStates={sensors}
                    onToggle={(id) => toggleOverlayStore("sensors", id)}
                  />

                  <OverlayCategory
                    title="Network"
                    options={NETWORK_OPTIONS}
                    activeStates={network}
                    onToggle={(id) => toggleOverlayStore("network", id)}
                  />

                  <OverlayCategory
                    title="Visualization"
                    options={VISUALIZATION_OPTIONS}
                    activeStates={visualization}
                    onToggle={(id) => toggleOverlayStore("visualization", id)}
                  />

                  {pluginMapLayers.length > 0 && (
                    <View className="gap-1.5">
                      <Text
                        selectable={false}
                        className="text-12 text-on-surface/70 font-sans-medium tracking-wider uppercase"
                      >
                        Layers
                      </Text>
                      <View className="flex-row flex-wrap gap-1">
                        {pluginMapLayers.map((e) => {
                          const visible = !hiddenLayers[e.id];
                          return (
                            <Pressable
                              key={e.id}
                              onPress={() =>
                                setExpandedLayerId(expandedLayerId === e.id ? null : e.id)
                              }
                              className={cn(
                                "flex-row items-center gap-2 rounded px-2.5 py-1 select-none",
                                visible
                                  ? "bg-surface-overlay/15 hover:bg-surface-overlay/20 active:bg-surface-overlay/25"
                                  : "bg-surface-overlay/5 hover:bg-surface-overlay/10 active:bg-surface-overlay/15",
                              )}
                            >
                              <Layers
                                size={14}
                                strokeWidth={1.5}
                                color={visible ? t.iconActive : t.iconSubtle}
                              />
                              <Text
                                selectable={false}
                                className={cn(
                                  "font-sans-medium text-sm",
                                  visible ? "text-foreground" : "text-on-surface/40",
                                )}
                              >
                                {e.label || e.id}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {expandedLayer?.mapLayer && (
                        <View className="bg-surface-overlay/10 mt-1 gap-2 rounded p-2">
                          <View className="flex-row items-center justify-between gap-2">
                            <Text
                              selectable={false}
                              className="text-foreground font-sans-medium flex-1 text-sm"
                              numberOfLines={1}
                            >
                              {expandedLayer.label || expandedLayer.id}
                            </Text>
                            <Text
                              selectable={false}
                              className="text-on-surface/60 font-mono text-xs tabular-nums"
                            >
                              {Math.round(expandedOpacity * 100)}%
                            </Text>
                            <Pressable
                              onPress={() => toggleLayer(expandedLayer.id)}
                              className={cn(
                                "w-14 items-center rounded px-2 py-0.5",
                                !hiddenLayers[expandedLayer.id]
                                  ? "bg-surface-overlay/25"
                                  : "bg-surface-overlay/10",
                              )}
                            >
                              <Text
                                selectable={false}
                                className={cn(
                                  "font-sans-medium text-xs",
                                  !hiddenLayers[expandedLayer.id]
                                    ? "text-foreground"
                                    : "text-on-surface/60",
                                )}
                              >
                                {!hiddenLayers[expandedLayer.id] ? "Visible" : "Hidden"}
                              </Text>
                            </Pressable>
                          </View>
                          <ControlSlider
                            value={expandedOpacity}
                            onValueChange={(v) => setLayerOpacity(expandedLayer.id, v)}
                            min={0}
                            max={1}
                            step={0.05}
                            accessibilityLabel="Layer opacity"
                            compact
                          />
                        </View>
                      )}
                    </View>
                  )}
                </View>
              </ScrollView>
            </LinearGradient>
          </ControlMenu>
        </View>

        <ExpandingIconGroup
          icon={RulerDimensionLine}
          label="Range tools"
          iconSize={ICON_SIZE}
          expanded={showRangeTools}
          onExpandedChange={(next) => {
            closeAllMenus();
            setShowRangeTools(next);
          }}
          onSelect={(id) => rangeTools.find((tool) => tool.id === id)?.arm()}
          options={rangeTools}
        />

        {FEATURE_SHAPE_DRAWING && (
          <ExpandingIconGroup
            icon={Shapes}
            label="Drawing tools"
            iconSize={ICON_SIZE}
            expanded={showDrawTools}
            onExpandedChange={(next) => {
              closeAllMenus();
              setShowDrawTools(next);
            }}
            onSelect={(id) => drawingTools.find((tool) => tool.id === id)?.arm()}
            options={drawingTools}
          />
        )}

        <View ref={shareBtnRef} className="relative">
          <ControlIconButton
            icon={Link2}
            iconSize={ICON_SIZE}
            onPress={() => {
              setShowShareMenu(!showShareMenu);
              setShowLayerMenu(false);
              setShowOverlayMenu(false);
            }}
            variant={showShareMenu ? "active" : "default"}
            size="lg"
            accessibilityLabel="Share"
          />

          <ControlMenu visible={showShareMenu} anchorRef={shareBtnRef} onClose={closeAllMenus}>
            <LinearGradient
              colors={t.gradients.default}
              {...GRADIENT_PROPS}
              className="border-border/40 w-64 gap-0.5 overflow-hidden rounded-lg border p-1"
            >
              <Pressable
                onPress={handleCopyLink}
                className="hover:bg-surface-overlay/10 active:bg-surface-overlay/15 rounded"
              >
                <View className="gap-0.5 px-3 py-2.5 select-none">
                  <View className="flex-row items-center gap-2.5">
                    <Link2 size={ICON_SIZE} color={t.iconDefault} />
                    <Text
                      selectable={false}
                      className="text-on-surface/70 font-sans-medium text-sm"
                    >
                      Share focus
                    </Text>
                  </View>
                  <Text
                    selectable={false}
                    className="text-on-surface/65 pl-[26px] font-sans text-xs"
                  >
                    Link to current entity or position
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={handleCopyLinkWithLayout}
                className="hover:bg-surface-overlay/10 active:bg-surface-overlay/15 rounded"
              >
                <View className="gap-0.5 px-3 py-2.5 select-none">
                  <View className="flex-row items-center gap-2.5">
                    <ExternalLink size={ICON_SIZE} color={t.iconDefault} />
                    <Text
                      selectable={false}
                      className="text-on-surface/70 font-sans-medium text-sm"
                    >
                      Share view
                    </Text>
                  </View>
                  <Text
                    selectable={false}
                    className="text-on-surface/65 pl-[26px] font-sans text-xs"
                  >
                    Link with layout, layers and filters
                  </Text>
                </View>
              </Pressable>
            </LinearGradient>
          </ControlMenu>
        </View>
      </View>

      <View className="absolute bottom-3 left-3 z-10 gap-2" pointerEvents="box-none">
        <ControlIconButton
          icon={ZoomIn}
          iconSize={ICON_SIZE}
          onPress={handleZoomIn}
          size="lg"
          accessibilityLabel="Zoom in"
        />

        <ControlIconButton
          icon={ZoomOut}
          iconSize={ICON_SIZE}
          onPress={handleZoomOut}
          size="lg"
          accessibilityLabel="Zoom out"
        />
      </View>
    </>
  );
}
