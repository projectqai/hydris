import "../global.css";

import { configureReanimatedLogger, ReanimatedLogLevel } from "react-native-reanimated";

if (__DEV__) {
  configureReanimatedLogger({
    level: ReanimatedLogLevel.warn,
    strict: false,
  });
}

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { AlarmOverlay } from "@hydris/core/features/sensors/components/alarm-overlay";
import { useFonts } from "expo-font";
import { activateKeepAwakeAsync } from "expo-keep-awake";
import * as Linking from "expo-linking";
import * as NavigationBar from "expo-navigation-bar";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { useEffect } from "react";
import { Appearance, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Toaster } from "sonner-native";

SplashScreen.preventAutoHideAsync();

if (process.env.EXPO_OS !== "web") {
  activateKeepAwakeAsync();
}

import { useThemeStore } from "@hydris/core/features/aware/store/theme-store";
import * as HydrisEngine from "@hydris/engine";
import { useThemeColors } from "@hydris/ui/lib/theme";
import Constants from "expo-constants";

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const t = useThemeColors();
  const [fontsLoaded] = useFonts(
    process.env.EXPO_OS !== "web"
      ? {
          Inter: Inter_400Regular,
          "Inter-Medium": Inter_500Medium,
          "Inter-SemiBold": Inter_600SemiBold,
          "Inter-Bold": Inter_700Bold,
        }
      : {},
  );

  const themePreference = useThemeStore((s) => s.preference);

  useEffect(() => {
    const apply = (scheme: "dark" | "light") => {
      setColorScheme(scheme);

      if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("dark", scheme === "dark");
      }
    };

    if (themePreference !== "system") {
      apply(themePreference);
      return;
    }
    apply(Appearance.getColorScheme() ?? "dark");
    const sub = Appearance.addChangeListener(({ colorScheme: cs }) => {
      apply(cs ?? "dark");
    });
    return () => sub.remove();
  }, [themePreference, setColorScheme]);

  useEffect(() => {
    if (process.env.EXPO_OS === "android") {
      NavigationBar.setVisibilityAsync("hidden");
    }
  }, []);

  useEffect(() => {
    if (process.env.EXPO_OS === "web") return;

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const { hostname, queryParams } = Linking.parse(url);
      if (hostname === "aware" && queryParams) {
        router.navigate({ pathname: "/aware", params: queryParams });
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const hasRemoteBackend = !!Constants.expoConfig?.extra?.PUBLIC_HYDRIS_API_URL;
    if (process.env.EXPO_OS === "android" && !hasRemoteBackend) {
      HydrisEngine.startEngineService();
    }
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <View className="flex-1 bg-background">
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: t.background },
                animation: "none",
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="aware" />
            </Stack>
            <StatusBar hidden style={colorScheme === "dark" ? "light" : "dark"} />
            <Toaster
              position="top-center"
              offset={68}
              toastOptions={{
                style: {
                  backgroundColor: t.card,
                  borderColor: t.border,
                  borderWidth: 1,
                  borderRadius: 4,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  ...(process.env.EXPO_OS === "web"
                    ? { alignSelf: "center", flexGrow: 0, flexShrink: 1 }
                    : { marginHorizontal: "35%" }),
                },
                titleStyle: {
                  color: t.foreground,
                },
              }}
            />
          </View>
          <AlarmOverlay />
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
