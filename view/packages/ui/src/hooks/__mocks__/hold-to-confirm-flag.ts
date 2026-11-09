import { fn } from "storybook/test";

import type * as real from "../hold-to-confirm-flag";

// Stories run with the hold on, so the hold keeps its coverage while the release ships without it
export const holdToConfirmEnabled = fn<typeof real.holdToConfirmEnabled>(() => true).mockName(
  "holdToConfirmEnabled",
);
