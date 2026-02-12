import { KeyboardProvider } from "@hydris/ui/keyboard";
import { PanelProvider, ResizablePanel, usePanelContext } from "@hydris/ui/panels";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { View } from "react-native";

import { useDeepLink } from "./hooks/use-deep-link";
import { useEscapeHandler } from "./hooks/use-escape-handler";
import { CollapsedStats, LeftPanelContent } from "./left-panel-content";
import { MapControls } from "./map-controls";
import { MapSearch } from "./map-search";
import MapView from "./map-view";
import { PIPProvider } from "./pip-context";
import { PIPPlayer } from "./pip-player";
import { CollapsedInfo, RightPanelContent } from "./right-panel-content";
import { selectDetectionEntityIds, selectLastChange, useEntityStore } from "./store/entity-store";
import {
  setCurrentView,
  useFlyToTarget,
  useMapRef,
  useZoomCommand,
} from "./store/map-engine-store";
import { useMapStore } from "./store/map-store";
import { useOverlayStore } from "./store/overlay-store";
import { useSelectionStore } from "./store/selection-store";
import { buildDelta, buildDeltaChunked } from "./utils/transform-entities";

type AwareScreenProps = {
  headerActions?: ReactNode;
};

const BRIDGE_CHUNK_SIZE = 5000;
const THROTTLE_MS = 500;

function EntityBridge() {
  const entities = useEntityStore((s) => s.entities);
  const lastChange = useEntityStore(selectLastChange);
  const detectionEntityIds = useEntityStore(selectDetectionEntityIds);
  const mapRef = useMapRef();

  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushTimeRef = useRef(0);
  const chunkingRef = useRef(false);
  const pendingVersionRef = useRef(false);

  useEffect(() => {
    if (chunkingRef.current) {
      pendingVersionRef.current = true;
      return;
    }

    if (pushTimerRef.current) {
      clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }

    const doPush = () => {
      pushTimerRef.current = null;
      const ref = mapRef.current;
      if (!ref || typeof ref.pushDelta !== "function") {
        pushTimerRef.current = setTimeout(doPush, 100);
        return;
      }
      lastPushTimeRef.current = Date.now();

      if (entities.size <= BRIDGE_CHUNK_SIZE) {
        const delta = buildDelta(entities, detectionEntityIds);
        ref.pushDelta(JSON.stringify(delta));
        return;
      }

      const iter = buildDeltaChunked(entities, detectionEntityIds, BRIDGE_CHUNK_SIZE);
      const first = iter.next();

      if (first.done) return;
      ref.pushDelta(JSON.stringify(first.value));

      chunkingRef.current = true;
      pendingVersionRef.current = false;

      const pushNext = () => {
        const next = iter.next();
        if (!next.done) {
          ref.pushDelta(JSON.stringify(next.value));
          setTimeout(pushNext, 0);
        } else {
          chunkingRef.current = false;
          if (pendingVersionRef.current) {
            pendingVersionRef.current = false;
            lastPushTimeRef.current = Date.now();
            const catchup = buildDelta(
              useEntityStore.getState().entities,
              useEntityStore.getState().detectionEntityIds,
            );
            if (catchup.entities.length > 0 || catchup.removed.length > 0) {
              ref.pushDelta(JSON.stringify(catchup));
            }
          }
        }
      };
      pushNext();
    };

    const elapsed = Date.now() - lastPushTimeRef.current;
    if (elapsed >= THROTTLE_MS) {
      doPush();
    } else {
      pushTimerRef.current = setTimeout(doPush, THROTTLE_MS - elapsed);
    }

    return () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
    };
  }, [lastChange.version, mapRef]);

  useEffect(() => {
    const selectedEntityId = useSelectionStore.getState().selectedEntityId;
    if (!selectedEntityId) return;
    const gone = lastChange.fullClear
      ? !entities.has(selectedEntityId)
      : lastChange.deletedIds.has(selectedEntityId);
    if (gone) useSelectionStore.getState().clearSelection();
  }, [lastChange]);

  return null;
}

