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
  Radius,
  Route,
  Satellite,
  ZoomIn,
  ZoomOut,
} from "lucide-react-native";
import type { RefObject } from "react";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { toast } from "sonner-native";

import {
  copyShareableLink,
  encodeViewState,
  getShareableEntityUrl,
  getShareableLocationUrl,
  getShareableViewUrl,
  useUrlParams,
  type ViewStatePayload,
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

type NetworkType = "datalinks";
type SensorStatus = "online" | "degraded";
type TrackType = "red" | "neutral" | "unknown" | "blue";
type VisualizationType = "coverage" | "shapes" | "trackHistory";

const BUTTON_SIZE = 40;
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
  { id: "trackHistory", label: "Track Lines", icon: Route },
];

type ViewState = { lat: number; lng: number; zoom: number };

type MapControlsProps = {
  mapRef?: RefObject<MapViewRef | null>;
  viewRef?: RefObject<ViewState>;
};

function ControlMenu({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(100)}
      style={{ position: "absolute", top: 0, right: BUTTON_SIZE + 8 }}
    >
      {children}
    </Animated.View>
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
    const url = getBaseShareUrl();
    if (!url) return;

    const snap = layoutSnapshotRef.current;
    const payload: ViewStatePayload = { p: snap.activePresetId };

    if (snap.isModified) {
      payload.t = snap.tree;
    }

    const overlayState = useOverlayStore.getState();
    const overlayDiff: Record<string, Record<string, boolean>> = {};
    for (const cat of Object.keys(DEFAULT_OVERLAYS) as (keyof typeof DEFAULT_OVERLAYS)[]) {
      const defaults = DEFAULT_OVERLAYS[cat];
      const current = overlayState[cat];
      const diff: Record<string, boolean> = {};
      let hasDiff = false;
      for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
        if (current[key] !== defaults[key]) {
          diff[key] = current[key] as boolean;
          hasDiff = true;
        }
      }
      if (hasDiff) overlayDiff[cat] = diff;
    }
    if (Object.keys(overlayDiff).length > 0) {
      payload.o = overlayDiff;
    }

    const layer = useMapStore.getState().layer;
    if (layer !== "satellite") {
      payload.l = layer;
    }

    const listMode = useLeftPanelStore.getState().listMode;
    if (listMode !== "tracks") {
      payload.list = listMode;
    }

    const selectedEntityId = useSelectionStore.getState().selectedEntityId;
    if (selectedEntityId) {
      const detailTab = useTabStore.getState().activeDetailTab;
      if (detailTab !== "overview") {
        payload.tab = detailTab;
      }
    }

    const viewState = encodeViewState(payload);
    const fullUrl = getShareableViewUrl(url, viewState);

    if (fullUrl.length > 2000) {
      toast.warning("URL is very long and may not work in all browsers");
    }

    copyShareableLink(fullUrl);
    setShowShareMenu(false);
  };

  return (
    <>
      {anyMenuOpen && (
        <Pressable
          className="absolute inset-0 z-9"
          onPress={closeAllMenus}
          accessibilityLabel="Close menu"
        />
      )}
      <View className="absolute top-3 right-3 z-10 gap-2" pointerEvents="box-none">
        <View className="relative">
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

          <ControlMenu visible={showLayerMenu}>
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

        <View className="relative">
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

          <ControlMenu visible={showOverlayMenu}>
            <LinearGradient
              colors={t.gradients.default}
              {...GRADIENT_PROPS}
              className="border-border/40 min-w-60 gap-2.5 overflow-hidden rounded-lg border p-2.5"
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

        <View className="relative">
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

          <ControlMenu visible={showShareMenu}>
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
