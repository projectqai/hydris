import type { PaletteMode } from "@hydris/ui/command-palette/palette-reducer";
import type { LucideIcon } from "lucide-react-native";
import {
  Eye,
  Layout,
  Map,
  MapPin,
  MousePointerClick,
  Pencil,
  RotateCcw,
  Settings,
  SunMoon,
  ZoomIn,
  ZoomOut,
} from "lucide-react-native";
import { toast } from "sonner-native";

import { PRESET_KEYBINDS } from "../../constants";
import { mapEngineActions } from "../../store/map-engine-store";
import { useMapStore } from "../../store/map-store";
import { useOverlayStore } from "../../store/overlay-store";
import { resetWorld } from "../../store/reset-world";
import { useSelectionStore } from "../../store/selection-store";
import { useThemeStore } from "../../store/theme-store";

export type Command = {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  shortcut?: string;
  category:
    | "configuration"
    | "display"
    | "overlay"
    | "map"
    | "preset"
    | "layout"
    | "selection"
    | "world";
  action: () => void;
  mode?: PaletteMode;
  holdToConfirm?: boolean;
};

export type LayoutActions = {
  presetSelect: (id: string) => void;
  customize: () => void;
  resetLayout: () => void;
};

export function buildCommands(layout: LayoutActions): Command[] {
  const commands: Command[] = [
    {
      id: "configuration",
      label: "Configuration",
      icon: Settings,
      category: "configuration",
      action: () => {},
      mode: { kind: "config" },
    },

    // Display
    {
      id: "display-dark-theme",
      label: "Switch to dark theme",
      icon: SunMoon,
      category: "display",
      action: () => useThemeStore.getState().setPreference("dark"),
    },
    {
      id: "display-light-theme",
      label: "Switch to light theme",
      icon: SunMoon,
      category: "display",
      action: () => useThemeStore.getState().setPreference("light"),
    },
    {
      id: "display-system-theme",
      label: "Use system theme",
      icon: SunMoon,
      category: "display",
      action: () => useThemeStore.getState().setPreference("system"),
    },

    // Layout
    {
      id: "layout-customize",
      label: "Customize layout",
      icon: Pencil,
      category: "layout",
      action: () => layout.customize(),
    },
    {
      id: "layout-reset",
      label: "Reset layout to preset",
      icon: RotateCcw,
      category: "layout",
      action: () => layout.resetLayout(),
    },
    // Map
    {
      id: "map-go-to-location",
      label: "Search for a location",
      icon: MapPin,
      category: "map",
      action: () => {},
      mode: { kind: "location-search" },
    },
    {
      id: "map-dark",
      label: "Switch to dark map",
      icon: Map,
      category: "map",
      action: () => {
        useMapStore.getState().setLayer("dark");
      },
    },
    {
      id: "map-satellite",
      label: "Switch to satellite map",
      icon: Map,
      category: "map",
      action: () => {
        useMapStore.getState().setLayer("satellite");
      },
    },
    {
      id: "map-street",
      label: "Switch to street map",
      icon: Map,
      category: "map",
      action: () => {
        useMapStore.getState().setLayer("street");
      },
    },
    {
      id: "map-zoom-in",
      label: "Zoom in",
      icon: ZoomIn,
      category: "map",
      action: () => mapEngineActions.zoomIn(),
    },
    {
      id: "map-zoom-out",
      label: "Zoom out",
      icon: ZoomOut,
      category: "map",
      action: () => mapEngineActions.zoomOut(),
    },

    // Overlays
    {
      id: "overlay-tracks-blue",
      label: "Toggle blue tracks",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("tracks", "blue"),
    },
    {
      id: "overlay-coverage",
      label: "Toggle coverage area",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("visualization", "coverage"),
    },
    {
      id: "overlay-datalinks",
      label: "Toggle datalinks",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("network", "datalinks"),
    },
    {
      id: "overlay-sensors-degraded",
      label: "Toggle degraded sensors",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("sensors", "degraded"),
    },
    {
      id: "overlay-shapes",
      label: "Toggle geoshapes",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("visualization", "shapes"),
    },
    {
      id: "overlay-detections",
      label: "Toggle detections",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("visualization", "detections"),
    },
    {
      id: "overlay-track-history",
      label: "Toggle track history",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("visualization", "trackHistory"),
    },
    {
      id: "overlay-tracks-neutral",
      label: "Toggle neutral tracks",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("tracks", "neutral"),
    },
    {
      id: "overlay-sensors-online",
      label: "Toggle online sensors",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("sensors", "online"),
    },
    {
      id: "overlay-tracks-red",
      label: "Toggle red tracks",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("tracks", "red"),
    },
    {
      id: "overlay-tracks-unknown",
      label: "Toggle unknown tracks",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("tracks", "unknown"),
    },
    {
      id: "overlay-tracks-unclassified",
      label: "Toggle unclassified tracks",
      icon: Eye,
      category: "overlay",
      action: () => useOverlayStore.getState().toggle("tracks", "unclassified"),
    },

    // Presets
    {
      id: "preset-inspect",
      label: "Switch to Inspect",
      icon: Layout,
      shortcut: PRESET_KEYBINDS.inspect,
      category: "preset",
      action: () => layout.presetSelect("inspect"),
    },
    {
      id: "preset-overview",
      label: "Switch to Overview",
      icon: Layout,
      shortcut: PRESET_KEYBINDS.overview,
      category: "preset",
      action: () => layout.presetSelect("overview"),
    },
    {
      id: "preset-survey",
      label: "Switch to Survey",
      icon: Layout,
      shortcut: PRESET_KEYBINDS.survey,
      category: "preset",
      action: () => layout.presetSelect("survey"),
    },
    {
      id: "preset-watch",
      label: "Switch to Watch",
      icon: Layout,
      shortcut: PRESET_KEYBINDS.watch,
      category: "preset",
      action: () => layout.presetSelect("watch"),
    },

    // Selection
    {
      id: "selection-clear",
      label: "Clear selection",
      icon: MousePointerClick,
      category: "selection",
      action: () => useSelectionStore.getState().clearSelection(),
    },
    {
      id: "selection-follow",
      label: "Toggle follow mode",
      icon: Eye,
      category: "selection",
      action: () => useSelectionStore.getState().toggleFollow(),
    },

    // World
    {
      id: "world-reset",
      label: "Reset world",
      description: "Clears all entities including persisted data",
      icon: RotateCcw,
      category: "world",
      holdToConfirm: true,
      action: () => {
        resetWorld()
          .then(() => toast("All world data cleared"))
          .catch(() => toast.error("World reset failed, check connection"));
      },
    },
  ];
  return commands;
}
