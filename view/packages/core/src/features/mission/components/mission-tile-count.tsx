import { useCard } from "@hydris/ui/card";
import { cn } from "@hydris/ui/lib/utils";
import { Text, View } from "react-native";

export function MissionTileCount({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const { text } = useCard();

  return (
    <View className={cn("items-center gap-2", className)}>
      <Text className={cn("font-mono text-4xl leading-none font-bold tabular-nums", text.content)}>
        {String(value).padStart(2, "0")}
      </Text>
      <Text className={cn("text-11 font-mono leading-none", text.content)}>{label}</Text>
    </View>
  );
}
