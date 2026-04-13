import { FloatingWindow } from "@hydris/ui/floating-window";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { PANEL_TOP_OFFSET } from "@hydris/ui/panels";
import { Activity, GripHorizontal, X } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";

import { VideoStream } from "./components/video-stream/video-stream";
import { getInitialPosition, updateLastWindowPosition, usePIPContext } from "./pip-context";

type PIPPlayerProps = {
  minTop?: number;
};

export function PIPPlayer({ minTop = PANEL_TOP_OFFSET - 12 }: PIPPlayerProps) {
  const t = useThemeColors();
  const positionsCacheRef = useRef(new Map<string, { x: number; y: number }>());
  const { windows, closePIP } = usePIPContext();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const getWindowPosition = (windowId: string): { x: number; y: number } => {
    const cache = positionsCacheRef.current;
    if (!cache.has(windowId)) {
      const pos = getInitialPosition(screenWidth, screenHeight, minTop);
      cache.set(windowId, pos);
      updateLastWindowPosition(pos);
    }
    return cache.get(windowId)!;
  };

  useEffect(() => {
    const cache = positionsCacheRef.current;
    if (windows.length === 0) {
      cache.clear();
      return;
    }
    const windowIds = new Set(windows.map((w) => w.id));
    for (const id of cache.keys()) {
      if (!windowIds.has(id)) {
        cache.delete(id);
      }
    }
  }, [windows]);

  if (windows.length === 0) {
    return null;
  }

  return (
    <>
      {windows.map((window) => (
        <FloatingWindow
          key={window.id}
          isVisible={true}
          minTop={minTop}
          initialPosition={getWindowPosition(window.id)}
          onPositionChange={updateLastWindowPosition}
          header={
            <View className="border-surface-overlay/10 flex-row items-center justify-between border-b px-4 py-3">
              <View className="flex-1 flex-row items-center gap-1">
                <GripHorizontal size={14} color={t.iconMuted} strokeWidth={1.5} />
                <Text className="font-sans-medium text-foreground/90 text-xs" numberOfLines={1}>
                  {window.entityName || "Unknown"}
                </Text>
                {window.cameraLabel && (
                  <>
                    <Text className="text-foreground/75 text-11 font-mono">·</Text>
                    <Text className="text-foreground/75 text-11 font-mono" numberOfLines={1}>
                      {window.cameraLabel}
                    </Text>
                  </>
                )}
              </View>
              <Pressable
                onPress={() => closePIP(window.id)}
                hitSlop={8}
                accessibilityLabel="Close video window"
                accessibilityRole="button"
                className="relative z-50 ml-2 cursor-pointer active:opacity-50"
              >
                <X size={16} color={t.iconMuted} strokeWidth={2} />
              </Pressable>
            </View>
          }
          content={
            <VideoStream
              url={window.cameraUrl}
              protocol={window.cameraProtocol}
              objectFit="contain"
            />
          }
          footer={
            <View className="border-surface-overlay/10 bg-surface-overlay/5 flex-row items-center justify-between border-t px-4 py-2">
              <View className="flex-row items-center gap-1.5">
                <Activity size={10} color={t.activeGreen} strokeWidth={2} />
                <Text className="text-9 font-mono" style={{ color: t.activeGreen }}>
                  LIVE
                </Text>
              </View>
              <Text className="text-foreground/75 text-9 font-mono" numberOfLines={1}>
                {window.entityId}
              </Text>
            </View>
          }
        />
      ))}
    </>
  );
}
