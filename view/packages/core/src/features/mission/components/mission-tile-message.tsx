import type { CardIconComponent, CardVariant } from "@hydris/ui/card";
import { useCard } from "@hydris/ui/card";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { TriangleAlert } from "lucide-react-native";
import { Text, View } from "react-native";

type IconStyle = { className: string; strokeWidth: number };

const ICON_STYLES: Record<CardVariant, IconStyle> = {
  empty: { className: "opacity-50", strokeWidth: 1 },
  default: { className: "opacity-50", strokeWidth: 1 },
  success: { className: "opacity-20", strokeWidth: 1 },
  info: { className: "opacity-20", strokeWidth: 1 },
  pending: { className: "opacity-20", strokeWidth: 1 },
  alert: { className: "", strokeWidth: 2 },
};

export function MissionTileMessage({
  icon: Icon,
  label,
  className,
}: {
  icon: CardIconComponent;
  label: string;
  className?: string;
}) {
  const t = useThemeColors();
  const { variant, text, iconColor } = useCard();
  const icon = ICON_STYLES[variant];

  return (
    <View className={cn("items-center gap-2.5", className)}>
      <View aria-hidden className={icon.className}>
        <Icon size={32} color={t[iconColor]} strokeWidth={icon.strokeWidth} absoluteStrokeWidth />
      </View>
      <Text
        numberOfLines={2}
        className={cn("text-11 text-center font-mono leading-none uppercase", text.content)}
      >
        {label}
      </Text>
    </View>
  );
}

export function MissionTileAlert({ label }: { label: string }) {
  return <MissionTileMessage icon={TriangleAlert} label={label} />;
}
