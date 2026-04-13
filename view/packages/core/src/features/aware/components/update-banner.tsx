import { type ThemeColors, useThemeColors } from "@hydris/ui/lib/theme";
import { Info } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Linking } from "react-native";
import { toast } from "sonner-native";

import { useUpdateAvailable } from "../store/version-store";

function UpdateIcon() {
  const t = useThemeColors();
  return <Info size={20} color={t.foreground} />;
}

function getToastStyles(colors: ThemeColors) {
  return {
    styles: {
      buttons: {
        marginTop: 8,
        flexDirection: "column" as const,
        alignItems: "stretch" as const,
        gap: 6,
      },
    },
    actionButtonStyle: {
      backgroundColor: colors.foreground,
      borderRadius: 4,
      paddingVertical: 8,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      alignSelf: "stretch" as const,
    },
    actionButtonTextStyle: {
      color: colors.card,
      fontSize: 13,
      fontWeight: "600" as const,
      alignSelf: "center" as const,
    },
    cancelButtonStyle: {
      backgroundColor: colors.muted,
      borderRadius: 4,
      paddingVertical: 8,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      alignSelf: "stretch" as const,
    },
    cancelButtonTextStyle: {
      color: colors.controlFg,
      fontSize: 13,
      fontWeight: "600" as const,
      alignSelf: "center" as const,
    },
  };
}

export function useUpdateBanner() {
  const updateAvailable = useUpdateAvailable();
  const t = useThemeColors();
  const tRef = useRef(t);
  tRef.current = t;
  const lastShownVersion = useRef<string | null>(null);

  useEffect(() => {
    if (!updateAvailable || updateAvailable === lastShownVersion.current) return;
    lastShownVersion.current = updateAvailable;

    toast("System update available", {
      id: "hydris-update",
      duration: Infinity,
      dismissible: false,
      icon: <UpdateIcon />,
      action: {
        label: "Download Now",
        onClick: () => Linking.openURL("https://github.com/projectqai/hydris/releases"),
      },
      cancel: {
        label: "Dismiss",
        onClick: () => toast.dismiss("hydris-update"),
      },
      ...getToastStyles(tRef.current),
    });

    return () => {
      toast.dismiss("hydris-update");
    };
  }, [updateAvailable]);
}
