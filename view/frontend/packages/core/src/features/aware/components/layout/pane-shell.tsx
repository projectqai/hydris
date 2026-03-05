"use no memo";

import { ActionButton } from "@hydris/ui/action-button";
import { EmptyState } from "@hydris/ui/empty-state";
import { LayoutEditingContext, SplitRatioContext } from "@hydris/ui/layout/contexts";
import type { NodePath, PaneContent, PaneId } from "@hydris/ui/layout/types";
import { useThemeColors } from "@hydris/ui/lib/theme";
import {
  AlertTriangle,
  ArrowLeftRight,
  ChevronDown,
  Columns,
  Replace,
  Rows,
  X,
} from "lucide-react-native";
import { useCallback, useContext } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { getEntityName } from "../../../../lib/api/use-track-utils";
import {
  COLLAPSE_FADE_START,
  COMPONENT_LABELS,
  COMPONENT_REGISTRY,
  SIZE_COLLAPSE_FADE,
  SIZE_COLLAPSED,
  Z,
} from "../../constants";
import { useEntityStore } from "../../store/entity-store";
import { toEmbedUrl } from "../video-stream/embed-providers";
import { resolveStreamUrl } from "../video-stream/resolve-stream-url";
import { VideoStream } from "../video-stream/video-stream";

function getPaneLabel(content: PaneContent): string {
  if (content.type === "camera") return "Camera";
  if (content.type === "iframe") return "Embed";
  if (content.type === "empty") return "Empty";
  if (content.type === "component")
    return COMPONENT_LABELS[content.componentId] ?? content.componentId;
  return "Pane";
}

function CameraPane({ entityId }: { entityId: string }) {
  const t = useThemeColors();
  const entity = useEntityStore((s) => s.entities.get(entityId));
  const name = entity ? getEntityName(entity) : entityId;
  const stream = entity?.camera?.streams?.[0];
  const resolved = stream ? resolveStreamUrl(stream, entityId, 0) : null;

  if (!resolved) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: t.background }}
      >
        <Text className="text-on-surface/70 font-sans text-sm">{name}</Text>
        <Text className="text-on-surface/70 mt-1 font-sans text-xs">No feed available</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <VideoStream url={resolved.url} protocol={resolved.protocol} />
    </View>
  );
}

