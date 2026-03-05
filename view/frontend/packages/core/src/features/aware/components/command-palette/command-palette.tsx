"use no memo";

import {
  currentMode,
  initialPaletteState,
  type PaletteAction,
  type PaletteMode,
  paletteReducer,
  type PaletteState,
} from "@hydris/ui/command-palette/palette-reducer";
import { clearSavedHighlights } from "@hydris/ui/command-palette/use-list-nav";
import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { ArrowLeft, ChevronRight, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
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

import { Z } from "../../constants";
import { buildCommands, type LayoutActions } from "./command-registry";
import { CATEGORIES, getTrailSegments, type TrailSegment } from "./palette-helpers";
import { ConfigView } from "./views/config-view";
import { DimensionView } from "./views/dimension-view";
import { EntityActionsView } from "./views/entity-actions-view";
import { LocationSearchView } from "./views/location-search-view";
import { RootView } from "./views/root-view";

function getSearchPlaceholder(mode: PaletteMode): string | null {
  switch (mode.kind) {
    case "root":
      return "Search entities, commands...";
    case "dimension":
      return `Search ${mode.dimensionLabel}...`;
    case "location-search":
      return "Search address or place...";
    case "config":
      return "Search by id or name...";
    default:
      return null;
  }
}

function TrailBar({
  segments,
  dispatch,
}: {
  segments: TrailSegment[];
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const t = useThemeColors();
  return (
    <View className="h-11 flex-row items-center gap-0.5 px-4 py-2" accessibilityLabel="Breadcrumb">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <View key={seg.index} className="flex-row items-center gap-0.5">
            {i > 0 && <ChevronRight size={10} strokeWidth={2} color={t.iconMuted} />}
            {isLast ? (
              <View className="px-1.5 py-0.5">
                <Text className="font-sans-medium text-foreground/90 text-xs" numberOfLines={1}>
                  {seg.label}
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={() => dispatch({ type: "popTo", index: seg.index })}
                tabIndex={-1}
                className="hover:bg-glass-hover active:bg-glass-active rounded px-1.5 py-0.5"
              >
                <Text className="font-sans-medium text-muted-foreground text-xs" numberOfLines={1}>
                  {seg.label}
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

export function CommandPalette({
  onClose,
  initialMode,
  layoutActions,
}: {
  onClose: () => void;
  initialMode?: PaletteMode;
  layoutActions: LayoutActions;
}) {
  const t = useThemeColors();
  const [state, dispatch] = useReducer(
    paletteReducer,
    initialMode,
    (mode): PaletteState =>
      mode && mode.kind !== "root"
        ? { ...initialPaletteState, stack: [mode], queryStack: [""] }
        : initialPaletteState,
  );
  const inputRef = useRef<TextInput>(null);
  const previousFocusRef = useRef(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement) : null,
  );
  const mode = currentMode(state);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const isCompact = windowWidth < 640;
  const isConfigMode = mode.kind === "config";

  let normalMaxWidth = 560;
  if (isCompact) normalMaxWidth = windowWidth - 16;
  else if (windowWidth >= 1536) normalMaxWidth = 800;
  else if (windowWidth >= 1280) normalMaxWidth = 720;
  const configMaxWidth = Math.min(1600, windowWidth * 0.98);

  const normalMarginTop = isCompact ? 8 : windowHeight * 0.1;
  const configMarginTop = isCompact ? 8 : windowHeight * 0.02;

  const normalMaxHeight = isCompact ? windowHeight * 0.9 : windowHeight * 0.7;
  const configMaxHeight = isCompact ? windowHeight * 0.9 : windowHeight * 0.94;

  const chromeHeight = isCompact ? 94 : 142;
  const contentHeight = Math.min(440, Math.max(200, normalMaxHeight - chromeHeight));
  const normalDialogHeight = contentHeight + chromeHeight;

  const configProgress = useSharedValue(0);
  useEffect(() => {
    configProgress.value = withTiming(isConfigMode ? 1 : 0, { duration: 280 });
  }, [isConfigMode]);

  const dialogAnimatedStyle = useAnimatedStyle(() => {
    const p = configProgress.value;
    return {
      maxWidth: normalMaxWidth + (configMaxWidth - normalMaxWidth) * p,
      marginTop: normalMarginTop + (configMarginTop - normalMarginTop) * p,
      height: normalDialogHeight + (configMaxHeight - normalDialogHeight) * p,
    };
  });

  const commands = useMemo(() => buildCommands(layoutActions), [layoutActions]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (isCompact || isConfigMode) {
      inputRef.current?.blur();
      return () => {
        previousFocusRef.current?.focus();
      };
    }
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => {
      clearTimeout(t);
      previousFocusRef.current?.focus();
    };
  }, [isCompact, isConfigMode]);

  const handleClose = useCallback(() => {
    clearSavedHighlights();
    dispatch({ type: "reset" });
    onClose();
  }, [onClose]);

  useKeyboardShortcut(
    "Escape",
    useCallback(() => {
      if (state.query) {
        dispatch({ type: "setQuery", query: "" });
      } else if (state.stack.length > 0) {
        dispatch({ type: "pop" });
      } else {
        handleClose();
      }
      return true;
    }, [state.query, state.stack.length, handleClose]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "Backspace",
    useCallback(() => {
      if (!state.query && state.stack.length > 0) {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return false;
        dispatch({ type: "pop" });
        return true;
      }
      return false;
    }, [state.query, state.stack.length]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "Tab",
    useCallback(() => {
      if (mode.kind === "root") {
        const ids = CATEGORIES.map((c) => c.id);
        const idx = ids.indexOf(state.activeCategory);
        const next = (idx + 1) % ids.length;
        dispatch({ type: "setCategory", category: ids[next]! });
        inputRef.current?.focus();
        return true;
      }
      return false;
    }, [mode.kind, state.activeCategory]),
    { priority: 200 },
  );

  const searchPlaceholder = getSearchPlaceholder(mode);
  const hasSearchInput = searchPlaceholder !== null;
  const isSearching = mode.kind === "root" && state.query.trim().length > 0;
  const trailSegments = getTrailSegments(
    state.stack,
    state.activeCategory,
    (state.queryStack[0]?.trim().length ?? 0) > 0,
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!hasSearchInput || isCompact || isConfigMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hasSearchInput, isCompact, isConfigMode]);

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
        role="dialog"
        aria-label="Command palette"
        aria-modal={true}
        style={[
          {
            alignSelf: "center",
            width: "100%",
            borderRadius: 10,
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.borderSubtle,
            borderTopColor: t.borderMedium,
            borderBottomColor: t.borderFaint,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 24 },
            shadowOpacity: 0.7,
            shadowRadius: 48,
            overflow: "hidden",
          },
          dialogAnimatedStyle,
        ]}
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
                      accessibilityState={{ selected: isActive }}
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
            <TrailBar segments={trailSegments} dispatch={dispatch} />
            <View className="bg-surface-overlay/6 h-px" />
          </>
        )}

        <View style={isConfigMode ? { flex: 1 } : { height: contentHeight }}>
          {mode.kind === "root" && (
            <RootView
              query={state.query}
              activeCategory={state.activeCategory}
              commands={commands}
              dispatch={dispatch}
              onClose={handleClose}
            />
          )}
          {mode.kind === "dimension" && (
            <DimensionView
              dimension={mode.dimension}
              category={mode.category}
              query={state.query}
              onClose={handleClose}
            />
          )}
          {mode.kind === "entity-actions" && (
            <EntityActionsView entityId={mode.entityId} onClose={handleClose} dispatch={dispatch} />
          )}
          {mode.kind === "location-search" && (
            <LocationSearchView query={state.query} onClose={handleClose} />
          )}
          {mode.kind === "config" && <ConfigView entityId={mode.entityId} query={state.query} />}
        </View>

        {Platform.OS === "web" && !isCompact && (
          <View
            style={{ marginTop: "auto" }}
            className="bg-surface-overlay/8 flex-row items-center justify-end px-4 py-3"
          >
            <View className="flex-row items-center gap-3">
              <FooterHint label="navigate" shortcut={"\u2191\u2193"} />
              {mode.kind === "root" && <FooterHint label="select" shortcut={"\u21b5"} />}
              {mode.kind === "root" && <FooterHint label="category" shortcut="Tab" />}
              {mode.kind === "dimension" && <FooterHint label="select" shortcut={"\u21b5"} />}
              {mode.kind === "entity-actions" && <FooterHint label="run" shortcut={"\u21b5"} />}
              {mode.kind === "location-search" && <FooterHint label="go to" shortcut={"\u21b5"} />}
              {mode.kind === "config" && <FooterHint label="select" shortcut={"\u21b5"} />}
              {state.stack.length > 0 && <FooterHint label="back" shortcut="Esc" />}
            </View>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
}
