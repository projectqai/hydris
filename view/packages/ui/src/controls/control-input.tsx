import { forwardRef, type ReactNode, useState } from "react";
import type { TextInputProps } from "react-native";
import { TextInput, View } from "react-native";

import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

export type ControlInputProps = TextInputProps & {
  className?: string;
  suffix?: ReactNode;
};

export const ControlInput = forwardRef<TextInput, ControlInputProps>(function ControlInput(
  { className, style, onFocus, onBlur, suffix, ...props },
  ref,
) {
  const t = useThemeColors();
  const [focused, setFocused] = useState(false);

  const input = (
    <TextInput
      ref={ref}
      placeholderTextColor={t.placeholder}
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      className={cn("text-foreground px-3 py-2 font-mono text-sm", suffix && "flex-1", className)}
      // @ts-expect-error outlineStyle is a React Native Web prop
      style={[{ outlineStyle: "none", backgroundColor: "transparent" }, style]}
    />
  );

  return (
    <View
      className={cn(
        "bg-control-input overflow-hidden rounded-lg border",
        focused ? "border-control-border-hover" : "border-control-border",
      )}
    >
      {suffix ? (
        <View className="flex-row items-center">
          {input}
          {suffix}
        </View>
      ) : (
        input
      )}
    </View>
  );
});
