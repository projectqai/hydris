import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBullseyeStore } from "../store/bullseye-store";
import { useEditStore } from "../store/edit-store";
import { selectPathKind, usePathStore } from "../store/path-store";
import { useEscapeHandler } from "./use-escape-handler";

const harness = vi.hoisted(() => ({
  escape: null as (() => boolean) | null,
  closeAllPIP: vi.fn(),
  collapseAll: vi.fn(),
  selection: {
    selectedEntityId: null as string | null,
    viewedEntityId: null as string | null,
    select: vi.fn(),
    clearSelection: vi.fn(),
  },
}));

vi.mock("../../../lib/api/world-client", () => ({ worldClient: {} }));

vi.mock("@hydris/ui/keyboard", () => ({
  useKeyboardShortcut: (_key: string, handler: () => boolean) => {
    harness.escape = handler;
  },
}));

vi.mock("@hydris/ui/panels", () => ({
  usePanelContext: () => ({ collapseAll: harness.collapseAll }),
}));

vi.mock("../pip-context", () => ({
  usePIPContext: () => ({ windows: [], closeAllPIP: harness.closeAllPIP }),
}));

vi.mock("../store/selection-store", () => ({
  useSelectionStore: (selector: (state: typeof harness.selection) => unknown) =>
    selector(harness.selection),
}));

const registerEscape = ({
  isPlacing = false,
  exitPlacement = vi.fn(),
}: {
  isPlacing?: boolean;
  exitPlacement?: () => void;
} = {}) => {
  useEscapeHandler({
    swapSourceId: null,
    clearSwapSource: vi.fn(),
    isCustomizing: false,
    exitCustomize: vi.fn(),
    isPlacing,
    exitPlacement,
    pickerOpen: false,
    closePicker: vi.fn(),
    entityPickerOpen: false,
    closeEntityPicker: vi.fn(),
  });
  if (!harness.escape) throw new Error("Escape handler was not registered");
  return harness.escape;
};

beforeEach(() => {
  useEditStore.getState().cancel();
  usePathStore.getState().clear();
  useBullseyeStore.getState().clear();
  harness.escape = null;
  harness.closeAllPIP.mockClear();
  harness.collapseAll.mockClear();
  harness.selection.selectedEntityId = "selected";
  harness.selection.viewedEntityId = null;
  harness.selection.select.mockClear();
  harness.selection.clearSelection.mockClear();
});

describe("Escape mode order", () => {
  it.each(["selected", null])(
    "discards an edit on the first Escape with selection %s",
    (selectedEntityId) => {
      harness.selection.selectedEntityId = selectedEntityId;
      const escape = registerEscape();
      useEditStore.getState().start("freeform-1", "freeform", [
        { type: "coordinate", position: { lat: 43.4, lng: 39.1 } },
        { type: "coordinate", position: { lat: 42.7, lng: 40.4 } },
        { type: "coordinate", position: { lat: 43.5, lng: 41.0 } },
      ]);
      useEditStore.getState().movePoint(1, {
        type: "coordinate",
        position: { lat: 42.5, lng: 40.2 },
      });

      expect(escape()).toBe(true);

      expect(
        useEditStore.getState().entityId,
        "first Escape must cancel the edit before clearing selection",
      ).toBeNull();
      expect(useEditStore.getState().end()).toBeNull();
      expect(harness.selection.select).not.toHaveBeenCalled();
      expect(harness.selection.clearSelection).not.toHaveBeenCalled();
      expect(harness.collapseAll).not.toHaveBeenCalled();
    },
  );

  it("resolves placement before an armed drawing, then the drawing before selection", () => {
    usePathStore.getState().start("circle");
    const exitPlacement = vi.fn();

    registerEscape({ isPlacing: true, exitPlacement })();

    expect(exitPlacement).toHaveBeenCalledOnce();
    expect(selectPathKind(usePathStore.getState())).toBe("circle");
    expect(harness.selection.select).not.toHaveBeenCalled();

    registerEscape()();

    expect(selectPathKind(usePathStore.getState())).toBeNull();
    expect(harness.selection.select).not.toHaveBeenCalled();
  });

  it("resolves placement before bullseye, then bullseye before selection", () => {
    useBullseyeStore.getState().togglePlacing();
    const exitPlacement = vi.fn();

    registerEscape({ isPlacing: true, exitPlacement })();

    expect(exitPlacement).toHaveBeenCalledOnce();
    expect(useBullseyeStore.getState().isPlacing).toBe(true);
    expect(harness.selection.select).not.toHaveBeenCalled();

    registerEscape()();

    expect(useBullseyeStore.getState().isPlacing).toBe(false);
    expect(harness.selection.select).not.toHaveBeenCalled();
  });
});
