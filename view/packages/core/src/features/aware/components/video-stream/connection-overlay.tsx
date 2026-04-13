import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { AlertCircle, WifiOff } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { ConnectionState } from "./types";

type ConnectionOverlayProps = {
  state: ConnectionState;
  error: string | null;
  onRetry: () => void;
};

export function ConnectionOverlay({ state, error, onRetry }: ConnectionOverlayProps) {
  const t = useThemeColors();
  if (state === "connected") return null;

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
        <Text className="text-foreground/75 font-mono text-xs">
          {state === "reconnecting" ? "Reconnecting..." : "Connecting..."}
        </Text>
      )}

      {isFailed && (
        <>
          {isNetworkError ? (
            <WifiOff size={20} color={t.iconMuted} />
          ) : (
            <AlertCircle size={20} color={t.iconMuted} />
          )}
          <Text className="text-foreground/75 mt-2 font-mono text-xs">
            {error || "Connection failed"}
          </Text>
          <Pressable
            onPress={onRetry}
            accessibilityLabel="Retry connection"
            accessibilityRole="button"
            className="border-foreground/20 hover:bg-foreground/8 active:bg-foreground/10 mt-3 rounded border px-3 py-2.5"
          >
            <Text className="font-sans-medium text-foreground/75 text-xs">Retry</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
