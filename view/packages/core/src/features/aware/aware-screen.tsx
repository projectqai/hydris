"use no memo";

import {
  initialPaletteState,
  type PaletteMode,
  type PaletteState,
  paletteStateAt,
} from "@hydris/ui/command-palette/palette-reducer";
import { KeyboardProvider } from "@hydris/ui/keyboard";
import {
  ComponentRegistryContext,
  LayoutEditingContext,
  LeafRendererContext,
} from "@hydris/ui/layout/contexts";
import { LayoutRenderer } from "@hydris/ui/layout/layout-renderer";
import { setPaneEntityId } from "@hydris/ui/layout/tree-utils";
import type {
  LayoutEditingContextValue,
  NodePath,
  PaneContent,
  WidgetGroup,
  WidgetPickerState,
} from "@hydris/ui/layout/types";
import { PanelProvider } from "@hydris/ui/panels";
import { ScreenLockContext } from "@hydris/ui/screen-lock";
import type { Entity } from "@projectqai/proto/world";
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Animated, { ReduceMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useEntityMutation } from "../../lib/api/use-entity-mutation";
import { getEntityName } from "../../lib/api/use-track-utils";
import { toast } from "../../lib/sonner";
import { buildShareViewUrl, copyShareableLink } from "../../lib/use-url-params";
import { DropZone } from "../mission-pack/drop-zone";
import { CameraPaneProvider } from "./camera-pane-context";
import { CommandPalette } from "./components/command-palette/command-palette";
import { CoordinateEntryModal } from "./components/coordinate-entry-modal";
import { PaneEntityPickerModal } from "./components/layout/pane-entity-picker-modal";
import { PaneShell } from "./components/layout/pane-shell";
import { WidgetPickerModal } from "./components/layout/widget-picker-modal";
import { FloatingChatInput } from "./components/panes/floating-chat-input";
import { BullseyeBarContent } from "./components/top-bar/bullseye-bar-content";
import { DrawingBarContent } from "./components/top-bar/drawing-bar-content";
import { EditBarContent } from "./components/top-bar/edit-bar-content";
import { PlacementBarContent } from "./components/top-bar/placement-bar-content";
import { RangeBarContent } from "./components/top-bar/range-bar-content";
import { TopBar } from "./components/top-bar/top-bar";
import { useUpdateBanner } from "./components/update-banner";
import { Z } from "./constants";
import { useDeepLink } from "./hooks/use-deep-link";
import { useEscapeHandler } from "./hooks/use-escape-handler";
import { useLayoutManager } from "./hooks/use-layout-manager";
import { COMPONENT_LABELS, COMPONENT_REGISTRY } from "./layouts";
import { PaletteContext, type PaletteContextValue } from "./palette-context";
import { PIPProvider } from "./pip-context";
import { PIPPlayer } from "./pip-player";
import {
  PlacementContext,
  type PlacementContextValue,
  type PlacementOptions,
  placementResetRef,
} from "./placement-context";
import { PRESETS } from "./presets";
import { useBullseyeStore } from "./store/bullseye-store";
import { useChatStore } from "./store/chat-store";
import { selectEditPending, useEditStore } from "./store/edit-store";
import { useEntityStore } from "./store/entity-store";
import { mapEngineActions, useMapEngineStore } from "./store/map-engine-store";
import { useMissionKitStore } from "./store/mission-kit-store";
import {
  selectCanFinishPath,
  selectPathKind,
  selectPathPointCount,
  selectPathPointsRemaining,
  selectPathRings,
  usePathStore,
} from "./store/path-store";
import { useRadialMenuStore } from "./store/radial-menu-store";
import { saveEdit } from "./store/save-edit";
import { savePath } from "./store/save-path";
import { standDownModes } from "./store/stand-down";
import { useTabStore } from "./store/tab-store";
import { TOOL } from "./utils/map-paths";
import { shareViewUrlDeps } from "./utils/share-view-url-deps";

type AwareContentProps = {
  additionalWidgets?: WidgetGroup[];
  commandButtonRight?: boolean;
};

