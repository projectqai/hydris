import { ControlIconButton } from "@hydris/ui/controls";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { Bell } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

export function TopBarShell({ children }: { children: ReactNode }) {
  const t = useThemeColors();

  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: t.topBarBorderBottom,
        borderTopWidth: 1,
        borderTopColor: t.borderFaint,
        backgroundColor: t.topBarBg,
        // @ts-ignore react-native-web CSS property
        userSelect: "none",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
        elevation: 6,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 10,
        }}
      >
        <View className="flex-1">{children}</View>
        <ControlIconButton
          icon={Bell}
          onPress={() => {}}
          size="md"
          accessibilityLabel="Notifications"
          disabled
        />
      </View>
    </View>
  );
}
