"use no memo";

import { ScrollView, View } from "react-native";

import { MissionDoneFooter, MissionHealth } from "../../../../mission-pack/mission-health";

export function MissionHealthView({ onClose }: { onClose: () => void }) {
  return (
    <View className="flex-1">
      <ScrollView className="flex-1" contentContainerClassName="flex-grow">
        <MissionHealth />
      </ScrollView>
      <MissionDoneFooter onDone={onClose} />
    </View>
  );
}