function useModeBarTransition(active: boolean) {
  const progress = useSharedValue(active ? 1 : 0);
  const [mounted, setMounted] = useState(active);

  useEffect(() => {
    if (active) {
      setMounted(true);
      progress.value = withTiming(1, { duration: 280, reduceMotion: ReduceMotion.System });
      return;
    }
    progress.value = withTiming(
      0,
      { duration: 220, reduceMotion: ReduceMotion.System },
      (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      },
    );
  }, [active, progress]);

  return { mounted, progress };
}

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
  const isTouchInput = useMapEngineStore((s) => s.pointerType === "touch");
  const pathKind = usePathStore(selectPathKind);
  const rangeActive = pathKind === "range";
  const drawingKind = pathKind === "range" ? null : pathKind;
  const bullseyePlacing = useBullseyeStore((s) => s.isPlacing);
  const pathPointsLeft = usePathStore(selectPathPointsRemaining);
  const pathCanUndo = usePathStore(selectPathPointCount) > 0;
  const pathRings = usePathStore(selectPathRings);
  const pathCanFinish = usePathStore(selectCanFinishPath);
  const editingEntityId = useEditStore((s) => s.entityId);
  const editingKind = useEditStore((s) => s.kind);
  const editingRings = useEditStore((s) => s.rings);
  const editCanUndo = useEditStore(selectEditPending);

  const [placementEntity, setPlacementEntity] = useState<Entity | null>(null);
  const placementProgress = useSharedValue(0);
  const isPlacing = placementEntity !== null;
  const { mounted: bullseyeBarMounted, progress: bullseyeProgress } = useModeBarTransition(
    bullseyePlacing && !isPlacing && !isCustomizing,
  );
  const { mounted: rangeBarMounted, progress: rangeProgress } = useModeBarTransition(
    rangeActive && !isPlacing && !isCustomizing,
  );
  const { mounted: drawBarMounted, progress: drawProgress } = useModeBarTransition(
    drawingKind !== null && !isPlacing && !isCustomizing,
  );
  const { mounted: editBarMounted, progress: editProgress } = useModeBarTransition(
    editingEntityId !== null && !isPlacing && !isCustomizing,
  );
  const placementEntityExists = useEntityStore(
    (state) => placementEntity === null || state.entities.has(placementEntity.id),
  );
  const cameraBeforePlacementRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const placementConfirmRef = useRef<PlacementOptions["onConfirm"]>(undefined);
  const [coordEntry, setCoordEntry] = useState<{
    latitude: number;
    longitude: number;
    altitude?: number;
  } | null>(null);
  const [pendingAltitude, setPendingAltitude] = useState<number | null>(null);
  const { updateEntityLocation } = useEntityMutation();

  const [paletteState, setPaletteState] = useState<PaletteState | null>(null);
  const openPalette = useCallback((mode: PaletteMode = { kind: "root" }) => {
    useRadialMenuStore.getState().close();
    setPaletteState(paletteStateAt(mode));
  }, []);

  const closePalette = useCallback(() => setPaletteState(null), []);
  const paletteCtx = useMemo<PaletteContextValue>(() => ({ open: openPalette }), [openPalette]);

  const [pickerState, setPickerState] = useState<WidgetPickerState>(null);
  const openPicker: LayoutEditingContextValue["openPicker"] = useCallback(
    (path, currentContent) => setPickerState({ path, currentContent }),
    [],
  );
  const closePicker = useCallback(() => setPickerState(null), []);

  const [entityPickerState, setEntityPickerState] = useState<{
    path: NodePath;
    content: PaneContent;
  } | null>(null);
  const openEntityPicker: LayoutEditingContextValue["openEntityPicker"] = useCallback(
    (path, content) => setEntityPickerState({ path, content }),
    [],
  );
  const closeEntityPicker = useCallback(() => setEntityPickerState(null), []);

  useDeepLink(mapVisible, { applyExternalLayout, openPalette });

  const openMissionHealth = useCallback(
    () => openPalette({ kind: "mission-health" }),
    [openPalette],
  );

  const finishExitCustomize = useCallback(() => {
    setIsCustomizing(false);
    clearSwapSource();
  }, [clearSwapSource]);

  const exitCustomize = useCallback(() => {
    customizeProgress.value = withTiming(0, { duration: 220 }, (finished) => {
      if (finished) scheduleOnRN(finishExitCustomize);
    });
  }, [customizeProgress, finishExitCustomize]);

  const finishExitPlacement = useCallback(() => {
    placementConfirmRef.current = undefined;
    setPlacementEntity(null);
    setCoordEntry(null);
    setPendingAltitude(null);
  }, []);

  const exitPlacement = useCallback(() => {
    // eslint-disable-next-line react-compiler/react-compiler
    placementProgress.value = withTiming(0, { duration: 220 }, (finished) => {
      if (finished) scheduleOnRN(finishExitPlacement);
    });
  }, [placementProgress, finishExitPlacement]);

  useEffect(() => {
    placementResetRef.current = exitPlacement;
    return () => {
      placementResetRef.current = null;
    };
  }, [exitPlacement]);

  useEffect(() => {
    if (!placementEntityExists) exitPlacement();
  }, [placementEntityExists, exitPlacement]);

  const enterCustomize = useCallback(() => {
    if (isPlacing) exitPlacement();
    setIsCustomizing(true);

    customizeProgress.value = withTiming(1, { duration: 280 });
  }, [customizeProgress, isPlacing, exitPlacement]);

  const enterPlacement = useCallback(
    (entity: Entity, options?: PlacementOptions) => {
      if (!mapVisible) {
        toast.error("Add a map to a pane first to position entities");
        return;
      }
      if (isCustomizing) exitCustomize();
      standDownModes();
      cameraBeforePlacementRef.current = mapEngineActions.getView();
      const recenterAt =
        options?.recenterAt ??
        (options?.recenter && entity.geo
          ? { lat: entity.geo.latitude, lng: entity.geo.longitude }
          : undefined);
      if (recenterAt) mapEngineActions.flyTo(recenterAt.lat, recenterAt.lng);
      placementConfirmRef.current = options?.onConfirm;
      setPlacementEntity(entity);
      setPaletteState(null);
      placementProgress.value = withTiming(1, { duration: 280 });
    },
    [placementProgress, isCustomizing, exitCustomize, mapVisible],
  );

  const confirmPlacement = useCallback(async () => {
    if (!placementEntity) return;
    if (!useEntityStore.getState().entities.has(placementEntity.id)) {
      toast.error("Entity no longer available");
      exitPlacement();
      return;
    }
    const view = mapEngineActions.getView();
    if (!view) return;
    try {
      const confirm = placementConfirmRef.current;
      if (confirm) {
        await confirm({ lat: view.lat, lng: view.lng, alt: pendingAltitude ?? undefined });
      } else {
        await updateEntityLocation(placementEntity, {
          latitude: view.lat,
          longitude: view.lng,
          altitude: pendingAltitude ?? undefined,
        });
      }
      toast.success(`Position set for ${getEntityName(placementEntity)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set position");
    }
    exitPlacement();
  }, [placementEntity, updateEntityLocation, exitPlacement, pendingAltitude]);

  const applyTypedCoords = useCallback(
    (coords: { latitude: number; longitude: number; altitude?: number }) => {
      mapEngineActions.flyTo(coords.latitude, coords.longitude, undefined, 0);
      setPendingAltitude(coords.altitude ?? null);
      setCoordEntry(null);
    },
    [],
  );

  const openCoordEntry = useCallback(() => {
    const view = mapEngineActions.getView();
    setCoordEntry({
      latitude: view.lat,
      longitude: view.lng,
      altitude: pendingAltitude ?? placementEntity?.geo?.altitude,
    });
  }, [placementEntity, pendingAltitude]);

  const cancelPlacement = useCallback(() => {
    const cam = cameraBeforePlacementRef.current;
    if (cam) mapEngineActions.flyTo(cam.lat, cam.lng, undefined, undefined, cam.zoom);
    exitPlacement();
  }, [exitPlacement]);

  const placementCtx = useMemo<PlacementContextValue>(
    () => ({ enterPlacement, exitPlacement, isPlacing, canPlace: mapVisible }),
    [enterPlacement, exitPlacement, isPlacing, mapVisible],
  );

  useEffect(() => {
    if (isPlacing && !mapVisible) exitPlacement();
  }, [isPlacing, mapVisible, exitPlacement]);

  const handleShareView = useCallback(() => {
    const fullUrl = buildShareViewUrl(
      shareViewUrlDeps({
        getMapView: () => mapEngineActions.getView(),
        getTab: () => useTabStore.getState().activeDetailTab,
      }),
    );
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
    entityPickerOpen: entityPickerState !== null,
    closeEntityPicker,
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
        setPaletteState((v) => {
          if (v) return null;
          useRadialMenuStore.getState().close();

          return initialPaletteState;
        });
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
      openEntityPicker,
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
      openEntityPicker,
    ],
  );

  const modeBar = isPlacing
    ? {
        progress: placementProgress,
        isActive: isPlacing,
        content: (
          <PlacementBarContent
            onConfirm={confirmPlacement}
            onAbort={cancelPlacement}
            onTypeCoordinates={openCoordEntry}
          />
        ),
      }
    : bullseyeBarMounted
      ? {
          progress: bullseyeProgress,
          isActive: bullseyePlacing && !isCustomizing,
          content: <BullseyeBarContent onCancel={standDownModes} />,
        }
      : drawBarMounted
        ? {
            progress: drawProgress,
            isActive: drawingKind !== null && !isCustomizing,
            content: (
              <DrawingBarContent
                isTouchInput={isTouchInput}
                kind={drawingKind}
                label={drawingKind ? TOOL[drawingKind].label : ""}
                canUndo={pathCanUndo}
                rings={pathRings}
                onRingsChange={(rings) => usePathStore.getState().setRings(rings)}
                onFinish={
                  pathPointsLeft === null && pathCanFinish
                    ? () => void savePath(usePathStore.getState().finish())
                    : undefined
                }
                onUndo={() => usePathStore.getState().undo()}
                onCancel={() => usePathStore.getState().cancel()}
              />
            ),
          }
        : editBarMounted
          ? {
              progress: editProgress,
              isActive: editingEntityId !== null && !isCustomizing,
              content: (
                <EditBarContent
                  isTouchInput={isTouchInput}
                  kind={editingKind}
                  canUndo={editCanUndo}
                  rings={TOOL[editingKind].rings ? editingRings : undefined}
                  onRingsChange={(rings) => useEditStore.getState().setRings(rings)}
                  onUndo={() => useEditStore.getState().undo()}
                  onEnd={() => void saveEdit(useEditStore.getState().end())}
                />
              ),
            }
          : rangeBarMounted
            ? {
                progress: rangeProgress,
                isActive: rangeActive && !isCustomizing,
                content: (
                  <RangeBarContent
                    isTouchInput={isTouchInput}
                    label={TOOL.range.label}
                    canUndo={pathCanUndo}
                    onFinish={() => {
                      void savePath(usePathStore.getState().finish());
                    }}
                    onUndo={() => usePathStore.getState().undo()}
                  />
                ),
              }
            : null;

  return (
    <ScreenLockContext.Provider value={isScreenLocked}>
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
              commandButtonRight={commandButtonRight}
              isScreenLocked={isScreenLocked}
              mode={modeBar}
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
            {entityPickerState && (
              <PaneEntityPickerModal
                content={entityPickerState.content}
                onSelect={(entityId) => {
                  handleChangeContent(
                    entityPickerState.path,
                    setPaneEntityId(entityPickerState.content, entityId),
                  );
                  closeEntityPicker();
                }}
                onClear={() => {
                  handleChangeContent(
                    entityPickerState.path,
                    setPaneEntityId(entityPickerState.content, undefined),
                  );
                  closeEntityPicker();
                }}
                onClose={closeEntityPicker}
              />
            )}
            {paletteState && (
              <CommandPalette
                onClose={closePalette}
                onReopen={setPaletteState}
                initialState={paletteState}
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
            {isPlacing && coordEntry && (
              <CoordinateEntryModal
                initial={coordEntry}
                onApply={applyTypedCoords}
                onClose={() => setCoordEntry(null)}
              />
            )}
            <FloatingChatInput />
            <PIPPlayer minTop={70} />
            <DropZone onImported={openMissionHealth} />
          </View>
        </PaletteContext.Provider>
      </PlacementContext.Provider>
    </ScreenLockContext.Provider>
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
