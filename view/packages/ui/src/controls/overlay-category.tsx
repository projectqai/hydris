import type { LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";

import { OverlayToggle, type ThemeColor } from "./overlay-toggle";

export type OverlayCategoryOption<Id extends string = string> = {
  id: Id;
  label: string;
} & ({ color: ThemeColor; icon?: never } | { icon: LucideIcon; color?: never });

export type OverlayCategoryProps<Id extends string = string> = {
  title: string;
  options: readonly OverlayCategoryOption<Id>[];
  activeStates: Record<Id, boolean>;
  onToggle: (id: Id) => void;
};

export function OverlayCategory<Id extends string>({
  title,
  options,
  activeStates,
  onToggle,
}: OverlayCategoryProps<Id>) {
  return (
    <View className="gap-1.5">
      <Text
        selectable={false}
        className="text-12 text-on-surface/70 font-sans-medium tracking-wider uppercase"
      >
        {title}
      </Text>
      <View className="flex-row flex-wrap gap-1">
        {options.map((option) => (
          <OverlayToggle
            key={option.id}
            label={option.label}
            color={option.color}
            icon={option.icon}
            isActive={activeStates[option.id] ?? false}
            onToggle={() => onToggle(option.id)}
          />
        ))}
      </View>
    </View>
  );
}
