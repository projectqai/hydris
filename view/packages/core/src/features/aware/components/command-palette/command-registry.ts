import type { PaletteMode } from "@hydris/ui/command-palette/palette-reducer";
import type { LayoutNode } from "@hydris/ui/layout/types";
import type { LucideIcon } from "lucide-react-native";
import {
  Eye,
  Layout,
  Link2,
  Lock,
  Map,
  MapPin,
  MousePointerClick,
  Pencil,
  RotateCcw,
  Save,
  Settings,
  SunMoon,
  ZoomIn,
  ZoomOut,
} from "lucide-react-native";

import { toast } from "../../../../lib/sonner";
import { PRESET_KEYBINDS, PRESETS } from "../../constants";
import { mapEngineActions } from "../../store/map-engine-store";
import { useMapStore } from "../../store/map-store";
import { useMissionKitStore } from "../../store/mission-kit-store";
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
    | "sharing"
    | "save-shared-view"
    | "world";
  action: () => void;
  mode?: PaletteMode;
  holdToConfirm?: boolean;
};

export type LayoutActions = {
  presetSelect: (id: string) => void;
  customize: () => void;
  resetLayout: () => void;
  shareView: () => void;
  saveCustomTree: (presetId: string, tree: LayoutNode) => void;
  clearCustomTree: (presetId: string) => void;
  toggleScreenLock: () => boolean;
};

export function buildCommands(layout: LayoutActions): Command[] {
  const commands: Command[] = [
    {
      id: "configuration",
      label: "Configuration",
      description: "Device and sensor settings",
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
    {
      id: "display-lock-screen",
      label: "Toggle screen lock",
      description: "Block touch input to prevent accidental interaction",
      icon: Lock,
      category: "display",
      action: () => {
        const locked = layout.toggleScreenLock();
        if (locked) {
          toast.info("Screen locked", { description: "Open command menu to unlock" });
        } else {
          toast.success("Screen unlocked");
        }
      },
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
      description: "Fly to an address or place",
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

    // Sharing
    {
      id: "sharing-copy-link",
      label: "Copy share link",
      description: "Link with current layout, layers and filters",
      icon: Link2,
      category: "sharing",
      action: () => layout.shareView(),
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
          .then(() => toast.success("All world data cleared"))
          .catch(() => toast.error("World reset failed, check connection"));
      },
    },
  ];

  const pending = useMissionKitStore.getState().pendingLayout;
  if (pending) {
    for (const preset of PRESETS) {
      commands.push({
        id: `save-shared-view-${preset.id}`,
        label: `Save to ${preset.name}`,
        icon: Save,
        category: "save-shared-view",
        action: () => {
          const p = useMissionKitStore.getState().pendingLayout;
          if (!p) return;
          useMissionKitStore
            .getState()
            .save(preset.id, preset.name, p.tree)
            .then(() => {
              layout.saveCustomTree(preset.id, p.tree);
              layout.presetSelect(preset.id);
              if (preset.id !== p.presetId) {
                layout.clearCustomTree(p.presetId);
              }
              useMissionKitStore.getState().clearPendingLayout();
              toast.dismiss("shared-layout");
              toast.success(`Layout saved to ${preset.name}`);
            })
            .catch(() => toast.error("Failed to save layout"));
        },
      });
    }
  }

  return commands;
}
