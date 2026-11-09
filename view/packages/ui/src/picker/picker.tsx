import { ChevronsUpDown, Lock, X } from "lucide-react-native";
import type { ComponentProps, ReactNode } from "react";
import {
  Children,
  createContext,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { Pressable, View } from "react-native";

import { ROW_FRAME, ROW_SIZE, ROW_TEXT_INSET, ROW_TEXT_STYLES } from "../control-row";
import { FieldTextContext } from "../field";
import { HoldHint, HoldLabel } from "../hold-label";
import { holdToConfirmEnabled } from "../hooks/hold-to-confirm-flag";
import { useConfirmPress } from "../hooks/use-confirm-press";
import { ItemIndexContext, type RovingItem, useRovingFocus } from "../hooks/use-roving-focus";
import { useKeyboardShortcut } from "../keyboard/use-keyboard-shortcut";
import { useOnGreenColor, useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";
import { Progress, ProgressIndicator, ProgressTrack } from "../progress";
import { RefusePressCatcher } from "../refuse-press-catcher";
import { MotionItem, MotionRoot, type MotionRootProps, OPENS_IN_MODAL } from "./picker-motion";

const CONFIRMED_SHOWN_MS = 600;
export const LANDED_SHOWN_MS = 3000;

// Above the lists and views around it. Its handlers take a key only while a row has focus and the
// picker is open, and leave it to the container otherwise.
const KEY_PRIORITY = 300;

type Disclosure = { kind: "folded" } | { kind: "open" } | { kind: "confirming"; row: string };

type DisclosureEvent =
  | { type: "reveal" }
  | { type: "beginConfirm"; row: string }
  | { type: "endConfirm" }
  | { type: "close" };

function disclose(state: Disclosure, event: DisclosureEvent): Disclosure {
  switch (event.type) {
    case "reveal":
      return state.kind === "folded" ? { kind: "open" } : state;
    case "beginConfirm":
      return { kind: "confirming", row: event.row };
    case "endConfirm":
      return state.kind === "confirming" ? { kind: "open" } : state;
    case "close":
      return state.kind === "folded" ? state : { kind: "folded" };
  }
}

function confirmingRow(
  state: Disclosure,
  value: string | undefined,
  pendingValue: string | undefined,
) {
  if (state.kind !== "confirming" || pendingValue !== undefined || state.row === value)
    return undefined;

  return state.row;
}

type PickerContextValue = {
  value: string | undefined;
  pendingValue: string | undefined;
  canCancel: boolean;
  invalidValue: string | undefined;
  confirming: string | undefined;
  anchor: string | undefined;
  target: string | undefined;
  expanded: boolean;
  collapsible: boolean;
  disabled: boolean;
  shakes: Record<string, number>;
  refuse: (value: string) => void;
  holdIn: (value: string) => void;
  holdOut: () => void;
  release: (value: string) => void;
  focus: (value: string) => void;
  blur: (value: string) => void;
  registerItem: (value: string, item: RovingItem) => () => void;
  reportLock: (copy: string, value: string, locked: boolean | undefined) => void;
};

const PickerContext = createContext<PickerContextValue | null>(null);

function usePicker() {
  const context = use(PickerContext);

  if (!context) throw new Error("PickerItem must be rendered inside a Picker");

  return context;
}

// React Native has no fieldset or legend, so the picker carries its own accessible label
export function Picker({
  value,
  pendingValue,
  invalidValue,
  onValueChange,
  onCancel,
  onRefusedChange,
  onDismissInvalid,
  disabled = false,
  accessibilityLabel,
  className,
  children,
}: {
  value?: string;
  pendingValue?: string;
  invalidValue?: string;
  onValueChange: (value: string) => void;
  // Left out, the pending row shows no cancel mark and ignores taps
  onCancel?: (value: string) => void;
  onRefusedChange: (value: string | undefined) => void;
  onDismissInvalid: (value: string) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const [disclosure, dispatch] = useReducer(disclose, { kind: "folded" });
  const [shakes, setShakes] = useState<Record<string, number>>({});
  const [focused, setFocused] = useState<string>();
  const [landings, setLandings] = useState(0);
  const [clearings, setClearings] = useState(0);
  const [lastPending, setLastPending] = useState(pendingValue);
  const [lastInvalid, setLastInvalid] = useState(invalidValue);
  // Keyed by item copy, not by row: a row can render twice, and one copy unmounting keeps the other's
  const [locks, setLocks] = useState<Record<string, { row: string; locked: boolean }>>({});
  // A press that clears a refusal still acts on its own row, so clearing the refusal never folds
  const [refused, setRefused] = useState<string>();
  const roving = useRovingFocus();

  const reportLock = useCallback((copy: string, row: string, locked: boolean | undefined) => {
    setLocks((prev) => {
      if (prev[copy]?.row === row && prev[copy]?.locked === locked) return prev;

      const next = { ...prev };

      if (locked === undefined) delete next[copy];
      else next[copy] = { row, locked };

      return next;
    });
  }, []);

  const tapped = confirmingRow(disclosure, value, pendingValue);

  if (disclosure.kind === "confirming" && tapped === undefined) dispatch({ type: "endConfirm" });

  if (pendingValue !== lastPending) {
    setLastPending(pendingValue);

    if (pendingValue === undefined && lastPending === value) setLandings((count) => count + 1);
  }

  if (invalidValue !== lastInvalid) {
    setLastInvalid(invalidValue);

    if (invalidValue === undefined && lastInvalid !== refused) setClearings((count) => count + 1);

    if (invalidValue !== refused) setRefused(undefined);
  }

  const collapsible = value !== undefined;
  const expanded = !collapsible || disclosure.kind !== "folded";
  // With nothing else to pick, a failed switch cannot be retried, so the current option leads,
  // e.g. one the device entered on its own while everything else is locked
  const stuck =
    disabled || Object.values(locks).every(({ row, locked }) => row === value || locked);
  // Folded, the picker shows the row it is busy with: a switch, then a failure, then the current one
  const anchor = pendingValue ?? (stuck ? value : (invalidValue ?? value));

  const switchTo = (row: string) => {
    dispatch({ type: "endConfirm" });
    onValueChange(row);
    dispatch({ type: "close" });

    if (focused !== undefined) roving.focusItem(row);
  };

  const confirm = useConfirmPress({
    tapped,
    focused,
    canConfirm: (row) =>
      expanded &&
      pendingValue === undefined &&
      row !== value &&
      (tapped !== undefined || row !== invalidValue),
    onConfirm: (row) => switchTo(row),
    onLapse: () => dispatch({ type: "endConfirm" }),
    confirmedMs: CONFIRMED_SHOWN_MS,
  });

  const { confirming, holding } = confirm;
  const target = confirming ?? anchor;
  const foldable = collapsible && expanded && pendingValue === undefined;

  const foldAfterOutcome = useEffectEvent(() => {
    if (confirming !== undefined || pendingValue !== undefined || invalidValue !== undefined)
      return;

    dispatch({ type: "close" });
  });

  useEffect(() => {
    if (clearings > 0 && !OPENS_IN_MODAL) foldAfterOutcome();
  }, [clearings]);

  useEffect(() => {
    if (landings === 0) return;

    const timer = setTimeout(foldAfterOutcome, LANDED_SHOWN_MS);

    return () => clearTimeout(timer);
  }, [landings]);

  const shake = (row: string) => setShakes((prev) => ({ ...prev, [row]: (prev[row] ?? 0) + 1 }));

  const close = () => {
    confirm.stopHold();
    onRefusedChange(undefined);
    dispatch({ type: "close" });

    if (focused !== undefined && value !== undefined) roving.focusItem(value);
  };

  const closeInlineOrEndConfirm = () =>
    OPENS_IN_MODAL ? dispatch({ type: "endConfirm" }) : close();

  const escape = () => {
    if (!foldable) return false;

    close();

    return true;
  };

  const pressOutside = () => close();

  const moveFocus = (step: number) => {
    if (focused === undefined || !expanded) return false;

    roving.moveFocus(focused, step, false);

    return true;
  };

  useKeyboardShortcut("Escape", () => focused !== undefined && escape(), {
    priority: KEY_PRIORITY,
  });

  useKeyboardShortcut("ArrowDown", () => moveFocus(1), { priority: KEY_PRIORITY });
  useKeyboardShortcut("ArrowUp", () => moveFocus(-1), { priority: KEY_PRIORITY });

  const press = (row: string) => {
    if (pendingValue !== undefined) {
      if (row === pendingValue) onCancel?.(row);
      else shake(row);

      return;
    }

    if (confirming === undefined && row === invalidValue) {
      onDismissInvalid(row);
      closeInlineOrEndConfirm();

      return;
    }

    if (!expanded) {
      // Opening cancels the fold that a landed switch scheduled
      setLandings(0);
      dispatch({ type: "reveal" });

      return;
    }

    if (row === value) {
      if (OPENS_IN_MODAL && confirming !== undefined) dispatch({ type: "endConfirm" });
      else close();

      return;
    }

    if (holdToConfirmEnabled()) dispatch({ type: "beginConfirm", row });
    else switchTo(row);
  };

  const release = (row: string) => {
    if (confirm.releasedAsTap()) press(row);
  };

  const refuse = (row: string) => {
    if (disabled || pendingValue !== undefined) {
      shake(row);

      return;
    }

    if (row === invalidValue) {
      onDismissInvalid(row);
      closeInlineOrEndConfirm();

      return;
    }

    confirm.stopHold();
    dispatch({ type: "endConfirm" });
    shake(row);
    setRefused(row);
    onRefusedChange(row);
  };

  const holdIn = (row: string) => {
    onRefusedChange(undefined);
    confirm.pressIn(row);
  };

  const context: PickerContextValue = {
    value,
    pendingValue,
    canCancel: onCancel !== undefined,
    invalidValue,
    confirming,
    anchor,
    target,
    expanded,
    collapsible,
    disabled,
    shakes,
    refuse,
    release,
    holdIn,
    holdOut: confirm.pressOut,
    focus: setFocused,
    blur: (row) => setFocused((current) => (current === row ? undefined : current)),
    registerItem: roving.registerItem,
    reportLock,
  };

  const highlight = useMemo((): MotionRootProps["highlight"] => {
    if (confirming !== undefined) {
      const cover = <HoldLabel aria-hidden progress={confirm.progress} holding={holding} />;

      return { value: confirming, look: "confirming", cover };
    }

    return pendingValue === undefined ? undefined : { value: pendingValue, look: "pending" };
  }, [confirming, pendingValue, confirm.progress, holding]);

  return (
    <PickerContext value={context}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={accessibilityLabel}
        className={className}
      >
        <MotionRoot
          className={cn(
            "border-border bg-card overflow-hidden rounded-2xl",
            ROW_FRAME,
            !collapsible && "border-dashed",
          )}
          current={collapsible ? anchor : undefined}
          expanded={expanded}
          highlight={highlight}
          onPressOutside={foldable ? pressOutside : undefined}
          onEscape={escape}
        >
          {Children.map(children, (child, index) => (
            <ItemIndexContext value={index}>{child}</ItemIndexContext>
          ))}
        </MotionRoot>
      </View>
    </PickerContext>
  );
}

type ItemTone = "plain" | "current" | "danger";

function itemTextLook(filled: boolean, locked: boolean): keyof typeof ROW_TEXT_STYLES {
  if (filled) return "onGreen";

  return locked ? "locked" : "plain";
}

function itemTone(invalid: boolean, filled: boolean): ItemTone {
  if (invalid) return "danger";

  return filled ? "current" : "plain";
}

type PickerItemContextValue = {
  tone: ItemTone;
  locked: boolean;
  foldable: boolean;
  filled: boolean;
  cancellable: boolean;
};

const PickerItemContext = createContext<PickerItemContextValue | null>(null);

function usePickerItem() {
  const context = use(PickerItemContext);

  if (!context) throw new Error("This part must be rendered inside a PickerItem");

  return context;
}

// React Native has no aria-invalid styling, so the item draws the invalid state itself
export function PickerItem({
  value,
  disabled = false,
  className,
  children,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const picker = usePicker();
  const index = use(ItemIndexContext);
  const current = picker.value === value;
  const confirming = picker.confirming === value;
  const invalid = picker.invalidValue === value;
  const locked = disabled && !current;
  const pressBlocked = picker.disabled || locked;
  const filled = current && picker.confirming === undefined;
  const anchored = picker.anchor === value;
  const shown = picker.expanded || anchored;
  const foldable = current && picker.collapsible;
  const cancellable = picker.pendingValue === value && picker.canCancel;
  const textLook = itemTextLook(filled, locked && !invalid);
  const tone = itemTone(invalid, filled);
  const { registerItem, reportLock } = picker;
  const copy = useId();

  useLayoutEffect(() => {
    reportLock(copy, value, locked);

    return () => reportLock(copy, value, undefined);
  }, [reportLock, copy, value, locked]);

  const tabStop =
    shown && !pressBlocked && (picker.target === undefined || picker.target === value);

  const item = useMemo(
    () => ({ tone, locked, foldable, filled, cancellable }),
    [tone, locked, foldable, filled, cancellable],
  );

  const ref = useCallback(
    (node: View | null) => {
      if (!node) return;

      return registerItem(value, { index, disabled: pressBlocked, node });
    },
    [registerItem, value, index, pressBlocked],
  );

  return (
    <MotionItem value={value} index={index} current={anchored} shakes={picker.shakes[value] ?? 0}>
      <Pressable
        ref={ref}
        disabled={pressBlocked}
        accessibilityRole="radio"
        aria-checked={current}
        aria-hidden={!shown}
        tabIndex={tabStop ? 0 : -1}
        onFocus={() => picker.focus(value)}
        onBlur={() => picker.blur(value)}
        onPressIn={() => picker.holdIn(value)}
        onPressOut={picker.holdOut}
        onPress={() => picker.release(value)}
        className={cn(
          "web:focus-visible:ring-2 web:focus-visible:ring-inset web:focus-visible:ring-foreground/30 overflow-hidden rounded-[11px] outline-none select-none",
          pressBlocked ? "cursor-default" : "cursor-pointer",
          filled && "bg-active-green",
          invalid && "bg-red-foreground/10",
          picker.expanded &&
            !filled &&
            !confirming &&
            !invalid &&
            !pressBlocked &&
            picker.pendingValue !== value &&
            "hover:bg-foreground/5",
          className,
        )}
      >
        <PickerItemContext value={item}>
          <FieldTextContext value={ROW_TEXT_STYLES[textLook]}>
            <View
              className={cn(
                "transition-opacity duration-150",
                confirming && "opacity-0 duration-0",
              )}
            >
              {children}
            </View>
          </FieldTextContext>
        </PickerItemContext>
        {confirming && <HoldHint />}
        {pressBlocked && <RefusePressCatcher onRefuse={() => picker.refuse(value)} />}
      </Pressable>
    </MotionItem>
  );
}

export function PickerItemContent({ className, children, ...props }: ComponentProps<typeof View>) {
  const t = useThemeColors();
  const onGreen = useOnGreenColor();
  const { foldable, filled, tone, cancellable } = usePickerItem();
  const dismissible = tone === "danger" && !foldable;
  const marked = foldable || dismissible || cancellable;

  return (
    <View className="flex-row" {...props}>
      <View
        className={cn(
          "min-w-0 flex-1 flex-row items-center",
          ROW_SIZE,
          ROW_TEXT_INSET,
          marked ? "pr-2" : "pr-4",
          className,
        )}
      >
        {children}
      </View>
      {foldable && (
        <View className="w-14 items-center justify-center">
          <ChevronsUpDown size={18} strokeWidth={2} color={filled ? onGreen : t.iconMuted} />
        </View>
      )}
      {(dismissible || cancellable) && (
        <View aria-hidden className="w-14 items-center justify-center">
          <X size={18} strokeWidth={2} color={dismissible ? t.redForeground : t.iconMuted} />
        </View>
      )}
    </View>
  );
}

export function PickerItemLock({ className }: { className?: string }) {
  const t = useThemeColors();
  const { tone, locked } = usePickerItem();

  if (!locked) return null;

  return (
    <View aria-hidden className={className}>
      <Lock size={13} strokeWidth={2} color={tone === "danger" ? t.redForeground : t.iconMuted} />
    </View>
  );
}

const ITEM_BAR = "absolute inset-x-0 bottom-0 h-0.5";

const PROGRESS_STYLES: Record<ItemTone, string> = {
  plain: "bg-active-green",
  current: "bg-foreground dark:bg-control-input",
  danger: "bg-red-foreground",
};

export function PickerItemProgress({
  value,
  className,
  ...props
}: ComponentProps<typeof View> & { value: number }) {
  const { tone } = usePickerItem();

  return (
    <Progress value={value} className={cn(ITEM_BAR, className)} {...props}>
      <ProgressTrack className="h-0.5 rounded-none bg-transparent">
        <ProgressIndicator className={cn("rounded-none", PROGRESS_STYLES[tone])} />
      </ProgressTrack>
    </Progress>
  );
}
