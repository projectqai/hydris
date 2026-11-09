import { Lock, X } from "lucide-react-native";
import type { ComponentProps, ReactNode } from "react";
import { createContext, use, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { CardIconComponent } from "./card";
import { ROW_SIZE, ROW_TEXT_STYLES, UNFRAMED_ROW_TEXT_INSET } from "./control-row";
import {
  ControlButtonInset,
  controlButtonShadow,
  type ControlButtonVariant,
} from "./controls/control-button";
import { FieldTextContext } from "./field";
import { HoldLabel } from "./hold-label";
import { PulseLayer, type PulseLook, ShakeFrame } from "./hold-motion";
import { holdToConfirmEnabled } from "./hooks/hold-to-confirm-flag";
import { useConfirmPress } from "./hooks/use-confirm-press";
import { useKeyboardShortcut } from "./keyboard/use-keyboard-shortcut";
import { useOnGreenColor, useThemeColors } from "./lib/theme";
import { cn } from "./lib/utils";
import { Progress, ProgressIndicator, ProgressTrack } from "./progress";
import { RefusePressCatcher } from "./refuse-press-catcher";

// Above the lists and views around it. Escape is taken only while a tap waits for its hold.
const KEY_PRIORITY = 300;

// The button is the only item it confirms
const SELF = "self";

const OUTLINE = "pointer-events-none absolute inset-0 rounded-2xl border";

// The light surface stays 1px inside the rounded edge. At the edge it would show through the hold
// fill's anti-aliasing.
const CONFIRMING_SURFACE = "bg-foreground pointer-events-none absolute inset-px rounded-[15px]";

// Busy looks like running but takes no taps, so a cancel already on its way is not sent twice
export type HoldButtonStatus = "idle" | "running" | "busy" | "done" | "failed";

type Look = "idle" | "locked" | "confirming" | "running" | "done" | "failed";

type Mark = "faint" | "danger";

function lookOf(status: HoldButtonStatus, confirming: boolean, blocked: boolean): Look {
  if (status === "busy") return "running";

  if (status !== "idle") return status;

  if (confirming) return "confirming";

  return blocked ? "locked" : "idle";
}

const MARKS: Record<HoldButtonStatus, Mark | undefined> = {
  idle: undefined,
  running: "faint",
  busy: undefined,
  done: undefined,
  failed: "danger",
};

const SURFACE_STYLES: Record<Look, string> = {
  idle: "bg-foreground/4 hover:bg-foreground/7 cursor-pointer",
  locked: "bg-foreground/4 cursor-default",
  confirming: "cursor-pointer",
  running: "cursor-pointer",
  done: "bg-active-green cursor-default",
  failed: "bg-red-foreground/10 cursor-pointer",
};

const TEXT_STYLES: Record<Look, keyof typeof ROW_TEXT_STYLES> = {
  idle: "plain",
  locked: "locked",
  confirming: "plain",
  running: "plain",
  done: "onGreen",
  failed: "plain",
};

const OUTLINE_STYLES: Record<Look, string> = {
  idle: "border-border",
  locked: "border-border",
  confirming: "border-border",
  running: "border-border",
  done: "border-active-green",
  failed: "border-red-foreground",
};

const CONTROL_VARIANTS: Record<Look, ControlButtonVariant> = {
  idle: "default",
  locked: "default",
  confirming: "default",
  running: "default",
  done: "success",
  failed: "default",
};

function pulseOf(look: Look, holding: boolean): PulseLook | undefined {
  if (look === "running") return "running";

  return look === "confirming" && !holding ? "confirming" : undefined;
}

type HoldButtonContextValue = { look: Look; mark: Mark | undefined };

const HoldButtonContext = createContext<HoldButtonContextValue | null>(null);

function useHoldButton() {
  const context = use(HoldButtonContext);

  if (!context) throw new Error("This part must be rendered inside a HoldButton");

  return context;
}

export function HoldButton({
  status = "idle",
  disabled = false,
  onConfirm,
  onCancel,
  onDismiss,
  onRefuse,
  className,
  children,
}: {
  status?: HoldButtonStatus;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  onRefuse: () => void;
  className?: string;
  children: ReactNode;
}) {
  const [tapped, setTapped] = useState(false);
  const [focused, setFocused] = useState(false);
  const [shakes, setShakes] = useState(0);
  const blocked = status === "idle" && disabled;

  if (tapped && (status !== "idle" || disabled)) setTapped(false);

  const confirm = useConfirmPress({
    tapped: tapped ? SELF : undefined,
    focused: focused ? SELF : undefined,
    canConfirm: () => status === "idle" && !disabled,
    onConfirm: () => {
      setTapped(false);
      onConfirm();
    },
    onLapse: () => setTapped(false),
  });

  const confirming = confirm.confirming !== undefined;
  const { holding } = confirm;
  const look = lookOf(status, confirming, blocked);
  const pulse = pulseOf(look, holding);
  const mark = MARKS[status];
  const t = useThemeColors();
  const variant = CONTROL_VARIANTS[look];

  const item = useMemo(() => ({ look, mark }), [look, mark]);

  const endConfirm = () => {
    confirm.stopHold();
    setTapped(false);
  };

  useKeyboardShortcut(
    "Escape",
    () => {
      if (!tapped || !focused) return false;

      endConfirm();

      return true;
    },
    { priority: KEY_PRIORITY },
  );

  const statusAction = () => {
    if (status === "running") onCancel();
    else if (status === "failed") onDismiss();
  };

  const refuse = () => {
    setShakes((count) => count + 1);
    onRefuse();
  };

  return (
    <View className={className}>
      <ShakeFrame shakes={shakes} onPressOutside={tapped ? endConfirm : undefined}>
        <Pressable
          disabled={blocked}
          accessibilityRole="button"
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);

            if (tapped) endConfirm();
          }}
          onPressIn={() => confirm.pressIn(SELF)}
          onPressOut={confirm.pressOut}
          onPress={() => {
            if (!confirm.releasedAsTap()) return;

            if (status !== "idle") statusAction();
            else if (holdToConfirmEnabled()) setTapped(true);
            else onConfirm();
          }}
          className={cn(
            "web:focus-visible:ring-2 web:focus-visible:ring-inset web:focus-visible:ring-foreground/30 overflow-hidden rounded-2xl transition-colors duration-200 outline-none select-none",
            SURFACE_STYLES[look],
          )}
          style={controlButtonShadow(t, variant, look === "locked")}
        >
          <ControlButtonInset variant={variant} />
          {confirming && <View className={CONFIRMING_SURFACE} />}
          {pulse && <PulseLayer key={pulse} look={pulse} />}
          <HoldButtonContext value={item}>
            <FieldTextContext value={ROW_TEXT_STYLES[TEXT_STYLES[look]]}>
              <View
                className={cn(
                  "transition-opacity duration-150",
                  confirming && "opacity-0 duration-0",
                )}
              >
                {children}
              </View>
            </FieldTextContext>
          </HoldButtonContext>
          {confirming && <HoldLabel progress={confirm.progress} holding={holding} />}
          <View className={cn(OUTLINE, OUTLINE_STYLES[look])} />
        </Pressable>
        {blocked && <RefusePressCatcher onRefuse={refuse} />}
      </ShakeFrame>
    </View>
  );
}

