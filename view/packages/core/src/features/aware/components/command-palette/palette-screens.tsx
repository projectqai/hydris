import type {
  Category,
  PaletteAction,
  PaletteMode,
  PaletteState,
} from "@hydris/ui/command-palette/palette-reducer";
import type { Entity } from "@projectqai/proto/world";
import type { ReactNode } from "react";

import { getDeviceName, getEntityName } from "../../../../lib/api/use-track-utils";
import { getSourceTexts, OTHER_SERVICES } from "../../../mission/source-texts";
import { getServiceLabel } from "../../../mission/sources";
import { selectDeviceGroups } from "../../../mission/use-sources";
import type { Command } from "./command-registry";
import { CATEGORIES } from "./palette-helpers";
import { AddSourceServiceView } from "./views/add-source-service-view";
import { AssetReadinessView } from "./views/asset-readiness-view";
import { AssetView } from "./views/asset-view";
import { CameraView } from "./views/camera-view";
import { CommandGroupView } from "./views/command-group-view";
import { ConfigView } from "./views/config-view";
import { DeviceView } from "./views/device-view";
import { DevicesWithoutServiceView } from "./views/devices-without-service-view";
import { DiagnosticExportView } from "./views/diagnostic-export-view";
import { DimensionView } from "./views/dimension-view";
import { LocationSearchView } from "./views/location-search-view";
import { MissionExportView } from "./views/mission-export-view";
import { MissionHealthView } from "./views/mission-health-view";
import { OtherServicesView } from "./views/other-services-view";
import { RootView } from "./views/root-view";
import { SettingsView } from "./views/settings-view";
import { SetupView } from "./views/setup-view";
import { SourceServiceView } from "./views/source-service-view";
import { SourceServicesView } from "./views/source-services-view";
import { SourcesView } from "./views/sources-view";
import { TracksView } from "./views/tracks-view";

type Kind = PaletteMode["kind"];

type ModeOf = { [M in PaletteMode as M["kind"]]: M };

export type TrailSegment = {
  label: string;
  index: number;
  liveLabel?: (state: { entities: Map<string, Entity> }) => string | undefined;
};

type TrailLabel = Omit<TrailSegment, "index">;

// names the page with the function its header uses, read live, so the two cannot disagree
function entityTrail(entityId: string, name: (entity: Entity) => string): TrailLabel {
  return {
    label: entityId,
    liveLabel: (s) => {
      const entity = s.entities.get(entityId);

      return entity && name(entity);
    },
  };
}

export type ScreenProps = {
  state: PaletteState;
  dispatch: React.Dispatch<PaletteAction>;
  commands: Command[];
  onClose: () => void;
  isWide: boolean;
  treeOpen: boolean;
  onTreeOpenChange: (open: boolean) => void;
};

type Screen<M extends PaletteMode> = {
  trail: ((mode: M) => TrailLabel) | null;
  search?: (mode: M) => string;
  layout?: "list-detail" | "wizard";
  keys?: "grid" | "none";
  enter?: "select" | "go to" | "toggle";
  render: (mode: M, props: ScreenProps) => ReactNode;
};

