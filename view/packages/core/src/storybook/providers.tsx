import { KeyboardProvider } from "@hydris/ui/keyboard";
import { PanelProvider } from "@hydris/ui/panels";
import type { Decorator } from "@storybook/react-native-web-vite";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { fn } from "storybook/test";

import { CameraPaneProvider } from "../features/aware/camera-pane-context";
import type { PaletteContextValue } from "../features/aware/palette-context";
import { PaletteContext } from "../features/aware/palette-context";
import { PaneEntityProvider } from "../features/aware/pane-entity-context";
import { PIPProvider } from "../features/aware/pip-context";
import type { PlacementContextValue } from "../features/aware/placement-context";
import { PlacementContext } from "../features/aware/placement-context";

export function placement(overrides?: Partial<PlacementContextValue>): PlacementContextValue {
  return {
    enterPlacement: fn().mockName("enterPlacement"),
    exitPlacement: fn().mockName("exitPlacement"),
    isPlacing: false,
    canPlace: true,
    ...overrides,
  };
}

export function placementFrom<
  TArgs extends { enterPlacement: PlacementContextValue["enterPlacement"] },
>(): Decorator<TArgs> {
  return (Story, { args }) => (
    <PlacementContext.Provider value={placement({ enterPlacement: args.enterPlacement })}>
      <Story />
    </PlacementContext.Provider>
  );
}

// without these the provider renders nothing until it measures
const METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export function coreProviders(value: PlacementContextValue = placement()): Decorator {
  return (Story) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <KeyboardProvider>
        <PanelProvider>
          <PIPProvider>
            <PlacementContext.Provider value={value}>
              <Story />
            </PlacementContext.Provider>
          </PIPProvider>
        </PanelProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

export function paneEntity<TArgs extends { onPin: () => void }>(
  entityId?: string,
): Decorator<TArgs> {
  return (Story, { args }) => (
    <PaneEntityProvider entityId={entityId} onPin={args.onPin}>
      <Story />
    </PaneEntityProvider>
  );
}

export function paletteOpener<
  TArgs extends { onOpenPalette: PaletteContextValue["open"] },
>(): Decorator<TArgs> {
  return (Story, { args }) => (
    <PaletteContext.Provider value={{ open: args.onOpenPalette }}>
      <Story />
    </PaletteContext.Provider>
  );
}

export function cameraInPane(cameraId: string): Decorator {
  return (Story) => (
    <CameraPaneProvider isInPane={(id) => id === cameraId}>
      <Story />
    </CameraPaneProvider>
  );
}
