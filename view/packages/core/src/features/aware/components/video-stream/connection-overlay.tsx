import { ON_DARK_ICON_MUTED } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { AlertCircle, WifiOff } from "lucide-react-native";
import { createContext, use, useEffect } from "react";
import { Pressable, Text, View } from "react-native";

import type { ConnectionState } from "./types";

export type StreamStatus = { state: ConnectionState; error: string | null };

type ReportStatus = (status: StreamStatus | null) => void;

export const StreamPreviewContext = createContext<ReportStatus | null>(null);

export function connectionLabel({ state, error }: StreamStatus) {
  if (state === "failed") return error || "Connection failed";

  return state === "reconnecting" ? "Reconnecting…" : "Connecting…";
}

type ConnectionOverlayProps = {
  state: ConnectionState;
  error: string | null;
  onRetry: () => void;
  retryAccessibilityLabel?: string;
};

export function ConnectionOverlay({
  state,
  error,
  onRetry,
  retryAccessibilityLabel = "Retry connection",
}: ConnectionOverlayProps) {
  const reportStatus = use(StreamPreviewContext);

  useEffect(() => {
    if (!reportStatus) return;

    reportStatus({ state, error });

    return () => reportStatus(null);
  }, [reportStatus, state, error]);

  if (reportStatus || state === "connected") return null;

  const isLoading = state === "idle" || state === "connecting" || state === "reconnecting";
  const isFailed = state === "failed";
  const isNetworkError =
    error?.includes("ICE") || error?.includes("network") || error?.includes("timeout");

  return (
    <View
      className={cn(
        "absolute inset-0 items-center justify-center select-none",
        isFailed ? "bg-black" : "bg-black/60",
      )}
    >
      {isLoading && (
        <Text className="font-mono text-xs text-white/75">{connectionLabel({ state, error })}</Text>
      )}

      {isFailed && (
        <>
          {isNetworkError ? (
            <WifiOff size={20} color={ON_DARK_ICON_MUTED} />
          ) : (
            <AlertCircle size={20} color={ON_DARK_ICON_MUTED} />
          )}
          <Text className="mt-2 font-mono text-xs text-white/75">
            {connectionLabel({ state, error })}
          </Text>
          <Pressable
            onPress={onRetry}
            accessibilityLabel={retryAccessibilityLabel}
            accessibilityRole="button"
            className="mt-3 rounded border border-white/20 px-3 py-2.5 hover:bg-white/8 active:bg-white/10"
          >
            <Text className="font-sans-medium text-xs text-white/75">Retry</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
