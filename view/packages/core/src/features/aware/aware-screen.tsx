"use no memo";

import type { PaletteMode } from "@hydris/ui/command-palette/palette-reducer";
import { KeyboardProvider } from "@hydris/ui/keyboard";
import {
  ComponentRegistryContext,
  LayoutEditingContext,
  LeafRendererContext,
} from "@hydris/ui/layout/contexts";
import { LayoutRenderer } from "@hydris/ui/layout/layout-renderer";
import type {
  LayoutEditingContextValue,
  WidgetGroup,
  WidgetPickerState,
} from "@hydris/ui/layout/types";
import { PanelProvider } from "@hydris/ui/panels";
import type { Entity } from "@projectqai/proto/world";
import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, { runOnJS, useSharedValue, withTiming } from "react-native-reanimated";

import { useEntityMutation } from "../../lib/api/use-entity-mutation";
import { getEntityName } from "../../lib/api/use-track-utils";
import { toast } from "../../lib/sonner";
import { buildShareViewUrl, copyShareableLink } from "../../lib/use-url-params";
import { CameraPaneProvider } from "./camera-pane-context";
import { CommandPalette } from "./components/command-palette/command-palette";
import { PaneShell } from "./components/layout/pane-shell";
import { WidgetPickerModal } from "./components/layout/widget-picker-modal";
import { FloatingChatInput } from "./components/panes/floating-chat-input";
import { TopBar } from "./components/top-bar/top-bar";
import { useUpdateBanner } from "./components/update-banner";
import { COMPONENT_LABELS, COMPONENT_REGISTRY, PRESETS, Z } from "./constants";
import { layoutSnapshotRef } from "./hooks/layout-snapshot";
import { useDeepLink } from "./hooks/use-deep-link";
import { useEscapeHandler } from "./hooks/use-escape-handler";
import { useLayoutManager } from "./hooks/use-layout-manager";
import { PaletteContext, type PaletteContextValue } from "./palette-context";
import { PIPProvider } from "./pip-context";
import { PIPPlayer } from "./pip-player";
import { PlacementContext, type PlacementContextValue } from "./placement-context";
import { useChatStore } from "./store/chat-store";
import { useEntityStore } from "./store/entity-store";
import { useLeftPanelStore } from "./store/left-panel-store";
import { mapEngineActions } from "./store/map-engine-store";
import { useMapStore } from "./store/map-store";
import { useMissionKitStore } from "./store/mission-kit-store";
import { DEFAULT_OVERLAYS, useOverlayStore } from "./store/overlay-store";
import { useSelectionStore } from "./store/selection-store";
import { useTabStore } from "./store/tab-store";

type AwareContentProps = {
  additionalWidgets?: WidgetGroup[];
  commandButtonRight?: boolean;
};

