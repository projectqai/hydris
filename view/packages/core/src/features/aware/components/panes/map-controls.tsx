"use no memo";

import type { BaseLayer } from "@hydris/map-engine/types";
import type { OverlayCategoryOption } from "@hydris/ui/controls";
import { ControlIconButton, OverlayCategory } from "@hydris/ui/controls";
import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { GRADIENT_PROPS, useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { LinearGradient } from "expo-linear-gradient";
import {
  ExternalLink,
  Eye,
  Hexagon,
  Layers,
  Link2,
  Map,
  PersonStanding,
  Radar,
  Radius,
  Route,
  Satellite,
  ZoomIn,
  ZoomOut,
} from "lucide-react-native";
import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ViewStyle } from "react-native";
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { toast } from "../../../../lib/sonner";
import {
  buildShareViewUrl,
  copyShareableLink,
  getShareableEntityUrl,
  getShareableLocationUrl,
  useUrlParams,
} from "../../../../lib/use-url-params";
import { layoutSnapshotRef } from "../../hooks/layout-snapshot";
import type { MapViewRef } from "../../map-view";
import { useLeftPanelStore } from "../../store/left-panel-store";
import { mapEngineActions } from "../../store/map-engine-store";
import { useMapStore } from "../../store/map-store";
import { DEFAULT_OVERLAYS, useOverlayStore } from "../../store/overlay-store";
import { useRangeRingStore } from "../../store/range-ring-store";
import { useSelectionStore } from "../../store/selection-store";
import { useTabStore } from "../../store/tab-store";

// Portals menus to document.body so they escape pane overflow clipping.
// Lazy-initialized to avoid Metro resolving react-dom for native bundles.
let portalTo: ((children: React.ReactNode, container: Element) => React.ReactPortal) | null = null;
function getPortalTo() {
  if (portalTo === null && process.env.EXPO_OS === "web") {
    portalTo = require("react-dom").createPortal;
  }
  return portalTo;
}

type NetworkType = "datalinks";
type SensorStatus = "online" | "degraded";
type TrackType = "red" | "neutral" | "unknown" | "blue" | "unclassified";
type VisualizationType = "coverage" | "shapes" | "detections" | "trackHistory";

const ICON_SIZE = 16;

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

const TRACK_OPTIONS: OverlayCategoryOption[] = [
  { id: "red", label: "Red", color: "red" },
  { id: "neutral", label: "Neutral", color: "green" },
  { id: "unknown", label: "Unknown", color: "yellow" },
  { id: "blue", label: "Blue", color: "blue" },
  { id: "unclassified", label: "Unclassified", color: "gray" },
];

const SENSOR_OPTIONS: OverlayCategoryOption[] = [
  { id: "online", label: "Online", color: "green" },
  { id: "degraded", label: "Degraded", color: "yellow" },
];

const NETWORK_OPTIONS: OverlayCategoryOption[] = [
  { id: "datalinks", label: "Datalinks", color: "blue" },
];

