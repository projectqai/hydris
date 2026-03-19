import { Keyboard, Platform, Pressable, useWindowDimensions, View } from "react-native";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Z } from "../../constants";
import { useChatStore } from "../../store/chat-store";
import { chatFocusProgress, floatingTextInputRef } from "./chat-input-shared";
import { ChatInput } from "./chat-pane";

export function FloatingChatInput() {
  if (Platform.OS === "web") return null;

  return <FloatingChatInputInner />;
}

function FloatingChatInputInner() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const inputSlot = useChatStore((s) => s.inputSlot);
  const keyboardHeight = useSharedValue(0);
  const peakKeyboardHeight = useSharedValue(0);
  const isClosing = useSharedValue(false);

  useKeyboardHandler(
    {
      onStart: (e) => {
        "worklet";
        if (e.height > 0) {
          isClosing.value = false;
          chatFocusProgress.value = withSpring(1);
        } else {
          isClosing.value = true;
        }
      },
      onMove: (e) => {
        "worklet";
        keyboardHeight.value = e.height;
        if (isClosing.value && peakKeyboardHeight.value > 0) {
          chatFocusProgress.value = e.height / peakKeyboardHeight.value;
        }
      },
      onEnd: (e) => {
        "worklet";
        keyboardHeight.value = e.height;
        if (e.height > 0) {
          peakKeyboardHeight.value = e.height;
        } else {
          chatFocusProgress.value = 0;
          isClosing.value = false;
        }
      },
    },
    [],
  );

  const slotTop = inputSlot?.pageY ?? screenHeight;
  const slotLeft = inputSlot?.pageX ?? 0;
  const slotWidth = inputSlot?.width ?? screenWidth;
  const inputHeight = inputSlot?.height ?? 0;

  const rStyle = useAnimatedStyle(() => {
    const progress = chatFocusProgress.get();
    const aboveKeyboard = screenHeight - keyboardHeight.value - inputHeight + 1;

    return {
      top: interpolate(progress, [0, 1], [slotTop, aboveKeyboard]),
      left: interpolate(progress, [0, 1], [slotLeft, 0]),
      width: interpolate(progress, [0, 1], [slotWidth, screenWidth]),
      opacity: interpolate(progress, [0, 0.15], [0, 1], "clamp"),
      pointerEvents: progress > 0.05 ? ("auto" as const) : ("none" as const),
    };
  });

  const rBackdropStyle = useAnimatedStyle(() => ({
    opacity: chatFocusProgress.get() > 0.1 ? 1 : 0,
    pointerEvents: chatFocusProgress.get() > 0.1 ? ("auto" as const) : ("none" as const),
  }));

  if (!inputSlot) return null;

  return (
    <>
      <Animated.View
        className="absolute inset-0"
        style={[{ zIndex: Z.FLOATING_WINDOW - 1 }, rBackdropStyle]}
      >
        <Pressable
          className="flex-1"
          onPress={() => Keyboard.dismiss()}
          accessibilityLabel="Dismiss keyboard"
        />
      </Animated.View>
      <Animated.View
        className="bg-background absolute overflow-hidden"
        style={[{ zIndex: Z.FLOATING_WINDOW }, rStyle]}
      >
        <View style={{ paddingLeft: 80 + insets.left, paddingRight: 80 + insets.right }}>
          <ChatInput
            textInputRef={floatingTextInputRef}
            onSend={() => Keyboard.dismiss()}
            borderless
          />
        </View>
      </Animated.View>
    </>
  );
}
