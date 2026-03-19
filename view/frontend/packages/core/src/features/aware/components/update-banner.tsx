import { useThemeColors } from "@hydris/ui/lib/theme";
import { useEffect, useRef } from "react";
import { toast } from "sonner-native";

import { useUpdateAvailable } from "../store/version-store";

export function useUpdateBanner() {
  const updateAvailable = useUpdateAvailable();
  const t = useThemeColors();
  const tRef = useRef(t);
  tRef.current = t;
  const lastShownVersion = useRef<string | null>(null);

  useEffect(() => {
    if (!updateAvailable || updateAvailable === lastShownVersion.current) return;
    lastShownVersion.current = updateAvailable;
    const colors = tRef.current;

    toast("System update available", {
      id: "hydris-update",
      duration: Infinity,
      dismissible: false,
      action: {
        label: "Acknowledge",
        onClick: () => toast.dismiss("hydris-update"),
      },
      styles: {
        buttons: {
          marginTop: 10,
          flexDirection: "column",
        },
      },
      actionButtonStyle: {
        backgroundColor: colors.foreground,
        borderRadius: 4,
        paddingVertical: 6,
        alignSelf: "stretch",
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
      },
      actionButtonTextStyle: {
        color: colors.card,
        fontSize: 12,
        fontWeight: "600",
        alignSelf: "center",
      },
    });

    return () => {
      toast.dismiss("hydris-update");
    };
  }, [updateAvailable]);
}
