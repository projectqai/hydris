import { useIsScreenLocked } from "@hydris/ui/screen-lock";
import type { Entity } from "@projectqai/proto/world";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { type AxesInput, useManualControl } from "../../../../lib/api/use-manual-control";
import { useRunTask } from "../../../../lib/api/use-run-task";
import { useEntityTaskables } from "../../hooks/use-entity-taskables";

const MOUSE_SENSITIVITY = 0.3;
const DEAD_ZONE = 2;

export function ManualControlOverlay({
  camera,
  children,
}: {
  camera: Entity | undefined;
  children: ReactNode;
}) {
  const viewRef = useRef<View>(null);
  const keysRef = useRef(new Set<string>());
  const [showHint, setShowHint] = useState(true);

  const { enabled, start, stop, setAxes } = useManualControl(camera);
  const isScreenLocked = useIsScreenLocked();
  const taskables = useEntityTaskables(camera?.id);
  const { runTask } = useRunTask();

  const onPanStart = useCallback(() => {
    setShowHint(false);
    start();
  }, [start]);

  const onPanUpdate = useCallback(
    (dx: number, dy: number) => {
      const keys = keysRef.current;
      let forward = 0;
      let right = 0;
      if (keys.has("w")) forward += 1;
      if (keys.has("s")) forward -= 1;
      if (keys.has("d")) right += 1;
      if (keys.has("a")) right -= 1;

      const axes: AxesInput = {
        forward,
        right,
        pan: Math.abs(dx) > DEAD_ZONE ? dx * MOUSE_SENSITIVITY : 0,
        tilt: Math.abs(dy) > DEAD_ZONE ? -dy * MOUSE_SENSITIVITY : 0,
      };

      setAxes(axes);
    },
    [setAxes],
  );

  const onPanEnd = useCallback(() => {
    if (keysRef.current.size === 0) stop();
  }, [stop]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isScreenLocked)
        .onStart(() => {
          "worklet";
          runOnJS(onPanStart)();
        })
        .onChange((e) => {
          "worklet";
          runOnJS(onPanUpdate)(e.changeX, e.changeY);
        })
        .onEnd(() => {
          "worklet";
          runOnJS(onPanEnd)();
        })
        .minDistance(1),
    [onPanStart, onPanUpdate, onPanEnd, isScreenLocked],
  );

  useEffect(() => {
    if (!enabled || Platform.OS !== "web") return;

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(k)) {
        e.preventDefault();
        keysRef.current.add(k);
        setShowHint(false);
        start();
        onPanUpdate(0, 0);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keysRef.current.delete(k);
      onPanUpdate(0, 0);
      if (keysRef.current.size === 0) stop();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled, start, stop, onPanUpdate]);

  useEffect(() => {
    if (!enabled || Platform.OS !== "web") return;
    const el = (viewRef.current as unknown as HTMLElement) ?? null;
    if (!el || !el.addEventListener) return;

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setShowHint(false);
      if (taskables[0]) void runTask(taskables[0].id);
    };

    const onDragStart = (e: Event) => e.preventDefault();

    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("dragstart", onDragStart);

    return () => {
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("dragstart", onDragStart);
    };
  }, [enabled, taskables, runTask]);

  if (!enabled) return <>{children}</>;

  return (
    <GestureDetector gesture={panGesture}>
      <View
        ref={viewRef}
        collapsable={false}
        style={
          Platform.OS === "web"
            ? ({
                flex: 1,
                cursor: "crosshair",
                userSelect: "none",
                WebkitUserDrag: "none",
              } as never)
            : { flex: 1 }
        }
      >
        {children}
        {showHint && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              bottom: 12,
              left: 0,
              right: 0,
              alignItems: "center",
            }}
          >
            <View
              style={{
                backgroundColor: "rgba(0,0,0,0.6)",
                borderRadius: 4,
                paddingHorizontal: 10,
                paddingVertical: 5,
              }}
            >
              <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 11 }}>
                {Platform.OS === "web"
                  ? "Drag to look · WASD to move · Right-click to trigger"
                  : "Drag to look"}
              </Text>
            </View>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}