const SCREENS: { [K in Kind]: Screen<ModeOf[K]> } = {
  root: {
    trail: () => ({ label: "Root" }),
    search: () => "Search entities, commands...",
    enter: "select",
    render: (_, { state, commands, dispatch, onClose }) => (
      <RootView
        query={state.query}
        activeCategory={state.activeCategory}
        commands={commands}
        dispatch={dispatch}
        onClose={onClose}
      />
    ),
  },
  dimension: {
    trail: (mode) => ({ label: mode.dimensionLabel }),
    search: (mode) => `Search ${mode.dimensionLabel}...`,
    enter: "select",
    render: (mode, { state, onClose }) => (
      <DimensionView
        dimension={mode.dimension}
        category={mode.category}
        query={state.query}
        onClose={onClose}
      />
    ),
  },
  "location-search": {
    trail: () => ({ label: "Go to location" }),
    search: () => "Search address or place...",
    enter: "go to",
    render: (_, { state, onClose }) => <LocationSearchView query={state.query} onClose={onClose} />,
  },
  config: {
    trail: () => ({ label: "Configuration" }),
    search: () => "Search by id or name...",
    layout: "list-detail",
    enter: "select",
    render: (mode, { state, isWide, treeOpen, onTreeOpenChange }) => (
      <ConfigView
        entityId={mode.entityId}
        focusCategory={mode.focusCategory}
        adding={mode.adding}
        query={state.query}
        isWide={isWide}
        treeOpen={treeOpen}
        onTreeOpenChange={onTreeOpenChange}
      />
    ),
  },
  "asset-readiness": {
    trail: () => ({ label: "Asset readiness" }),
    search: () => "Search assets...",
    enter: "select",
    render: (_, { state, dispatch }) => (
      <AssetReadinessView dispatch={dispatch} query={state.query} />
    ),
  },
  tracks: {
    trail: () => ({ label: "Tracks" }),
    search: () => "Search tracks...",
    enter: "select",
    render: (_, { state, onClose }) => <TracksView query={state.query} onClose={onClose} />,
  },
  asset: {
    trail: (mode) => entityTrail(mode.entityId, getEntityName),
    keys: "none",
    render: (mode, { dispatch }) => <AssetView entityId={mode.entityId} dispatch={dispatch} />,
  },
  "command-group": {
    trail: (mode) => ({ label: mode.groupLabel }),
    search: (mode) => `Search ${mode.groupLabel.toLowerCase()}...`,
    enter: "toggle",
    render: (mode, { state, commands, onClose }) => (
      <CommandGroupView
        groupId={mode.groupId}
        query={state.query}
        commands={commands}
        onClose={onClose}
        initialCommandId={mode.initialCommandId}
      />
    ),
  },
  "mission-health": {
    trail: () => ({ label: "Mission health" }),
    render: (_, { onClose }) => <MissionHealthView onClose={onClose} />,
  },
  "diagnostic-export": {
    trail: () => ({ label: "Report a bug" }),
    render: (_, { onClose }) => <DiagnosticExportView onClose={onClose} />,
  },
  "mission-export": {
    trail: () => ({ label: "Export mission pack" }),
    render: (_, { onClose }) => <MissionExportView onClose={onClose} />,
  },
  sources: {
    trail: () => ({ label: "Sources" }),
    keys: "grid",
    enter: "select",
    render: (_, { dispatch }) => <SourcesView dispatch={dispatch} />,
  },
  "source-services": {
    trail: (mode) => ({ label: getSourceTexts(mode.source).title }),
    keys: "grid",
    enter: "select",
    render: (mode, { dispatch }) => <SourceServicesView source={mode.source} dispatch={dispatch} />,
  },
  "add-source-service": {
    trail: (mode) => ({ label: getSourceTexts(mode.source).addService }),
    keys: "grid",
    enter: "select",
    render: (mode, { dispatch }) => (
      <AddSourceServiceView source={mode.source} dispatch={dispatch} />
    ),
  },
  "source-service": {
    trail: (mode) => ({
      label: mode.providerId,
      liveLabel: (s) => {
        const group = selectDeviceGroups(s).services.get(mode.providerId);

        return group && getServiceLabel(group);
      },
    }),
    keys: "grid",
    enter: "select",
    render: (mode, { dispatch }) => (
      <SourceServiceView
        source={mode.source}
        providerId={mode.providerId}
        tab={mode.tab}
        onTabChange={(tab) => dispatch({ type: "replace", mode: { ...mode, tab } })}
        dispatch={dispatch}
      />
    ),
  },
  camera: {
    trail: (mode) => entityTrail(mode.entityId, getDeviceName),
    render: (mode, { dispatch }) => <CameraView entityId={mode.entityId} dispatch={dispatch} />,
  },
  device: {
    trail: (mode) => entityTrail(mode.entityId, getDeviceName),
    keys: "grid",
    enter: "select",
    render: (mode, { dispatch }) => (
      <DeviceView
        source={mode.source}
        entityId={mode.entityId}
        tab={mode.tab}
        onTabChange={(tab) => dispatch({ type: "replace", mode: { ...mode, tab } })}
        dispatch={dispatch}
      />
    ),
  },
  setup: {
    trail: null,
    layout: "wizard",
    render: (mode, { dispatch }) => (
      <SetupView entityId={mode.entityId} created={mode.created} dispatch={dispatch} />
    ),
  },
  settings: {
    trail: null,
    layout: "wizard",
    render: (mode, { dispatch }) => <SettingsView entityId={mode.entityId} dispatch={dispatch} />,
  },
  "other-services": {
    trail: () => ({ label: OTHER_SERVICES }),
    keys: "grid",
    enter: "select",
    render: (_, { dispatch }) => <OtherServicesView dispatch={dispatch} />,
  },
  "devices-without-service": {
    trail: () => ({ label: "Devices without a service" }),
    keys: "grid",
    enter: "select",
    render: (_, { dispatch }) => <DevicesWithoutServiceView dispatch={dispatch} />,
  },
};

function bind<K extends Kind>(kind: K, mode: ModeOf[K]) {
  const screen: Screen<ModeOf[K]> = SCREENS[kind];

  return {
    trail: screen.trail?.(mode) ?? null,
    search: screen.search?.(mode) ?? null,
    layout: screen.layout,
    keys: screen.keys,
    enter: screen.enter,
    render: (props: ScreenProps) => screen.render(mode, props),
  };
}

export function getScreen(mode: PaletteMode) {
  const screen = bind(mode.kind, mode);

  if ("tab" in mode && (mode.tab ?? "overview") !== "overview") {
    return { ...screen, keys: "none" as const, enter: undefined };
  }

  return screen;
}

export function getTrailSegments(
  stack: PaletteMode[],
  activeCategory: Category,
  rootQueryWasActive: boolean,
): TrailSegment[] {
  const rootLabel = rootQueryWasActive
    ? "Search"
    : (CATEGORIES.find((c) => c.id === activeCategory)?.label ?? activeCategory);

  return [
    { label: rootLabel, index: -1 },
    ...stack.flatMap((mode, index) => {
      const trail = getScreen(mode).trail;

      return trail ? [{ ...trail, index }] : [];
    }),
  ];
}
