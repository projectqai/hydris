import { Pressable, Text, View } from "react-native";

import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

type Tab<T extends string> = {
  id: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  tabs: Tab<T>[];
  activeTab: T;
  onTabChange: (id: T) => void;
};

export function SegmentedControl<T extends string>({
  tabs,
  activeTab,
  onTabChange,
}: SegmentedControlProps<T>) {
  const t = useThemeColors();
  return (
    <View className="px-3 pt-4 pb-2">
      <View
        className="flex-row items-center gap-1 rounded-lg p-1"
        style={{
          backgroundColor: t.insetBg,
          borderWidth: 1,
          borderColor: t.insetBorder,
          borderBottomColor: t.insetHighlight,
          // @ts-ignore react-native-web CSS property
          boxShadow: t.insetShadow,
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onTabChange(tab.id)}
              className={cn(
                "flex-1 items-center rounded-md border py-1.5",
                isActive ? "border-border/50" : "border-transparent",
              )}
              style={
                isActive
                  ? {
                      backgroundColor: t.segmentBg,
                      // @ts-ignore react-native-web CSS property
                      boxShadow: t.segmentShadow,
                    }
                  : undefined
              }
            >
              <Text
                className={cn(
                  "font-sans-medium text-xs",
                  isActive ? "text-foreground" : "text-foreground/75",
                )}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
