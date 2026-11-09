import type { ReactNode } from "react";
import { Modal, Platform, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export function DeviceModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  if (Platform.OS === "web") return children;

  return (
    <Modal transparent onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1 }}>
          <View className="flex-1">{children}</View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
