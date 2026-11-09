import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { ModeBarHeader } from "./mode-bar-header";

export function ModeBarContent({
  icon,
  label,
  help,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <ModeBarHeader icon={icon} label={label} help={help} />
      <View className="flex-1 flex-row items-center justify-end gap-1.5">{children}</View>
    </>
  );
}
