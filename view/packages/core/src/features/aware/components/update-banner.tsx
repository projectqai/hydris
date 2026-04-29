import { useEffect, useRef } from "react";
import { Linking } from "react-native";

import { toast } from "../../../lib/sonner";
import { useUpdateAvailable } from "../store/version-store";

export function useUpdateBanner() {
  const updateAvailable = useUpdateAvailable();
  const lastShownVersion = useRef<string | null>(null);

  useEffect(() => {
    if (__DEV__) return;
    if (!updateAvailable || updateAvailable === lastShownVersion.current) return;
    lastShownVersion.current = updateAvailable;

    toast.info("System update available", {
      id: "hydris-update",
      duration: Infinity,
      action: {
        label: "Download Now",
        onClick: () => Linking.openURL("https://github.com/projectqai/hydris/releases"),
      },
      cancel: {
        label: "Dismiss",
        onClick: () => toast.dismiss("hydris-update"),
      },
    });

    return () => {
      toast.dismiss("hydris-update");
    };
  }, [updateAvailable]);
}
