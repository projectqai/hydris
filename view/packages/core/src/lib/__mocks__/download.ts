import { fn } from "storybook/test";

import type * as real from "../download";

export const downloadFromEndpoint = fn<typeof real.downloadFromEndpoint>(async () => {
  throw new Error("downloadFromEndpoint called from a story");
}).mockName("downloadFromEndpoint");
