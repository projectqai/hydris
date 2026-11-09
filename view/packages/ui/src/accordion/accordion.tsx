import { ChevronRight } from "lucide-react-native";
import type { ReactNode, Ref } from "react";
import { createContext, use, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";
import { MotionIndicator, MotionItem, MotionPanel, MotionRoot } from "./accordion-motion";

type AccordionProps = { className?: string; children: ReactNode } & (
  | {
      type: "single";
      value?: string;
      defaultValue?: string;
      onValueChange?: (value: string) => void;
      collapsible?: boolean;
    }
  | {
      type: "multiple";
      value?: string[];
      defaultValue?: string[];
      onValueChange?: (value: string[]) => void;
    }
);

function listOf(value: string | undefined): string[] {
  return value ? [value] : [];
}

function controlledOpen(props: AccordionProps): string[] | undefined {
  if (props.value === undefined) return undefined;

  return props.type === "single" ? listOf(props.value) : props.value;
}

function nextOpen(
  type: AccordionProps["type"],
  collapsible: boolean,
  open: string[],
  value: string,
): string[] {
  if (!open.includes(value)) return type === "single" ? [value] : [...open, value];

  if (type === "multiple") return open.filter((v) => v !== value);

  return collapsible ? [] : open;
}

type AccordionContextValue = {
  toggle: (value: string) => void;
  isOpen: (value: string) => boolean;
};

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordionContext() {
  const context = use(AccordionContext);

  if (!context) throw new Error("Accordion parts must be rendered inside an Accordion");

  return context;
}

type AccordionItemContextValue = { value: string; open: boolean };

const AccordionItemContext = createContext<AccordionItemContextValue | null>(null);

function useAccordionItemContext() {
  const context = use(AccordionItemContext);

  if (!context) throw new Error("Accordion item parts must be rendered inside an AccordionItem");

  return context;
}

export function Accordion(props: AccordionProps) {
  const { className, children } = props;
  const collapsible = props.type === "single" && props.collapsible === true;

  const [uncontrolled, setUncontrolled] = useState(() =>
    props.type === "single" ? listOf(props.defaultValue) : (props.defaultValue ?? []),
  );

  const open = controlledOpen(props) ?? uncontrolled;

  const toggle = (value: string) => {
    const next = nextOpen(props.type, collapsible, open, value);

    if (next === open) return;

    setUncontrolled(next);

    if (props.type === "single") props.onValueChange?.(next[0] ?? "");
    else props.onValueChange?.(next);
  };

  const context = { toggle, isOpen: (value: string) => open.includes(value) };

  return (
    <AccordionContext value={context}>
      <MotionRoot className={cn("gap-2", className)}>{children}</MotionRoot>
    </AccordionContext>
  );
}

export function AccordionItem({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const { isOpen } = useAccordionContext();
  const open = isOpen(value);
  const item = useMemo(() => ({ value, open }), [value, open]);

  return (
    <AccordionItemContext value={item}>
      <MotionItem
        className={cn(
          "border-surface-overlay/8 bg-surface-overlay/[.02] rounded-lg border",
          className,
        )}
      >
        {children}
      </MotionItem>
    </AccordionItemContext>
  );
}

export function AccordionTrigger({
  className,
  children,
  highlighted,
  accessibilityLabel,
  ref,
}: {
  className?: string;
  children: ReactNode;
  highlighted?: boolean;
  accessibilityLabel?: string;
  ref?: Ref<View>;
}) {
  const { toggle } = useAccordionContext();
  const { value, open } = useAccordionItemContext();

  return (
    <Pressable
      ref={ref}
      role="button"
      accessibilityLabel={accessibilityLabel}
      aria-expanded={open}
      onPress={() => toggle(value)}
      tabIndex={highlighted === undefined ? undefined : -1}
      className={cn(
        "web:focus-visible:ring-foreground/30 web:focus-visible:ring-2 z-10 min-h-[45px] flex-row items-center gap-2 rounded-lg px-3 py-2.5 outline-none select-none",
        highlighted ? "bg-glass-hover" : !open && "hover:bg-surface-overlay/[.03]",
        className,
      )}
    >
      {children}
    </Pressable>
  );
}

export function AccordionIndicator({ className }: { className?: string }) {
  const t = useThemeColors();
  const { open } = useAccordionItemContext();

  return (
    <View className={className}>
      <MotionIndicator open={open}>
        <ChevronRight size={14} strokeWidth={2} color={t.controlFg} />
      </MotionIndicator>
    </View>
  );
}

export function AccordionTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Text
      className={cn(
        "font-sans-medium text-on-surface/70 min-w-0 shrink text-xs tracking-widest uppercase",
        className,
      )}
    >
      {children}
    </Text>
  );
}

export function AccordionCount({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Text className={cn("text-on-surface/70 ml-auto font-mono text-xs tabular-nums", className)}>
      {children}
    </Text>
  );
}

export function AccordionContent({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { open } = useAccordionItemContext();

  return (
    <MotionPanel open={open}>
      <View className={cn("px-3 pb-3", className)}>{children}</View>
    </MotionPanel>
  );
}
