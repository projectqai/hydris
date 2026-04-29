import { useThemeColors } from "@hydris/ui/lib/theme";
import { Toaster } from "sonner-native";

export function AppToaster() {
  const t = useThemeColors();

  return (
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
          marginHorizontal: "35%",
        },
        titleStyle: {
          color: t.foreground,
        },
        descriptionStyle: {
          color: t.mutedForeground,
        },
        buttonsStyle: {
          marginTop: 8,
          flexDirection: "column" as const,
          alignItems: "stretch" as const,
          gap: 6,
        },
        actionButtonStyle: {
          backgroundColor: t.foreground,
          borderRadius: 4,
          paddingVertical: 8,
          justifyContent: "center" as const,
          alignItems: "center" as const,
          alignSelf: "stretch" as const,
        },
        actionButtonTextStyle: {
          color: t.card,
          fontSize: 13,
          fontWeight: "600" as const,
          alignSelf: "center" as const,
        },
        cancelButtonStyle: {
          backgroundColor: t.muted,
          borderRadius: 4,
          paddingVertical: 8,
          justifyContent: "center" as const,
          alignItems: "center" as const,
          alignSelf: "stretch" as const,
        },
        cancelButtonTextStyle: {
          color: t.controlFg,
          fontSize: 13,
          fontWeight: "600" as const,
          alignSelf: "center" as const,
        },
      }}
    />
  );
}
