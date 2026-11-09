import { useThemeColors } from "@hydris/ui/lib/theme";
import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";

import { Z } from "../../constants";

export function PickerModalShell({
  ariaLabel,
  onClose,
  maxWidth = 480,
  children,
}: {
  ariaLabel: string;
  onClose: () => void;
  maxWidth?: number;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: Z.WIDGET_PICKER,
      }}
    >
      {Platform.OS === "web" && (
        <Pressable
          onPress={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: t.backdrop,
          }}
        />
      )}

      <View
        role="dialog"
        aria-label={ariaLabel}
        aria-modal={true}
        style={
          Platform.OS === "web"
            ? {
                alignSelf: "center",
                marginTop: "10%",
                width: "95%",
                maxWidth,
                maxHeight: "75%",
                borderRadius: 10,
                backgroundColor: t.card,
                borderWidth: 1,
                borderColor: t.borderSubtle,
                boxShadow: "0 24px 48px rgba(0,0,0,0.7)",
                overflow: "hidden",
              }
            : { flex: 1, backgroundColor: t.card }
        }
      >
        {children}
      </View>
    </View>
  );
}
