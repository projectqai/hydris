import type { Preset } from "@hydris/ui/layout/types";
import type { ComponentType } from "react";

import { ChatPane } from "./components/panes/chat-pane";
import { ContactReportsPane } from "./components/panes/contact-reports-pane";
import { EntityDetailsPane } from "./components/panes/entity-details-pane";
import { EntityListPane } from "./components/panes/entity-list-pane";
import { MapPane } from "./components/panes/map-pane";
import { AlertsPlaceholder } from "./components/panes/placeholder-panes";
import { EnvironmentWidget } from "./widgets/environment-widget";
import { EquipmentWidget } from "./widgets/equipment-widget";
import { VitalWidget } from "./widgets/vital-widget";

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
  vitals: VitalWidget,
  equipment: EquipmentWidget,
};

export const COMPONENT_LABELS: Record<string, string> = {
  mapPane: "Map",
  entityList: "Entity List",
  entityDetails: "Detail",
  contactReports: "Contact Reports",
  alerts: "Alerts",
  chat: "Chat",
  environment: "Environment",
  vitals: "Vitals",
  equipment: "Equipment",
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
