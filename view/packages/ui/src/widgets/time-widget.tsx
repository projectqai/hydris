import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

export function TimeWidget() {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const localTime = time ? format(time, "HH:mm:ss") : "--:--:--";
  const localDate = time ? format(time, "dd MMM") : "--";
  const utcTime = time ? formatInTimeZone(time, "UTC", "HH:mm:ss") : "--:--:--";
  const utcDate = time ? formatInTimeZone(time, "UTC", "dd MMM") : "--";

  return (
    <>
      <View className="flex gap-px lg:hidden">
        <View className="flex-row items-baseline gap-1">
          <Text className="text-foreground/75 text-9 font-mono tracking-wide">LOCAL</Text>
          <Text className="text-foreground/80 text-11 font-mono tracking-tight tabular-nums">
            {localTime}
          </Text>
          <Text className="text-foreground/75 text-9 font-mono tracking-wide uppercase">
            {localDate}
          </Text>
        </View>
        <View className="flex-row items-baseline gap-1">
          <Text className="text-foreground/75 text-9 font-mono tracking-wide">ZULU</Text>
          <Text className="text-foreground/75 text-11 font-mono tracking-tight tabular-nums">
            {utcTime}
          </Text>
          <Text className="text-foreground/75 text-9 font-mono tracking-wide uppercase">
            {utcDate}
          </Text>
        </View>
      </View>

      <View className="hidden flex-row items-baseline gap-4 lg:flex">
        <View className="flex-row items-baseline gap-1.5">
          <Text className="text-foreground/75 text-10 font-mono tracking-wider">LOCAL</Text>
          <Text className="text-foreground/80 text-13 font-mono tracking-tight tabular-nums">
            {localTime}
          </Text>
          <Text className="text-foreground/75 text-10 font-mono tracking-wide uppercase">
            {localDate}
          </Text>
        </View>
        <View className="flex-row items-baseline gap-1.5">
          <Text className="text-foreground/75 text-10 font-mono tracking-wider">ZULU</Text>
          <Text className="text-foreground/75 text-13 font-mono tracking-tight tabular-nums">
            {utcTime}
          </Text>
          <Text className="text-foreground/75 text-10 font-mono tracking-wide uppercase">
            {utcDate}
          </Text>
        </View>
      </View>
    </>
  );
}
