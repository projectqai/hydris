import { useThemeColors } from "@hydris/ui/lib/theme";
import type { ReactNode } from "react";
import { View } from "react-native";

export function Inset({ children }: { children: ReactNode }) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center gap-3 rounded px-2 py-2.5"
      style={{
        borderWidth: 1,
        borderColor: t.insetBorder,
        backgroundColor: t.insetBg,
        borderBottomColor: t.insetHighlight,
        // @ts-ignore react-native-web CSS property
        boxShadow: t.insetShadow,
      }}
    >
      {children}
    </View>
  );
}
