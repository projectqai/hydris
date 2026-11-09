import { View } from "react-native";

// A tap on a blocked control still shakes it and reports the refusal. A disabled Pressable
// drops presses, and on web it renders a disabled button that also drops its children's
// presses, so this view lies over it instead of inside it.
export function RefusePressCatcher({ onRefuse }: { onRefuse: () => void }) {
  return (
    <View
      className="absolute inset-0"
      onStartShouldSetResponder={() => true}
      onResponderRelease={onRefuse}
    />
  );
}