function AwareScreenContent({ headerActions }: AwareScreenProps) {
  const viewedEntityId = useSelectionStore((s) => s.viewedEntityId);
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const isFollowing = useSelectionStore((s) => s.isFollowing);
  const baseLayer = useMapStore((s) => s.layer);
  const tracks = useOverlayStore((s) => s.tracks);
  const sensors = useOverlayStore((s) => s.sensors);
  const visualization = useOverlayStore((s) => s.visualization);
  const mapRef = useMapRef();
  const flyToTarget = useFlyToTarget();
  const zoomCommand = useZoomCommand();
  const { collapseAll } = usePanelContext();

  const trackedId = isFollowing && selectedEntityId ? selectedEntityId : null;
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (selectionTimerRef.current) {
      clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = null;
    }
    const push = () => {
      selectionTimerRef.current = null;
      const ref = mapRef.current;
      if (!ref || typeof ref.pushSelection !== "function") {
        selectionTimerRef.current = setTimeout(push, 100);
        return;
      }
      ref.pushSelection(selectedEntityId, trackedId);
    };
    push();
    return () => {
      if (selectionTimerRef.current) {
        clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = null;
      }
    };
  }, [selectedEntityId, trackedId, mapRef]);

  const filterJson = JSON.stringify({ tracks, sensors });
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (settingsTimerRef.current) {
      clearTimeout(settingsTimerRef.current);
      settingsTimerRef.current = null;
    }
    const push = () => {
      settingsTimerRef.current = null;
      const ref = mapRef.current;
      if (!ref || typeof ref.pushSettings !== "function") {
        settingsTimerRef.current = setTimeout(push, 100);
        return;
      }
      ref.pushSettings(baseLayer, filterJson, visualization.coverage, visualization.shapes);
    };
    push();
    return () => {
      if (settingsTimerRef.current) {
        clearTimeout(settingsTimerRef.current);
        settingsTimerRef.current = null;
      }
    };
  }, [baseLayer, filterJson, visualization.coverage, visualization.shapes, mapRef]);

  useEscapeHandler();
  useDeepLink(true);

  const handleEntityClick = async (id: string | null) => {
    const { selectedEntityId, viewedEntityId, select, clearSelection } =
      useSelectionStore.getState();

    if (id) {
      if (selectedEntityId === id) {
        select(null);
      } else {
        select(id);
      }
      return;
    }

    if (selectedEntityId) {
      select(null);
    } else if (viewedEntityId) {
      clearSelection();
      collapseAll();
    } else {
      collapseAll();
    }
  };

  return (
    <>
      <EntityBridge />
      <MapView
        ref={mapRef}
        flyToTarget={flyToTarget}
        zoomCommand={zoomCommand}
        baseLayer={baseLayer}
        coverageVisible={visualization.coverage}
        shapesVisible={visualization.shapes}
        onEntityClick={handleEntityClick}
        onTrackingLost={async () => useSelectionStore.setState({ isFollowing: false })}
        onViewChange={async (lat, lng, zoom) => setCurrentView(lat, lng, zoom)}
      />

      <ResizablePanel side="left" minWidth={200} maxWidth={600} collapsedHeight={60}>
        <ResizablePanel.Collapsed>
          <CollapsedStats />
        </ResizablePanel.Collapsed>
        <ResizablePanel.Content>
          <LeftPanelContent />
        </ResizablePanel.Content>
      </ResizablePanel>

      <ResizablePanel
        side="right"
        minWidth={200}
        maxWidth={600}
        collapsedHeight={60}
        collapsed={!viewedEntityId}
      >
        <ResizablePanel.Collapsed>
          <CollapsedInfo />
        </ResizablePanel.Collapsed>
        <ResizablePanel.Content>
          <RightPanelContent headerActions={headerActions} />
        </ResizablePanel.Content>
      </ResizablePanel>

      <MapControls />
      <MapSearch />
      <PIPPlayer />
    </>
  );
}

export default function AwareScreen({ headerActions }: AwareScreenProps) {
  const startStream = useEntityStore((s) => s.startStream);
  const stopStream = useEntityStore((s) => s.stopStream);

  useEffect(() => {
    startStream();
    return () => stopStream();
  }, [startStream, stopStream]);

  return (
    <View className="flex-1">
      <KeyboardProvider>
        <PanelProvider>
          <PIPProvider>
            <AwareScreenContent headerActions={headerActions} />
          </PIPProvider>
        </PanelProvider>
      </KeyboardProvider>
    </View>
  );
}
