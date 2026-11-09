import type { Preview } from "@storybook/react-native";
import { useFonts } from "expo-font";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGlobals } from "storybook/preview-api";
import { restoreAllMocks } from "storybook/test";

import { startClock } from "../../../packages/core/src/storybook/clock";
import { resetStores } from "../../../packages/core/src/storybook/seed";
import { NATIVE_FONTS } from "../native-fonts";
import type { Scheme } from "../theme-decorator";
import { ThemeFrame } from "../theme-decorator";

const SCHEMES: readonly Scheme[] = ["light", "dark"];

type DeviceFrameProps = {
  centered: boolean;
  scheme: Scheme;
  onScheme: (scheme: Scheme) => void;
  children: ReactNode;
};

function DeviceFrame({ centered, scheme, onScheme, children }: DeviceFrameProps) {
  // text measured before Inter loads keeps the fallback width on Android
  const [fontsLoaded] = useFonts(NATIVE_FONTS);
  // the runner pads only the top and bottom insets
  const insets = useSafeAreaInsets();

  if (!fontsLoaded) return null;

  return (
    <View
      className="flex-1 self-stretch bg-background"
      style={{ paddingLeft: insets.left, paddingRight: insets.right }}
    >
      <View className="flex-1 p-4">
        <View className="mb-4 flex-row gap-2">
          {SCHEMES.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: scheme === value }}
              onPress={() => onScheme(value)}
              className="rounded-md border border-border px-3 py-1.5"
            >
              <Text className="font-sans-medium text-13 text-foreground">{value}</Text>
            </Pressable>
          ))}
        </View>
        <ThemeFrame scheme={scheme}>
          <View className={centered ? "flex-1 items-center justify-center" : "flex-1"}>
            {children}
          </View>
        </ThemeFrame>
      </View>
    </View>
  );
}

const preview: Preview = {
  // the device runner does not restore mocks between stories
  beforeEach: [resetStores, startClock, () => restoreAllMocks],
  initialGlobals: { scheme: "dark" },
  decorators: [
    (Story, { parameters }) => {
      const [globals, updateGlobals] = useGlobals();

      return (
        <DeviceFrame
          centered={parameters.layout === "centered"}
          scheme={globals.scheme}
          onScheme={(scheme) => updateGlobals({ scheme })}
        >
          <Story />
        </DeviceFrame>
      );
    },
  ],
};

export default preview;
