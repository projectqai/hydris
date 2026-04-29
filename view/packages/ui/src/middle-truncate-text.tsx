import { Text, View } from "react-native";

import { cn } from "./lib/utils";

type MiddleTruncateTextProps = {
  text: string;
  tailLength?: number;
  className?: string;
};

export function MiddleTruncateText({ text, tailLength = 10, className }: MiddleTruncateTextProps) {
  if (text.length <= tailLength * 2) {
    return <Text className={className}>{text}</Text>;
  }

  const head = text.slice(0, -tailLength);
  const tail = text.slice(-tailLength);

  return (
    <View className="flex-row items-baseline overflow-hidden">
      <Text numberOfLines={1} className={cn("shrink", className)}>
        {head}
      </Text>
      <Text numberOfLines={1} className={cn("shrink-0", className)}>
        {tail}
      </Text>
    </View>
  );
}
