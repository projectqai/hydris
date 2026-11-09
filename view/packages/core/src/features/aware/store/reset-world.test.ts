import { create } from "@bufbuild/protobuf";
import { HardResetResponseSchema } from "@projectqai/proto/world";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/world-client", () => ({
  worldClient: { hardReset: vi.fn(async () => ({})) },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { removeItem: vi.fn(async () => undefined) },
}));

import { worldClient } from "../../../lib/api/world-client";
import { placementResetRef } from "../placement-context";
import { usePathStore } from "./path-store";
import { resetWorld } from "./reset-world";

describe("resetWorld", () => {
  beforeEach(() => {
    placementResetRef.current = null;
    usePathStore.setState({ paths: [], drawingId: null });
  });

  // A bar left up over a deleted entity pushes it back as a stub on Confirm.
  it("stands placement down before waiting for the engine", async () => {
    let finishReset: (() => void) | undefined;
    vi.mocked(worldClient.hardReset).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReset = () => resolve(create(HardResetResponseSchema));
        }),
    );
    const exit = vi.fn();
    placementResetRef.current = exit;

    const resetting = resetWorld();

    expect(exit).toHaveBeenCalledTimes(1);
    finishReset?.();
    await resetting;
  });

  // The armed tool is the person's, not the world's.
  it("keeps an armed drawing tool armed, on an empty path", async () => {
    usePathStore.getState().start("freeform");
    usePathStore.getState().addPoint({ type: "coordinate", position: { lat: 51.9, lng: -1.7 } });

    await resetWorld();

    const { paths, drawingId } = usePathStore.getState();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ id: drawingId, kind: "freeform", points: [] });
  });
});
