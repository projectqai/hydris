import { Platform, useWindowDimensions } from "react-native";

const LANDSCAPE_PHONE_MAX_HEIGHT = 480;
const PHONE_WIDTH_SHARE = 0.88;
const PHONE_EDGE = 12;
const NATIVE_WIDTH_SHARE = 0.92;
const NATIVE_HEIGHT_SHARE = 0.88;
const WIDEST_ASPECT = 16 / 10;
const TALLEST_ASPECT = 4 / 3;

export type PhoneModalFrame = { width: number; height: number; edge: number };

export function useNativeModalBox() {
  const window = useWindowDimensions();
  const width = window.width * NATIVE_WIDTH_SHARE;
  const height = window.height * NATIVE_HEIGHT_SHARE;

  if (width / height > WIDEST_ASPECT) return { width: height * WIDEST_ASPECT, height };

  if (width / height < TALLEST_ASPECT) return { width, height: width / TALLEST_ASPECT };

  return { width, height };
}

export function usePhoneModalFrame(): PhoneModalFrame | undefined {
  const window = useWindowDimensions();

  if (Platform.OS === "web" || window.height >= LANDSCAPE_PHONE_MAX_HEIGHT) return undefined;

  return {
    width: window.width * PHONE_WIDTH_SHARE,
    height: window.height - PHONE_EDGE * 2,
    edge: PHONE_EDGE,
  };
}
