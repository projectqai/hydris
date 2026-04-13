import type { Preset } from "@hydris/ui/layout/types";
import type { ComponentType } from "react";

import { ChatPane } from "./components/panes/chat-pane";
import { ContactReportsPane } from "./components/panes/contact-reports-pane";
import { EntityDetailsPane } from "./components/panes/entity-details-pane";
import { EntityListPane } from "./components/panes/entity-list-pane";
import { MapPane } from "./components/panes/map-pane";
import { AlertsPlaceholder } from "./components/panes/placeholder-panes";
import { EnvironmentWidget } from "./widgets/environment-widget";

export const TIMING_CONFIG = { duration: 220 };
export const DIVIDER_SIZE = 6;
export const COLLAPSED_PX = 22;
export const COLLAPSE_FADE_START = 0.1;
export const SIZE_COLLAPSED = 30;
export const SIZE_COLLAPSE_FADE = 80;
export const MID_SNAP_POINTS = [0.15, 0.18, 0.25, 0.33, 0.4, 0.5, 0.6, 0.67, 0.75, 0.82, 0.85];
export const STORAGE_KEY = "@hydris/layout";
export const PERSIST_DEBOUNCE_MS = 500;

export const Z = {
  PALETTE: 100,
  WIDGET_PICKER: 90,
  FLOATING_WINDOW: 60,
  TOPBAR: 50,
  SWAP_OVERLAY: 25,
  COLLAPSED: 20,
  HEADER: 10,
  MAP_OVERLAY: 2,
  MAP_ENGINE: 1,
} as const;

export const AMBER = "rgb(245, 158, 11)";
export const AMBER_25 = "rgba(245, 158, 11, 0.25)";

export const PRESET_KEYBINDS: Record<string, string> = {
  inspect: "F1",
  watch: "F2",
  overview: "F3",
  survey: "F4",
};

export const COMPONENT_REGISTRY: Record<string, ComponentType> = {
  mapPane: MapPane,
  entityList: EntityListPane,
  entityDetails: EntityDetailsPane,
  contactReports: ContactReportsPane,
  alerts: AlertsPlaceholder,
  chat: ChatPane,
  environment: EnvironmentWidget,
};

export const COMPONENT_LABELS: Record<string, string> = {
  mapPane: "Map",
  entityList: "Entity List",
  entityDetails: "Detail",
  contactReports: "Contact Reports",
  alerts: "Alerts",
  chat: "Chat",
  environment: "Environment",
};

export const PRESETS: Preset[] = [
  {
    id: "inspect",
    name: "Inspect",
    root: {
      type: "split",
      direction: "horizontal",
      ratio: 0.15,
      first: {
        type: "pane",
        id: "pane-1",
        content: { type: "component", componentId: "entityList" },
      },
      second: {
        type: "split",
        direction: "horizontal",
        ratio: 0.824,
        first: {
          type: "pane",
          id: "pane-2",
          content: { type: "component", componentId: "mapPane" },
        },
        second: {
          type: "pane",
          id: "pane-3",
          content: { type: "component", componentId: "entityDetails" },
        },
      },
    },
  },
  {
    id: "watch",
    name: "Watch",
    root: {
      type: "split",
      direction: "horizontal",
      ratio: 0.82,
      first: {
        type: "pane",
        id: "pane-1",
        content: { type: "component", componentId: "mapPane" },
      },
      second: {
        type: "pane",
        id: "pane-2",
        content: { type: "component", componentId: "entityList" },
      },
    },
  },
  {
    id: "overview",
    name: "Overview",
    root: {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: {
          type: "pane",
          id: "pane-1",
          content: { type: "component", componentId: "mapPane" },
        },
        second: {
          type: "pane",
          id: "pane-2",
          content: { type: "component", componentId: "entityList" },
        },
      },
      second: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: {
          type: "pane",
          id: "pane-3",
          content: { type: "component", componentId: "entityDetails" },
        },
        second: {
          type: "pane",
          id: "pane-4",
          content: { type: "component", componentId: "alerts" },
        },
      },
    },
  },
  {
    id: "survey",
    name: "Survey",
    root: {
      type: "pane",
      id: "pane-1",
      content: { type: "component", componentId: "mapPane" },
    },
  },
];