function IframePane({ url }: { url: string }) {
  const t = useThemeColors();
  const embedUrl = toEmbedUrl(url);
  return (
    <View className="flex-1" style={{ backgroundColor: t.background }}>
      <iframe
        src={embedUrl}
        style={{ width: "100%", height: "100%", border: "none" }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="Embedded content"
      />
    </View>
  );
}

export function PaneShell({
  id,
  path,
  content,
}: {
  id: PaneId;
  path: NodePath;
  content: PaneContent;
}) {
  const t = useThemeColors();
  const {
    customizeProgress,
    isCustomizing,
    onSplit,
    onRemove,
    onRatioChange,
    totalPanes,
    swapSourceId,
    onSwapStart,
    onSwapTarget,
    pickerState,
    openPicker,
  } = useContext(LayoutEditingContext)!;
  const splitCtx = useContext(SplitRatioContext);

  const paneLabel = getPaneLabel(content);
  const pickerOpen = pickerState !== null && pickerState.path.join() === path.join();

  const paneWidth = useSharedValue(0);
  const paneHeight = useSharedValue(0);

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      paneWidth.value = e.nativeEvent.layout.width;
      paneHeight.value = e.nativeEvent.layout.height;
    },
    [],
  );

  const headerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(customizeProgress.value, [0.3, 1], [0, 1], "clamp"),
    maxHeight: interpolate(customizeProgress.value, [0, 0.5], [0, 36], "clamp"),
    transform: [{ translateY: interpolate(customizeProgress.value, [0.3, 1], [-12, 0], "clamp") }],
  }));

  const ratioCollapseProgress = useDerivedValue(() => {
    if (!splitCtx) return 0;
    const r = splitCtx.ratio.value;
    const paneRatio = splitCtx.position === "first" ? r : 1 - r;
    const cr = splitCtx.collapsedRatio.value;
    return interpolate(paneRatio, [cr, COLLAPSE_FADE_START], [1, 0], "clamp");
  });

  const sizeCollapseProgress = useDerivedValue(() => {
    const minDim = Math.min(paneWidth.value, paneHeight.value);
    if (minDim <= 0) return 0;
    return interpolate(minDim, [SIZE_COLLAPSED, SIZE_COLLAPSE_FADE], [1, 0], "clamp");
  });

  const collapseProgress = useDerivedValue(() =>
    Math.max(ratioCollapseProgress.value, sizeCollapseProgress.value),
  );

  const isHCollapse = useDerivedValue(() => {
    if (
      sizeCollapseProgress.value > ratioCollapseProgress.value &&
      paneWidth.value > 0 &&
      paneHeight.value > 0
    ) {
      return paneWidth.value < paneHeight.value;
    }
    return splitCtx?.direction === "horizontal";
  });

  const collapsedOverlayStyle = useAnimatedStyle(() => ({
    opacity: collapseProgress.value,
    zIndex: collapseProgress.value > 0 ? Z.COLLAPSED : -1,
  }));

  const contentOpacity = useAnimatedStyle(() => ({
    opacity: 1 - collapseProgress.value,
  }));

  const overlayBorderStyle = useAnimatedStyle(() => ({
    borderLeftWidth: isHCollapse.value ? 1 : 0,
    borderTopWidth: isHCollapse.value ? 0 : 1,
  }));

  const textRotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: isHCollapse.value ? "-90deg" : "0deg" }],
  }));

  const handleExpand = useCallback(() => {
    let ctx: typeof splitCtx = splitCtx;
    while (ctx) {
      const paneRatio = ctx.position === "first" ? ctx.ratio.value : 1 - ctx.ratio.value;
      if (paneRatio < COLLAPSE_FADE_START) {
        ctx.ratio.value = withTiming(ctx.defaultRatio, { duration: 200 });
        onRatioChange(ctx.path, ctx.defaultRatio);
      }
      ctx = ctx.parent;
    }
  }, [splitCtx, onRatioChange]);

  const renderContent = () => {
    if (content.type === "camera") return <CameraPane entityId={content.entityId} />;
    if (content.type === "iframe") return <IframePane url={content.url} />;
    if (content.type === "empty") return null;
    if (content.type === "component") {
      const Content = COMPONENT_REGISTRY[content.componentId];
      if (!Content)
        return (
          <EmptyState
            icon={AlertTriangle}
            title="Unknown widget"
            subtitle={`"${content.componentId}" is not a registered widget`}
          />
        );
      return <Content />;
    }
    return null;
  };

  return (
    <Animated.View style={{ flex: 1, overflow: "hidden" }} onLayout={handleLayout}>
      <Animated.View style={[headerStyle, { zIndex: Z.HEADER }]}>
        <View
          className="border-surface-overlay/10 flex-row items-center justify-between border-b px-2 py-1.5"
          style={{ backgroundColor: t.paneHeaderBg }}
        >
          {isCustomizing ? (
            <Pressable
              onPress={() => openPicker(path, content)}
              aria-label={`Change ${paneLabel} pane content`}
              aria-expanded={pickerOpen}
              hitSlop={8}
              className="hover:bg-glass-hover flex-row items-center gap-1 rounded px-1.5 py-1"
            >
              <Text className="text-11 text-on-surface/70 font-sans">Widget:</Text>
              <Text className="font-sans-medium text-11 text-on-surface/75">{paneLabel}</Text>
              <ChevronDown aria-hidden size={10} strokeWidth={2} color={t.iconSubtle} />
            </Pressable>
          ) : (
            <Text className="text-11 text-on-surface/70 font-sans">{paneLabel}</Text>
          )}
          {isCustomizing && (
            <View className="flex-row gap-0.5">
              <ActionButton
                icon={Columns}
                label="Split into columns"
                onPress={() => onSplit(path, "horizontal")}
              />
              <ActionButton
                icon={Rows}
                label="Split into rows"
                onPress={() => onSplit(path, "vertical")}
              />
              {totalPanes > 1 && (
                <ActionButton
                  icon={ArrowLeftRight}
                  label={swapSourceId === id ? "Cancel swap" : "Swap pane"}
                  onPress={() => onSwapStart(id)}
                />
              )}
              {totalPanes > 1 && (
                <ActionButton icon={X} label="Remove pane" onPress={() => onRemove(path)} />
              )}
            </View>
          )}
        </View>
      </Animated.View>

      <Animated.View style={[{ flex: 1, backgroundColor: t.background }, contentOpacity]}>
        <View className="flex-1">{renderContent()}</View>
      </Animated.View>

      <Animated.View
        style={[
          { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
          collapsedOverlayStyle,
        ]}
      >
        <Pressable
          onPress={handleExpand}
          aria-label={`Expand ${paneLabel} pane`}
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: t.background }}
        >
          <Animated.View
            style={[
              {
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                borderColor: t.borderFaint,
              },
              overlayBorderStyle,
            ]}
            pointerEvents="none"
          />
          <Animated.View style={textRotationStyle}>
            <Text className="font-sans-medium text-10 text-on-surface/70" numberOfLines={1}>
              {paneLabel}
            </Text>
          </Animated.View>
        </Pressable>
      </Animated.View>

      {swapSourceId === id && (
        <Pressable
          onPress={() => onSwapStart(id)}
          aria-label="Selected for swap. Tap to cancel."
          className="absolute inset-0 items-center justify-center border-2 bg-black/45"
          style={{ borderColor: t.customizeSwapBorder, zIndex: Z.SWAP_OVERLAY }}
        >
          <View className="items-center rounded-lg bg-black/80 px-4 py-2.5">
            <ArrowLeftRight size={20} strokeWidth={1.5} color={t.customizeSwapBorder} />
            <Text
              className="font-sans-medium text-11 mt-1"
              style={{ color: t.customizeSwapBorder }}
            >
              Selected
            </Text>
          </View>
        </Pressable>
      )}

      {swapSourceId && swapSourceId !== id && (
        <Pressable
          onPress={() => onSwapTarget(id)}
          aria-label={`Swap with ${paneLabel}`}
          className="absolute inset-0 items-center justify-center border-2 bg-black/35 active:opacity-80"
          style={{
            borderColor: t.customizeAccentSubtle,
            // @ts-ignore web-only — ignored on native, falls back to scrim alone
            backdropFilter: "blur(8px)",
            // @ts-ignore web-only
            WebkitBackdropFilter: "blur(8px)",
            zIndex: Z.SWAP_OVERLAY,
            cursor: "pointer" as never,
          }}
        >
          <View className="items-center rounded-lg bg-black/80 px-4 py-2.5">
            <Replace size={18} strokeWidth={1.5} color={t.customizeSwapBorder} />
            <Text
              className="font-sans-medium text-11 mt-1"
              style={{ color: t.customizeSwapBorder }}
            >
              Swap here
            </Text>
          </View>
        </Pressable>
      )}
    </Animated.View>
  );
}
