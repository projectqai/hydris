import { useThemeColors } from "@hydris/ui/lib/theme";
import { useColorScheme } from "nativewind";
import { Toaster } from "sonner";

export function AppToaster() {
  const t = useThemeColors();
  const { colorScheme } = useColorScheme();

  return (
    <Toaster
      position="top-center"
      offset={68}
      theme={colorScheme ?? "dark"}
      toastOptions={{
        style: {
          backgroundColor: t.card,
          borderColor: t.border,
          borderWidth: 1,
          borderRadius: 4,
          color: t.foreground,
        },
        actionButtonStyle: {
          backgroundColor: t.foreground,
          color: t.card,
          borderRadius: 4,
          fontSize: 13,
          fontWeight: 600,
        },
        cancelButtonStyle: {
          backgroundColor: t.muted,
          color: t.controlFg,
          borderRadius: 4,
          fontSize: 13,
          fontWeight: 600,
        },
      }}
    />
  );
}