const VISUALIZATION_OPTIONS: OverlayCategoryOption[] = [
  { id: "coverage", label: "Coverage Area", icon: Radius },
  { id: "shapes", label: "Geoshapes", icon: Hexagon },
  { id: "detections", label: "Detections", icon: Radar },
  { id: "trackHistory", label: "Track Lines", icon: Route },
];

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
  const anchorRectRef = useRef<DOMRect | null>(null);

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
        anchorRectRef.current = { left: x, top: y, right: x + w, bottom: y + h } as DOMRect;
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
  const tracks = useOverlayStore((state) => state.tracks);
  const sensors = useOverlayStore((state) => state.sensors);
  const network = useOverlayStore((state) => state.network);
  const visualization = useOverlayStore((state) => state.visualization);
  const toggleOverlayStore = useOverlayStore((state) => state.toggle);
  const rangeRingPlacing = useRangeRingStore((s) => s.isPlacing);
  const rangeRingCenter = useRangeRingStore((s) => s.center);
  const toggleRangeRing = useRangeRingStore((s) => s.togglePlacing);
  const rangeRingActive = rangeRingPlacing || rangeRingCenter != null;
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const layerBtnRef = useRef<View>(null);
  const overlayBtnRef = useRef<View>(null);
  const shareBtnRef = useRef<View>(null);

  const anyMenuOpen = showLayerMenu || showOverlayMenu || showShareMenu;

  const closeAllMenus = () => {
    setShowLayerMenu(false);
    setShowOverlayMenu(false);
    setShowShareMenu(false);
  };

  useKeyboardShortcut(
    "Escape",
    () => {
      if (rangeRingActive) {
        useRangeRingStore.getState().clear();
        return true;
      }
      if (anyMenuOpen) {
        closeAllMenus();
        return true;
      }
      return false;
    },
    { priority: 200 },
  );

  const handleLayerSelect = (layer: BaseLayer) => {
    setLayerStore(layer);
    setShowLayerMenu(false);
  };

  const toggleOverlay = <K extends "tracks" | "sensors" | "network" | "visualization">(
    category: K,
    item: string,
  ) => {
    toggleOverlayStore(category, item as never);
  };

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
    const fullUrl = buildShareViewUrl({
      getSelectedEntityId: () => useSelectionStore.getState().selectedEntityId,
      getMapView: () => viewRef?.current ?? mapEngineActions.getView(),
      getTab: () => paramsRef.current.tab,
      getLayoutSnapshot: () => layoutSnapshotRef.current,
      getOverlayState: () => {
        const overlays = useOverlayStore.getState();
        return {
          tracks: overlays.tracks,
          sensors: overlays.sensors,
          network: overlays.network,
          visualization: overlays.visualization,
        };
      },
      getDefaultOverlays: () => DEFAULT_OVERLAYS,
      getLayer: () => useMapStore.getState().layer,
      getListMode: () => useLeftPanelStore.getState().listMode,
      getDetailTab: () => useTabStore.getState().activeDetailTab,
    });
    if (!fullUrl) return;

    if (fullUrl.length > 2000) {
      toast.warning("URL is very long and may not work in all browsers");
    }

    copyShareableLink(fullUrl);
    setShowShareMenu(false);
  };

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
              className="border-border/40 w-full gap-0.5 overflow-hidden rounded-lg border p-1"
            >
              {LAYER_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = currentLayer === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => handleLayerSelect(option.id)}
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
                          "text-sm",
                          isSelected
                            ? "font-sans-medium text-foreground"
                            : "font-sans-medium text-on-surface/70",
                        )}
                      >
                        {option.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
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
              className="border-border/40 w-[290px] gap-2.5 overflow-hidden rounded-lg border p-2.5"
            >
              <OverlayCategory
                title="Tracks"
                options={TRACK_OPTIONS}
                activeStates={tracks}
                onToggle={(id) => toggleOverlay("tracks", id as TrackType)}
              />

              <OverlayCategory
                title="Sensors"
                options={SENSOR_OPTIONS}
                activeStates={sensors}
                onToggle={(id) => toggleOverlay("sensors", id as SensorStatus)}
              />

              <OverlayCategory
                title="Network"
                options={NETWORK_OPTIONS}
                activeStates={network}
                onToggle={(id) => toggleOverlay("network", id as NetworkType)}
              />

              <OverlayCategory
                title="Visualization"
                options={VISUALIZATION_OPTIONS}
                activeStates={visualization}
                onToggle={(id) => toggleOverlay("visualization", id as VisualizationType)}
              />
            </LinearGradient>
          </ControlMenu>
        </View>

        <ControlIconButton
          icon={PersonStanding}
          iconSize={ICON_SIZE + 3}
          iconColor={rangeRingActive ? t.activeGreen : undefined}
          onPress={() => {
            closeAllMenus();
            toggleRangeRing();
          }}
          variant={rangeRingActive ? "active" : "default"}
          size="lg"
          accessibilityLabel="Range rings"
        />

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
    </>
  );
}