function AwareContent({ additionalWidgets, commandButtonRight }: AwareContentProps) {
  const additionalComponentIds = useMemo(
    () => additionalWidgets?.flatMap((g) => g.widgets.map((w) => w.id)),
    [additionalWidgets],
  );

  const {
    activePresetId,
    layoutTree,
    swapSourceId,
    totalPanes,
    mapVisible,
    isLayoutModified,
    layoutOpacity,
    handlePresetSelect,
    handleSplit,
    handleRemove,
    handleSwapStart,
    handleSwapTarget,
    handleResetToPreset,
    handleChangeContent,
    handleRatioChange,
    clearSwapSource,
    applyExternalLayout,
    saveCustomTree,
    clearCustomTree,
  } = useLayoutManager(additionalComponentIds);

  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isScreenLocked, setIsScreenLocked] = useState(false);
  const customizeProgress = useSharedValue(0);

  const [placementEntity, setPlacementEntity] = useState<Entity | null>(null);
  const placementProgress = useSharedValue(0);
  const isPlacing = placementEntity !== null;
  const { updateEntityLocation } = useEntityMutation();

  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null);
  const openPalette = useCallback(
    (mode: PaletteMode = { kind: "root" }) => setPaletteMode(mode),
    [],
  );
  const closePalette = useCallback(() => setPaletteMode(null), []);
  const paletteCtx = useMemo<PaletteContextValue>(() => ({ open: openPalette }), [openPalette]);

  const [pickerState, setPickerState] = useState<WidgetPickerState>(null);
  const openPicker: LayoutEditingContextValue["openPicker"] = useCallback(
    (path, currentContent) => setPickerState({ path, currentContent }),
    [],
  );
  const closePicker = useCallback(() => setPickerState(null), []);

  useDeepLink(mapVisible, { applyExternalLayout, openPalette });

  const finishExitCustomize = useCallback(() => {
    setIsCustomizing(false);
    clearSwapSource();
  }, [clearSwapSource]);

  const exitCustomize = useCallback(() => {
    customizeProgress.value = withTiming(0, { duration: 220 }, (finished) => {
      if (finished) runOnJS(finishExitCustomize)();
    });
  }, [customizeProgress, finishExitCustomize]);

  const finishExitPlacement = useCallback(() => {
    setPlacementEntity(null);
  }, []);

  const exitPlacement = useCallback(() => {
    // eslint-disable-next-line react-compiler/react-compiler
    placementProgress.value = withTiming(0, { duration: 220 }, (finished) => {
      if (finished) runOnJS(finishExitPlacement)();
    });
  }, [placementProgress, finishExitPlacement]);

  const enterCustomize = useCallback(() => {
    if (isPlacing) exitPlacement();
    setIsCustomizing(true);

    customizeProgress.value = withTiming(1, { duration: 280 });
  }, [customizeProgress, isPlacing, exitPlacement]);

  const enterPlacement = useCallback(
    (entity: Entity) => {
      if (!mapVisible) {
        toast.error("Add a map to a pane first to position entities");
        return;
      }
      if (isCustomizing) exitCustomize();
      setPlacementEntity(entity);
      setPaletteMode(null);
      placementProgress.value = withTiming(1, { duration: 280 });
      toast.info(`Pan the map to position ${getEntityName(entity)}`);
    },
    [placementProgress, isCustomizing, exitCustomize, mapVisible],
  );

  const confirmPlacement = useCallback(async () => {
    if (!placementEntity) return;
    const view = mapEngineActions.getView();
    if (!view) return;
    try {
      await updateEntityLocation(placementEntity, {
        latitude: view.lat,
        longitude: view.lng,
      });
      toast.success(`Position set for ${getEntityName(placementEntity)}`);
    } catch {
      toast.error("Failed to set position");
    }
    exitPlacement();
  }, [placementEntity, updateEntityLocation, exitPlacement]);

  const placementCtx = useMemo<PlacementContextValue>(
    () => ({ enterPlacement, isPlacing, canPlace: mapVisible }),
    [enterPlacement, isPlacing, mapVisible],
  );

  useEffect(() => {
    if (isPlacing && !mapVisible) exitPlacement();
  }, [isPlacing, mapVisible, exitPlacement]);

  const handleShareView = useCallback(() => {
    const fullUrl = buildShareViewUrl({
      getSelectedEntityId: () => useSelectionStore.getState().selectedEntityId,
      getMapView: () => mapEngineActions.getView(),
      getTab: () => useTabStore.getState().activeDetailTab,
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
  }, []);

  useEscapeHandler({
    swapSourceId,
    clearSwapSource,
    isCustomizing,
    exitCustomize,
    isPlacing,
    exitPlacement,
    pickerOpen: pickerState !== null,
    closePicker,
  });

  const extendedRegistry = useMemo(() => {
    if (!additionalWidgets?.length) return null;
    const components: Record<string, ComponentType> = { ...COMPONENT_REGISTRY };
    const labels: Record<string, string> = { ...COMPONENT_LABELS };
    for (const group of additionalWidgets) {
      for (const w of group.widgets) {
        if (w.component) components[w.id] = w.component;
        labels[w.id] = w.label;
      }
    }
    return { components, labels };
  }, [additionalWidgets]);

  useEffect(() => {
    if (process.env.EXPO_OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteMode((v) => (v ? null : { kind: "root" }));
        return;
      }
      if (e.key.startsWith("F") && !e.altKey && !e.metaKey && !e.ctrlKey) {
        const idx = parseInt(e.key.slice(1), 10) - 1;
        if (idx >= 0 && idx < PRESETS.length) {
          e.preventDefault();
          handlePresetSelect(PRESETS[idx]!.id);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlePresetSelect]);

  const editingCtx = useMemo<LayoutEditingContextValue>(
    () => ({
      customizeProgress,
      isCustomizing,
      onSplit: handleSplit,
      onRemove: handleRemove,
      onChangeContent: handleChangeContent,
      onRatioChange: handleRatioChange,
      totalPanes,
      swapSourceId,
      onSwapStart: handleSwapStart,
      onSwapTarget: handleSwapTarget,
      pickerState,
      openPicker,
      closePicker,
    }),
    [
      isCustomizing,
      totalPanes,
      swapSourceId,
      pickerState,
      handleSplit,
      handleRemove,
      handleChangeContent,
      handleRatioChange,
      handleSwapStart,
      handleSwapTarget,
      openPicker,
      closePicker,
    ],
  );

  return (
    <PlacementContext.Provider value={placementCtx}>
      <PaletteContext.Provider value={paletteCtx}>
        <View className="bg-background flex-1">
          <TopBar
            activePresetId={activePresetId}
            onPresetSelect={handlePresetSelect}
            customizeProgress={customizeProgress}
            isCustomizing={isCustomizing}
            onCustomize={enterCustomize}
            onDone={exitCustomize}
            isLayoutModified={!!isLayoutModified}
            onResetToPreset={handleResetToPreset}
            onOpenPalette={() => openPalette()}
            commandButtonRight={commandButtonRight}
            isScreenLocked={isScreenLocked}
            placement={{
              progress: placementProgress,
              isActive: isPlacing,
              onConfirm: confirmPlacement,
              onAbort: exitPlacement,
            }}
          />

          <View style={{ flex: 1 }}>
            <View className="flex flex-1">
              <ComponentRegistryContext.Provider value={extendedRegistry}>
                <LayoutEditingContext.Provider value={editingCtx}>
                  <LeafRendererContext.Provider value={PaneShell}>
                    <Animated.View style={[{ flex: 1 }, layoutOpacity]}>
                      <LayoutRenderer node={layoutTree} />
                    </Animated.View>
                  </LeafRendererContext.Provider>
                </LayoutEditingContext.Provider>
              </ComponentRegistryContext.Provider>
            </View>
            {isScreenLocked && (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: Z.SCREEN_LOCK,
                }}
                pointerEvents="auto"
                onStartShouldSetResponder={() => true}
              />
            )}
          </View>
          {pickerState && (
            <WidgetPickerModal
              visible
              onClose={closePicker}
              onSelect={(content) => {
                handleChangeContent(pickerState.path, content);
                closePicker();
              }}
              currentContent={pickerState.currentContent}
              additionalWidgets={additionalWidgets}
            />
          )}
          {paletteMode && (
            <CommandPalette
              onClose={closePalette}
              initialMode={paletteMode}
              layoutActions={{
                presetSelect: handlePresetSelect,
                customize: enterCustomize,
                resetLayout: handleResetToPreset,
                shareView: handleShareView,
                saveCustomTree,
                clearCustomTree,
                toggleScreenLock: () => {
                  let nowLocked = false;
                  setIsScreenLocked((v) => {
                    nowLocked = !v;
                    return nowLocked;
                  });
                  return nowLocked;
                },
              }}
            />
          )}
          <FloatingChatInput />
          <PIPPlayer minTop={70} />
        </View>
      </PaletteContext.Provider>
    </PlacementContext.Provider>
  );
}

type AwareScreenProps = {
  additionalWidgets?: WidgetGroup[];
  commandButtonRight?: boolean;
};

export default function AwareScreen({
  additionalWidgets,
  commandButtonRight,
}: AwareScreenProps = {}) {
  const startStream = useEntityStore((s) => s.startStream);
  const stopStream = useEntityStore((s) => s.stopStream);
  const startChatStream = useChatStore((s) => s.startStream);
  const stopChatStream = useChatStore((s) => s.stopStream);

  useEffect(() => {
    startStream();
    startChatStream();
    useMissionKitStore.getState().fetch();
    return () => {
      stopStream();
      stopChatStream();
    };
  }, [startStream, stopStream, startChatStream, stopChatStream]);

  useUpdateBanner();

  return (
    <KeyboardProvider>
      <PanelProvider>
        <PIPProvider>
          <CameraPaneProvider isInPane={() => false}>
            <AwareContent
              additionalWidgets={additionalWidgets}
              commandButtonRight={commandButtonRight}
            />
          </CameraPaneProvider>
        </PIPProvider>
      </PanelProvider>
    </KeyboardProvider>
  );
}
