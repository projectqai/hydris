import { fn } from "storybook/test";

const router = {
  setParams: fn().mockName("router.setParams"),
};

export const useRouter = fn(() => router).mockName("useRouter");

export const useLocalSearchParams = fn(() => ({})).mockName("useLocalSearchParams");
