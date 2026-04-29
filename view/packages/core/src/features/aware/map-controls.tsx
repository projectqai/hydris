import type { BaseLayer } from "@hydris/map-engine/types";
import type { OverlayCategoryOption } from "@hydris/ui/controls";
import { ControlIconButton, OverlayCategory } from "@hydris/ui/controls";
import { GRADIENT_PROPS, useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { PANEL_TOP_OFFSET, usePanelContext } from "@hydris/ui/panels";
import { LinearGradient } from "expo-linear-gradient";
import {
  ExternalLink,
  Eye,
  Hexagon,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  Radar,
  Radius,
  Route,
  Satellite,
  ZoomIn,
  ZoomOut,
} from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import {
  buildShareViewUrl,
  copyShareableLink,
  getShareableEntityUrl,
  getShareableLocationUrl,
  useUrlParams,
} from "../../lib/use-url-params";
import { layoutSnapshotRef } from "./hooks/layout-snapshot";
import { MapSearchControl } from "./map-search";
import { useLeftPanelStore } from "./store/left-panel-store";
import { mapEngineActions, useMapEngine } from "./store/map-engine-store";
import { useMapStore } from "./store/map-store";
import { DEFAULT_OVERLAYS, useOverlayStore } from "./store/overlay-store";
import { useSelectionStore } from "./store/selection-store";
import { useTabStore } from "./store/tab-store";

type NetworkType = "datalinks";
type SensorStatus = "online" | "degraded";
type TrackType = "red" | "unknown" | "blue" | "unclassified";
type VisualizationType = "coverage" | "shapes" | "detections" | "trackHistory";

const BUTTON_SIZE = 40;
const ICON_SIZE = 16;
const RIGHT_PANEL_MARGIN = 12;

type LayerOption = {
  id: BaseLayer;
  label: string;
  icon: typeof Layers;
};

const LAYER_OPTIONS: LayerOption[] = [
  { id: "dark", label: "Dark", icon: Layers },
  { id: "satellite", label: "Satellite", icon: Satellite },
];

const SPRING_CONFIG = {
  damping: 35,
  stiffness: 180,
  mass: 1,
  overshootClamping: true,
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

export function MapControls() {
  const t = useThemeColors();
  const { height: windowHeight } = useWindowDimensions();
  const { params } = useUrlParams();
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const mapEngine = useMapEngine();
  const currentLayer = useMapStore((s) => s.layer);
  const setLayerStore = useMapStore((s) => s.setLayer);
  const tracks = useOverlayStore((s) => s.tracks);
  const sensors = useOverlayStore((s) => s.sensors);
  const network = useOverlayStore((s) => s.network);
  const visualization = useOverlayStore((s) => s.visualization);
  const toggleOverlayStore = useOverlayStore((s) => s.toggle);
  const {
    toggleFullscreen,
    isFullscreen,
    rightPanelCollapsed,
    rightPanelWidth,
    mapControlsHeight,
  } = usePanelContext();
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);

  const anyMenuOpen = showLayerMenu || showOverlayMenu || showSearch || showShareMenu;

  const closeAllMenus = () => {
    setShowLayerMenu(false);
    setShowOverlayMenu(false);
    setShowSearch(false);
    setShowShareMenu(false);
  };

  // Sync isFullscreenActive with isFullscreen SharedValue
  useAnimatedReaction(
    () => isFullscreen.value,
    (value) => runOnJS(setIsFullscreenActive)(value),
    [],
  );

  const panelMaxHeight = windowHeight - PANEL_TOP_OFFSET;
  const panelTop = windowHeight - panelMaxHeight - RIGHT_PANEL_MARGIN;

  const animatedContainerStyle = useAnimatedStyle(() => {
    const shouldMoveRight = isFullscreen.value || rightPanelCollapsed.value;
    const rightPosition = interpolate(
      shouldMoveRight ? 1 : 0,
      [0, 1],
      [rightPanelWidth.value + RIGHT_PANEL_MARGIN + 8, RIGHT_PANEL_MARGIN],
    );

    return {
      right: withSpring(rightPosition, SPRING_CONFIG),
    };
  });

  const handleFullscreenToggle = () => {
    toggleFullscreen();
    setShowLayerMenu(false);
    setShowOverlayMenu(false);
  };

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

  const handleCopyLink = () => {
    const selectedEntityId = useSelectionStore.getState().selectedEntityId;
    const view = mapEngineActions.getView();
    const currentParams = paramsRef.current;
    if (!view) return;
    const url = selectedEntityId
      ? getShareableEntityUrl(selectedEntityId, {
          tab: currentParams.tab,
          zoom: view.zoom,
          lat: view.lat,
          lng: view.lng,
        })
      : getShareableLocationUrl(view.lat, view.lng, { zoom: view.zoom });
    copyShareableLink(url);
    setShowShareMenu(false);
  };

  const handleCopyLinkWithLayout = () => {
    const fullUrl = buildShareViewUrl({
      getSelectedEntityId: () => useSelectionStore.getState().selectedEntityId,
      getMapView: () => mapEngineActions.getView(),
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
    if (fullUrl) copyShareableLink(fullUrl);
    setShowShareMenu(false);
  };

  const handleLayout = (event: { nativeEvent: { layout: { height: number } } }) => {
    const height = event.nativeEvent.layout.height;
    runOnUI(() => {
      "worklet";
      // eslint-disable-next-line react-compiler/react-compiler
      mapControlsHeight.value = height;
    })();
  };

  return (
    <>
      {process.env.EXPO_OS !== "web" && anyMenuOpen && (
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 }}
          onPress={closeAllMenus}
        />
      )}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: panelTop,
            zIndex: 10,
            gap: 8,
          },
          animatedContainerStyle,
        ]}
        pointerEvents="box-none"
        onLayout={handleLayout}
      >
        <ControlIconButton
          icon={isFullscreenActive ? Minimize2 : Maximize2}
          iconSize={ICON_SIZE}
          onPress={handleFullscreenToggle}
          variant={isFullscreenActive ? "active" : "default"}
          size="lg"
          accessibilityLabel={isFullscreenActive ? "Exit fullscreen" : "Enter fullscreen"}
        />

        <MapSearchControl
          isOpen={showSearch}
          onToggle={() => {
            setShowSearch(!showSearch);
            setShowLayerMenu(false);
            setShowOverlayMenu(false);
          }}
        />

        <View className="relative">
          <ControlIconButton
            icon={currentLayer === "satellite" ? Satellite : Layers}
            iconSize={ICON_SIZE}
            onPress={() => {
              setShowLayerMenu(!showLayerMenu);
              setShowOverlayMenu(false);
              setShowSearch(false);
            }}
            variant={showLayerMenu ? "active" : "default"}
            size="lg"
            accessibilityLabel="Map layers"
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
                          "text-sm select-none",
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
              setShowSearch(false);
            }}
            variant={showOverlayMenu ? "active" : "default"}
            size="lg"
            accessibilityLabel="Overlays"
          />

          <ControlMenu visible={showOverlayMenu}>
            <LinearGradient
              colors={t.gradients.default}
              {...GRADIENT_PROPS}
              className="border-border/40 gap-2.5 overflow-hidden rounded-lg border p-2.5"
              style={{ width: 290 }}
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
          icon={ZoomIn}
          iconSize={ICON_SIZE}
          onPress={mapEngine.zoomIn}
          size="lg"
          accessibilityLabel="Zoom in"
        />

        <ControlIconButton
          icon={ZoomOut}
          iconSize={ICON_SIZE}
          onPress={mapEngine.zoomOut}
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
              setShowSearch(false);
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
      </Animated.View>
    </>
  );
}
