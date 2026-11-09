import { useCard } from "@hydris/ui/card";
import { cn } from "@hydris/ui/lib/utils";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

export function MissionTileRow({
  label,
  className,
  labelClassName,
  children,
}: {
  label: string;
  className?: string;
  labelClassName?: string;
  children: ReactNode;
}) {
  const { text } = useCard();

  return (
    <View
      className={cn(
        "border-surface-overlay/10 flex-row flex-wrap items-center justify-end gap-x-2 gap-y-1 border-b py-1.5",
        className,
      )}
    >
      <Text
        numberOfLines={1}
        className={cn(
          "text-11 min-w-0 shrink grow basis-2/5 font-mono leading-tight",
          text.content,
          labelClassName,
        )}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}
