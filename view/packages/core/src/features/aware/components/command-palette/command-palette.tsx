"use no memo";

import { canDockListDetail } from "@hydris/ui/command-palette/list-detail-drawer";
import {
  currentMode,
  initialPaletteState,
  type PaletteAction,
  paletteReducer,
  type PaletteState,
  paletteStateAt,
} from "@hydris/ui/command-palette/palette-reducer";
import { clearSavedHighlights } from "@hydris/ui/command-palette/use-list-nav";
import { useNativeModalBox, usePhoneModalFrame } from "@hydris/ui/hooks/use-phone-modal-frame";
import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { KeyboardLayer } from "@hydris/ui/keyboard/keyboard-layer";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { ArrowLeft, ChevronRight, PanelLeft, Search, Settings, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { toast } from "../../../../lib/sonner";
import { useFilePicker } from "../../../../lib/use-file-picker";
import { awaitsSetup } from "../../../mission/sources";
import { uploadMbtiles } from "../../../mission-pack/upload-mbtiles";
import { useMissionPack } from "../../../mission-pack/use-mission-pack";
import { Z } from "../../constants";
import { useEntityStore } from "../../store/entity-store";
import { useVersionLabel } from "../../store/version-store";
import { BarIconButton } from "./bar-icon-button";
import { buildCommands, type LayoutActions } from "./command-registry";
import { CATEGORIES } from "./palette-helpers";
import { getScreen, getTrailSegments, type TrailSegment } from "./palette-screens";
import { onNextFrame, STACK_SCALE, StackedWindow } from "./stacked-window";

const STACK_PEEK = 12;

const STACK_DIM = 0.5;

function SegmentLabel({ label, liveLabel }: TrailSegment) {
  return useEntityStore((s) => liveLabel?.(s)) ?? label;
}

function TrailBar({
  segments,
  dispatch,
  leading,
}: {
  segments: TrailSegment[];
  dispatch: React.Dispatch<PaletteAction>;
  leading?: React.ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View className="h-11 flex-row items-center gap-0.5 px-4 py-2" accessibilityLabel="Breadcrumb">
      {leading}
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <View
            key={seg.index}
            className={cn(
              "min-w-0 flex-row items-center gap-0.5",
              isLast ? "flex-1" : "max-w-[40%] shrink",
            )}
          >
            {i > 0 && (
              <View className="shrink-0">
                <ChevronRight size={10} strokeWidth={2} color={t.iconMuted} />
              </View>
            )}
            {isLast ? (
              <View className="min-w-0 shrink px-1.5 py-0.5">
                <Text className="font-sans-medium text-foreground/90 text-xs" numberOfLines={1}>
                  <SegmentLabel {...seg} />
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={() => dispatch({ type: "popTo", index: seg.index })}
                tabIndex={-1}
                className="hover:bg-glass-hover active:bg-glass-active min-w-0 shrink rounded px-1.5 py-0.5"
              >
                <Text className="font-sans-medium text-muted-foreground text-xs" numberOfLines={1}>
                  <SegmentLabel {...seg} />
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function FooterHint({ label, shortcut }: { label: string; shortcut: string }) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center gap-1.5">
      <Text className="font-mono text-xs leading-none" style={{ color: t.iconDefault }}>
        {label}
      </Text>
      <View className="bg-surface-overlay/10 h-5 items-center justify-center rounded px-1.5">
        <Text className="font-mono text-xs leading-none" style={{ color: t.iconStrong }}>
          {shortcut}
        </Text>
      </View>
    </View>
  );
}

function VersionFooter() {
  const label = useVersionLabel();
  if (!label) return <View />;
  return <Text className="text-muted-foreground font-mono text-[10px] leading-none">{label}</Text>;
}

export function CommandPalette({
  onClose,
  onReopen,
  initialState = initialPaletteState,
  layoutActions,
}: {
  onClose: () => void;
  onReopen: (state: PaletteState) => void;
  initialState?: PaletteState;
  layoutActions: LayoutActions;
}) {
  const t = useThemeColors();
  const [paletteState, dispatch] = useReducer(paletteReducer, initialState);
  const stateRef = useRef(paletteState);
  stateRef.current = paletteState;
  const inputRef = useRef<TextInput>(null);
  const behindRef = useRef<View>(null);
  const previousFocusRef = useRef(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement) : null,
  );

  const top = currentMode(paletteState);
  const stacked = getScreen(top).layout === "wizard" ? top : undefined;
  const state = stacked ? paletteReducer(paletteState, { type: "pop" }) : paletteState;
  const mode = currentMode(state);
  const screen = getScreen(mode);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const isNative = Platform.OS !== "web";
  const phoneFrame = usePhoneModalFrame();
  const nativeBox = useNativeModalBox();
  const isCompact = phoneFrame !== undefined || windowWidth < 640;
  // dock decision keys off the modal's content width, not the raw window width.
  const configMaxWidth = Math.min(1600, windowWidth * 0.98);
  const isWide = canDockListDetail(configMaxWidth);
  const configEntityId = mode.kind === "config" ? mode.entityId : undefined;
  const isListDetailMode = screen.layout === "list-detail";

  const [treeOpen, setTreeOpen] = useState(() => isWide || !configEntityId);

  useEffect(() => {
    if (isListDetailMode) setTreeOpen(isWide || !configEntityId);
  }, [isListDetailMode, configEntityId, isWide]);

  const showFooter = Platform.OS === "web" && !isCompact;
  const chromeHeight = showFooter ? 142 : 94;

  let normalMaxWidth = 560;
  let normalDialogHeight: number;
  let normalMarginTop = windowHeight * 0.1;

  if (phoneFrame) {
    normalMaxWidth = phoneFrame.width;
    normalDialogHeight = phoneFrame.height;
    normalMarginTop = phoneFrame.edge;
  } else if (isNative) {
    normalMaxWidth = nativeBox.width;
    normalDialogHeight = nativeBox.height;
    normalMarginTop = (windowHeight - nativeBox.height) / 2;
  } else if (isCompact) {
    normalMaxWidth = windowWidth - 16;
    normalDialogHeight = windowHeight - 16;
    normalMarginTop = 8;
  } else {
    if (windowWidth >= 1536) normalMaxWidth = 800;
    else if (windowWidth >= 1280) normalMaxWidth = 720;

    normalDialogHeight =
      Math.min(440, Math.max(200, windowHeight * 0.7 - chromeHeight)) + chromeHeight;
  }

  const contentHeight = normalDialogHeight - chromeHeight;
  const configMarginTop = isCompact ? 8 : windowHeight * 0.02;
  const configMaxHeight = isCompact ? windowHeight - 16 : windowHeight * 0.94;

  const configProgress = useSharedValue(0);
  useEffect(
    () =>
      onNextFrame(() => {
        configProgress.value = withTiming(isListDetailMode ? 1 : 0, { duration: 280 });
      }),
    [isListDetailMode],
  );

  const dialogAnimatedStyle = useAnimatedStyle(() => {
    const p = configProgress.value;
    return {
      maxWidth: normalMaxWidth + (configMaxWidth - normalMaxWidth) * p,
      marginTop: normalMarginTop + (configMarginTop - normalMarginTop) * p,
      height: normalDialogHeight + (configMaxHeight - normalDialogHeight) * p,
    };
  });

  const stackProgress = useSharedValue(0);

  const recedeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -STACK_PEEK * stackProgress.get() },
      { scale: 1 - (1 - STACK_SCALE) * stackProgress.get() },
    ],
  }));

  const dimStyle = useAnimatedStyle(() => ({ opacity: STACK_DIM * stackProgress.get() }));

  const missionPack = useMissionPack();
  const pickFile = useFilePicker();

  const missionPackActions = useMemo(
    () => ({
      importFromPicker: async () => {
        const origin = stateRef.current;

        try {
          const file = await pickFile({
            accept: ".zip,application/zip",
          });

          if (!file) {
            onReopen(origin);
          } else if (await missionPack.importPack(file)) {
            onReopen(paletteStateAt({ kind: "mission-health" }));
          }
        } catch (err) {
          console.error("[mission-pack] file picker failed", err);
          toast.error("Could not open files");
        }
      },
      importMbtilesFromPicker: async () => {
        const origin = stateRef.current;

        try {
          const file = await pickFile({ accept: ".mbtiles" });

          if (file) await uploadMbtiles(file);
          else onReopen(origin);
        } catch (err) {
          console.error("[mbtiles] file picker failed", err);
          toast.error("Could not open files");
        }
      },
    }),
    [missionPack, pickFile, onReopen],
  );

  const commands = useMemo(
    () => buildCommands(layoutActions, missionPackActions),
    [layoutActions, missionPackActions],
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (isCompact || isListDetailMode) {
      previousFocusRef.current?.blur();
      inputRef.current?.blur();
      return () => {
        previousFocusRef.current?.focus();
      };
    }

    // the macOS webview ignores focus() on a palette reopened after a cancelled
    // file picker. the list ignores Enter while a control behind it has focus.
    previousFocusRef.current?.blur();
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => {
      clearTimeout(t);
      previousFocusRef.current?.focus();
    };
  }, [isCompact, isListDetailMode]);

  const handleClose = useCallback(() => {
    clearSavedHighlights();
    dispatch({ type: "reset" });
    onClose();
  }, [onClose]);

  useKeyboardShortcut(
    "Escape",
    useCallback(() => {
      if (paletteState.query) {
        dispatch({ type: "setQuery", query: "" });
      } else if (paletteState.stack.length > 0) {
        dispatch({ type: "pop" });
      } else {
        handleClose();
      }
      return true;
    }, [paletteState.query, paletteState.stack.length, handleClose]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "Backspace",
    useCallback(() => {
      if (!paletteState.query && paletteState.stack.length > 0) {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return false;
        dispatch({ type: "pop" });
        return true;
      }
      return false;
    }, [paletteState.query, paletteState.stack.length]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "Tab",
    useCallback(() => {
      if (top.kind === "root") {
        const ids = CATEGORIES.map((c) => c.id);
        const idx = ids.indexOf(state.activeCategory);
        const next = (idx + 1) % ids.length;
        dispatch({ type: "setCategory", category: ids[next]! });
        inputRef.current?.focus();
        return true;
      }
      return false;
    }, [top.kind, state.activeCategory]),
    { priority: 200 },
  );

  const searchPlaceholder = screen.search;
  const hasSearchInput = searchPlaceholder !== null;
  const isSearching = mode.kind === "root" && state.query.trim().length > 0;

  const isTileLevel =
    screen.keys === "grid" ||
    (mode.kind === "root" && !isSearching && state.activeCategory === "mission");

  const offersCameraSetup = useEntityStore((s) => {
    const camera = mode.kind === "camera" ? s.entities.get(mode.entityId) : undefined;

    return !!camera && awaitsSetup(camera);
  });

  const hasNoKeys = screen.keys === "none" || (mode.kind === "camera" && !offersCameraSetup);
  const enterHint = screen.enter ?? (offersCameraSetup ? "select" : undefined);
  const trailSegments = getTrailSegments(
    state.stack,
    state.activeCategory,
    (state.queryStack[0]?.trim().length ?? 0) > 0,
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;

    if (!hasSearchInput || stacked || isCompact || isListDetailMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hasSearchInput, stacked, isCompact, isListDetailMode]);

  const screenProps = {
    state,
    dispatch,
    commands,
    onClose: handleClose,
    isWide,
    treeOpen,
    onTreeOpenChange: setTreeOpen,
  };

  const dialogStyle = [
    {
      alignSelf: "center",
      width: "100%",
      borderRadius: 10,
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.borderSubtle,
      borderTopColor: t.borderMedium,
      borderBottomColor: t.borderFaint,
      boxShadow: "0 24px 48px rgba(0,0,0,0.7)",
      overflow: "hidden",
    } as const,
    dialogAnimatedStyle,
  ];

  return (
    <Animated.View
      entering={FadeIn.duration(120).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(80).reduceMotion(ReduceMotion.System)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: Z.PALETTE,
      }}
    >
      <Pressable
        onPress={handleClose}
        aria-label="Close command palette"
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
        ref={behindRef}
        role="dialog"
        aria-label="Command palette"
        aria-modal={true}
        aria-hidden={!!stacked}
        pointerEvents={stacked ? "none" : "auto"}
        style={[dialogStyle, { transformOrigin: "top" }, recedeStyle]}
      >
        <View className="h-12 flex-row items-center gap-2.5 px-4">
          {state.stack.length > 0 ? (
            <Pressable
              onPress={() => dispatch({ type: "pop" })}
              aria-label="Go back"
              tabIndex={-1}
              hitSlop={8}
              className="bg-surface-overlay/10 hover:bg-glass-hover rounded p-0.5"
            >
              <ArrowLeft size={18} strokeWidth={2} color={t.foreground} />
            </Pressable>
          ) : (
            <View className="p-0.5">
              <Search size={18} strokeWidth={2} color={t.iconMuted} />
            </View>
          )}

          {hasSearchInput ? (
            <TextInput
              ref={inputRef}
              testID="palette-search"
              accessibilityLabel="Search"
              value={state.query}
              onChangeText={(q) => dispatch({ type: "setQuery", query: q })}
              placeholder={searchPlaceholder}
              placeholderTextColor={t.placeholder}
              className="text-foreground flex-1 font-sans text-sm"
              // @ts-expect-error outlineStyle is a React Native Web prop
              style={{ outlineStyle: "none" }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : (
            <View className="flex-1" />
          )}
          {state.query.length > 0 && (
            <Pressable
              onPress={() => dispatch({ type: "setQuery", query: "" })}
              aria-label="Clear search"
              tabIndex={-1}
              hitSlop={8}
              className="p-1"
            >
              <X size={14} strokeWidth={2} color={t.iconMuted} />
            </Pressable>
          )}
          <BarIconButton
            icon={Settings}
            size={18}
            label="Configuration"
            disabled={mode.kind === "config"}
            onPress={() => dispatch({ type: "push", mode: { kind: "config" } })}
          />
        </View>
        <View className="bg-surface-overlay/10 h-px" />

        {state.stack.length === 0 ? (
          <>
            <View className="h-11">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityRole="tablist"
                className="flex-1 py-2"
                contentContainerClassName="flex-row items-center gap-1 px-4"
              >
                {CATEGORIES.map(({ id, label, icon: Icon }) => {
                  const isActive = !isSearching && state.activeCategory === id;

                  return (
                    <Pressable
                      key={id}
                      onPress={() => {
                        if (isSearching) dispatch({ type: "setQuery", query: "" });
                        dispatch({ type: "setCategory", category: id });
                      }}
                      accessibilityRole="tab"
                      aria-selected={isActive}
                      tabIndex={-1}
                      className={cn(
                        "flex-row items-center gap-1.5 rounded-full px-2.5 py-1.5",
                        isActive
                          ? "bg-surface-overlay/10"
                          : "hover:bg-surface-overlay/5 bg-transparent",
                      )}
                    >
                      <Icon
                        size={14}
                        strokeWidth={2}
                        color={isActive ? t.controlFgActive : t.iconMuted}
                      />
                      <Text
                        className={cn(
                          "font-sans-medium text-xs",
                          isActive ? "text-foreground/90" : "text-muted-foreground",
                        )}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <View className="bg-surface-overlay/6 h-px" />
          </>
        ) : (
          <>
            <TrailBar
              segments={trailSegments}
              dispatch={dispatch}
              leading={
                isListDetailMode ? (
                  <Pressable
                    onPress={() => setTreeOpen((v) => !v)}
                    accessibilityLabel={`${treeOpen ? "Hide" : "Show"} device list`}
                    tabIndex={-1}
                    hitSlop={8}
                    className="bg-surface-overlay/10 hover:bg-glass-hover mr-1.5 rounded p-0.5"
                  >
                    <PanelLeft size={18} strokeWidth={2} color={t.foreground} />
                  </Pressable>
                ) : undefined
              }
            />
            <View className="bg-surface-overlay/6 h-px" />
          </>
        )}

        <View style={isListDetailMode ? { flex: 1 } : { height: contentHeight }}>
          <KeyboardLayer>{screen.render(screenProps)}</KeyboardLayer>
        </View>

        {showFooter && (
          <View
            style={{ marginTop: "auto" }}
            className="bg-surface-overlay/8 flex-row items-center justify-between px-4 py-3"
          >
            <VersionFooter />
            <View className="flex-row items-center gap-3">
              {!hasNoKeys && (
                <FooterHint
                  label="navigate"
                  shortcut={isTileLevel ? "\u2191\u2193\u2190\u2192" : "\u2191\u2193"}
                />
              )}
              {enterHint && <FooterHint label={enterHint} shortcut={"\u21b5"} />}
              {mode.kind === "root" && <FooterHint label="category" shortcut="Tab" />}
              {state.stack.length > 0 && <FooterHint label="back" shortcut="Esc" />}
            </View>
          </View>
        )}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: t.backdrop }, dimStyle]}
        />
      </Animated.View>

      <StackedWindow
        mode={stacked}
        behindRef={behindRef}
        progress={stackProgress}
        style={dialogStyle}
        screenProps={{ ...screenProps, state: paletteState }}
      />
    </Animated.View>
  );
}
