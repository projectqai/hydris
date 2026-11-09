import { useFonts } from "expo-font";
import { LinearGradient } from "expo-linear-gradient";
import { cssInterop, useColorScheme } from "nativewind";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { View } from "react-native";

import { AppToaster } from "../foss/components/app-toaster";
import { NATIVE_FONTS } from "./native-fonts";

cssInterop(LinearGradient, { className: "style" });

export type Scheme = "light" | "dark";

export function ThemeFrame({ scheme, children }: { scheme: Scheme; children: ReactNode }) {
  const { setColorScheme } = useColorScheme();
  const [fontsLoaded] = useFonts(NATIVE_FONTS);

  useEffect(() => {
    setColorScheme(scheme);
  }, [scheme, setColorScheme]);

  if (!fontsLoaded) return null;

  return (
    <View className="native:flex-1 bg-background">
      {children}
      <AppToaster />
    </View>
  );
}
