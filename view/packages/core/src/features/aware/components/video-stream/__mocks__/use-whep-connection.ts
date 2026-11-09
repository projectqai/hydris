import { fn } from "storybook/test";

import type * as real from "../use-whep-connection";

const connection: ReturnType<typeof real.useWHEPConnection> = {
  stream: null,
  connectionState: "connecting",
  error: null,
  retry: fn().mockName("retry"),
};

export const useWHEPConnection = fn<typeof real.useWHEPConnection>(() => connection).mockName(
  "useWHEPConnection",
);
