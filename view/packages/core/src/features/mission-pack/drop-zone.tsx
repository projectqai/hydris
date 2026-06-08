import { useThemeColors } from "@hydris/ui/lib/theme";
import { Package } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { Z } from "../aware/constants";
import { useMissionPack } from "./use-mission-pack";

const IS_WEB = process.env.EXPO_OS === "web";

function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

export function DropZone() {
  const [active, setActive] = useState(false);
  const counter = useRef(0);
  const t = useThemeColors();
  const { importPack } = useMissionPack();

  useEffect(() => {
    if (!IS_WEB) return;

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      counter.current += 1;
      if (counter.current === 1) setActive(true);
    };
    const onLeave = () => {
      counter.current = Math.max(0, counter.current - 1);
      if (counter.current === 0) setActive(false);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      counter.current = 0;
      setActive(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      void importPack({ kind: "web", file });
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [importPack]);

  if (!active) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: "center",
        alignItems: "center",
        zIndex: Z.DROP_ZONE,
      }}
      pointerEvents="none"
    >
      <Animated.View
        entering={FadeIn.duration(140).reduceMotion(ReduceMotion.System)}
        exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: t.backdrop,
        }}
      />
      <Animated.View
        entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
        exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
        style={{
          paddingHorizontal: 56,
          paddingVertical: 40,
          borderRadius: 10,
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: t.borderSubtle,
          borderTopColor: t.borderMedium,
          borderBottomColor: t.borderFaint,
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.7)",
          alignItems: "center",
        }}
      >
        <Package size={40} color={t.iconStrong} strokeWidth={1.5} aria-hidden />
        <Text className="font-sans-semibold mt-4 text-base" style={{ color: t.foreground }}>
          Drop mission pack to load
        </Text>
        <Text className="mt-1.5 font-sans text-xs" style={{ color: t.mutedForeground }}>
          .zip
        </Text>
      </Animated.View>
    </View>
  );
}
