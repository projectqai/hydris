import type { ComponentProps, ReactNode } from "react";
import {
  Children,
  createContext,
  isValidElement,
  use,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Pressable, Text, View } from "react-native";

import { cn } from "./lib/utils";

// React Native text does not inherit colour, so a control that recolours its content passes classes down
export const FieldTextContext = createContext<{ title?: string; description?: string }>({});

type FieldControlSlot = {
  subscribe: (onChange: () => void) => () => void;
  hasControl: () => boolean;
  activate: () => void;
  register: (activate: () => void) => () => void;
};

function createFieldControlSlot(): FieldControlSlot {
  let control: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    hasControl: () => control !== undefined,
    activate: () => control?.(),
    register: (next) => {
      if (process.env.NODE_ENV !== "production" && control) {
        throw new Error("A field can contain one control");
      }

      control = next;
      notify();

      return () => {
        if (control !== next) return;

        control = undefined;
        notify();
      };
    },
  };
}

const FieldControlContext = createContext<FieldControlSlot | null>(null);

function useOutermostFieldSlot() {
  const outer = use(FieldControlContext);
  const [own] = useState(createFieldControlSlot);

  return outer ?? own;
}

type FieldControl = { activate: () => void; editable: boolean };

export function useFieldControl({ activate, editable }: FieldControl) {
  const slot = use(FieldControlContext);
  const latest = useRef(activate);

  useLayoutEffect(() => {
    latest.current = activate;
  });

  useLayoutEffect(() => {
    if (!slot || !editable) return;

    return slot.register(() => latest.current());
  }, [slot, editable]);
}

type FieldOrientation = "vertical" | "horizontal";

const ORIENTATION_STYLES: Record<FieldOrientation, string> = {
  vertical: "gap-1.5",
  horizontal: "flex-row items-center gap-3",
};

export function Field({
  orientation = "vertical",
  className,
  ...props
}: ComponentProps<typeof View> & { orientation?: FieldOrientation }) {
  const slot = useOutermostFieldSlot();

  return (
    <FieldControlContext value={slot}>
      <View className={cn(ORIENTATION_STYLES[orientation], className)} {...props} />
    </FieldControlContext>
  );
}

export function FieldContent({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn("flex-1 gap-0.5", className)} {...props} />;
}

// pressing it acts on its control, so it stays out of the tab order and the control is the only tab stop
export function FieldLabel({ className, ...props }: ComponentProps<typeof View>) {
  const slot = useOutermostFieldSlot();
  const hasControl = useSyncExternalStore(slot.subscribe, slot.hasControl);

  return (
    <FieldControlContext value={slot}>
      <Pressable
        onPress={slot.activate}
        disabled={!hasControl}
        tabIndex={-1}
        className={className}
        {...props}
      />
    </FieldControlContext>
  );
}

// Icons inside a Text sit on the baseline in React Native, so they go beside it.
export function FieldTitle({ className, children }: { className?: string; children: ReactNode }) {
  const { title } = use(FieldTextContext);
  const words: ReactNode[] = [];
  const marks: ReactNode[] = [];

  for (const child of Children.toArray(children)) {
    if (isValidElement(child)) marks.push(child);
    else words.push(child);
  }

  return (
    <View className="shrink flex-row items-center gap-1.5 self-start">
      <Text className={cn("font-sans-medium text-foreground shrink text-sm", title, className)}>
        {words}
      </Text>
      {marks}
    </View>
  );
}

export function FieldDescription({ className, ...props }: ComponentProps<typeof Text>) {
  const { description } = use(FieldTextContext);

  return (
    <Text
      className={cn("text-muted-foreground font-mono text-xs", description, className)}
      {...props}
    />
  );
}

export function FieldError({ className, children, ...props }: ComponentProps<typeof Text>) {
  if (!children) return null;

  return (
    <Text
      accessibilityRole="alert"
      className={cn("text-red-foreground font-mono text-xs", className)}
      {...props}
    >
      {children}
    </Text>
  );
}
