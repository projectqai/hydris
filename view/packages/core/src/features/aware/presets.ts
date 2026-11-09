import type { Preset } from "@hydris/ui/layout/types";

export const PRESET_KEYBINDS: Record<string, string> = {
  inspect: "F1",
  watch: "F2",
  overview: "F3",
  survey: "F4",
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