// The content draws its own top corner mark, the way a select trigger draws its icon. Its space
// is kept even without a mark, so the text never rewraps when one appears.
export function HoldButtonContent({ className, children, ...props }: ComponentProps<typeof View>) {
  const t = useThemeColors();
  const { mark } = useHoldButton();

  return (
    <View
      className={cn("flex-row items-center pr-10", ROW_SIZE, UNFRAMED_ROW_TEXT_INSET, className)}
      {...props}
    >
      {children}
      {mark && (
        <View
          aria-hidden
          className="absolute top-3 right-3 size-[22px] items-center justify-center"
        >
          <X size={16} strokeWidth={2} color={mark === "danger" ? t.redForeground : t.iconMuted} />
        </View>
      )}
    </View>
  );
}

// Icons take a color value, not a class, so the icon picks its button's text color here
export function HoldButtonIcon({
  icon: Icon,
  className,
}: {
  icon: CardIconComponent;
  className?: string;
}) {
  const t = useThemeColors();
  const onGreen = useOnGreenColor();
  const { look } = useHoldButton();
  const colors: Partial<Record<Look, string>> = { locked: t.iconMuted, done: onGreen };

  return (
    <View aria-hidden className={className}>
      <Icon size={14} strokeWidth={2} color={colors[look] ?? t.iconDefault} />
    </View>
  );
}

export function HoldButtonLock({ className }: { className?: string }) {
  const t = useThemeColors();
  const { look } = useHoldButton();

  if (look !== "locked") return null;

  return (
    <View aria-hidden className={className}>
      <Lock size={13} strokeWidth={2} color={t.iconMuted} />
    </View>
  );
}

export function HoldButtonProgress({
  value,
  className,
  ...props
}: ComponentProps<typeof View> & { value: number }) {
  return (
    <Progress
      value={value}
      className={cn("absolute inset-x-0 bottom-0 h-0.5", className)}
      {...props}
    >
      <ProgressTrack className="h-0.5 rounded-none bg-transparent">
        <ProgressIndicator className="bg-active-green rounded-none" />
      </ProgressTrack>
    </Progress>
  );
}
