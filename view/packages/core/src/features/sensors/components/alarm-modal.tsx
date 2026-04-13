import { useThemeColors } from "@hydris/ui/lib/theme";
import { TriangleAlert } from "lucide-react-native";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AlarmState } from "../alarm-store";
import { SENSOR_KIND_LABEL } from "../types";

type Props = {
  alarm: AlarmState;
  onAcknowledge: () => void;
};

function formatReading(alarm: AlarmState): string {
  switch (alarm.reading.shape) {
    case "metric":
      return `${alarm.reading.primary.value.toFixed(2)} ${alarm.reading.primary.unit}`;
    case "levels": {
      if (alarm.levelCode) {
        const level = alarm.reading.levels.find((l) => l.code === alarm.levelCode);
        if (level) return `${level.code}: ${level.value} ${alarm.reading.unit}`;
      }
      const max = alarm.reading.levels.reduce((a, b) => (a.value > b.value ? a : b));
      return `${max.code}: ${max.value} ${alarm.reading.unit}`;
    }
  }
}

export function AlarmModal({ alarm, onAcknowledge }: Props) {
  const insets = useSafeAreaInsets();
  const t = useThemeColors();

  return (
    <Modal
      visible
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onAcknowledge}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: t.destructiveRed,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
      >
        <View className="flex-1 flex-row items-center justify-center gap-8 px-8">
          <View className="items-center">
            <TriangleAlert size={64} color="white" strokeWidth={2.5} />
            <Text className="font-sans-bold mt-4 text-3xl text-white uppercase">ALARM</Text>
            <Text className="font-sans-semibold mt-2 text-lg text-white/80">
              {alarm.sensorName}
            </Text>
          </View>

          <View className="max-w-md flex-1">
            <View className="mb-4 border-2 border-white/30 bg-white/10 p-4">
              <View>
                <Text className="font-sans text-xs text-white/60 uppercase">Type</Text>
                <Text className="font-sans-semibold text-base text-white">
                  {SENSOR_KIND_LABEL[alarm.sensorKind]}
                </Text>
              </View>

              <View className="mt-4 border-t border-white/20 pt-4">
                <Text className="font-sans text-xs text-white/60 uppercase">Current Reading</Text>
                <Text className="font-sans-bold text-4xl text-white">{formatReading(alarm)}</Text>
              </View>
            </View>

            <Pressable onPress={onAcknowledge} className="bg-white py-4 active:opacity-80">
              <Text
                className="font-sans-bold text-center text-xl uppercase"
                style={{ color: t.destructiveRed }}
              >
                ACKNOWLEDGE
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
