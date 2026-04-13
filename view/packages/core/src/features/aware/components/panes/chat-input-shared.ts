import type { TextInput } from "react-native";
import { makeMutable } from "react-native-reanimated";

export const chatFocusProgress = makeMutable(0);

export const floatingTextInputRef: { current: TextInput | null } = { current: null };
