import type { PropsWithChildren } from "react";
import { View } from "react-native";

export function MediaFrame({ children }: PropsWithChildren) {
  return <View className="relative aspect-video overflow-hidden bg-black">{children}</View>;
}
