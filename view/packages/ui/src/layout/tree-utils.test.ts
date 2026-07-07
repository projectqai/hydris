import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPaneEntityId,
  getStructureKey,
  setPaneEntityId,
  validateLayoutNode,
} from "./tree-utils";
import type { PaneContent } from "./types";

const VALID_IDS = new Set(["alpha", "beta"]);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateLayoutNode", () => {
  it("passes a component pane with a known id through unchanged", () => {
    const result = validateLayoutNode(
      { type: "pane", id: "p1", content: { type: "component", componentId: "alpha" } },
      VALID_IDS,
    );
    expect(result).toEqual({
      type: "pane",
      id: "p1",
      content: { type: "component", componentId: "alpha" },
    });
  });

  it("converts an unknown component id into empty+missingWidgetId", () => {
    const result = validateLayoutNode(
      { type: "pane", id: "p1", content: { type: "component", componentId: "ghost" } },
      VALID_IDS,
    );
    expect(result).toEqual({
      type: "pane",
      id: "p1",
      content: { type: "empty", missingWidgetId: "ghost" },
    });
    expect(console.warn).toHaveBeenCalledWith("[layout] unknown widget id: ghost");
  });

  it("preserves missingWidgetId on round-trip through an empty leaf", () => {
    const result = validateLayoutNode({
      type: "pane",
      id: "p1",
      content: { type: "empty", missingWidgetId: "ghost" },
    });
    expect(result).toEqual({
      type: "pane",
      id: "p1",
      content: { type: "empty", missingWidgetId: "ghost" },
    });
  });

  it("keeps a sibling pane when only one half of a split references an unknown widget", () => {
    const result = validateLayoutNode(
      {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "pane", id: "p1", content: { type: "component", componentId: "alpha" } },
        second: { type: "pane", id: "p2", content: { type: "component", componentId: "ghost" } },
      },
      VALID_IDS,
    );
    expect(result).toEqual({
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "pane", id: "p1", content: { type: "component", componentId: "alpha" } },
      second: { type: "pane", id: "p2", content: { type: "empty", missingWidgetId: "ghost" } },
    });
  });

  it("survives a nested split where deeper leaves reference unknown widgets", () => {
    const result = validateLayoutNode(
      {
        type: "split",
        direction: "vertical",
        ratio: 0.6,
        first: { type: "pane", id: "p1", content: { type: "component", componentId: "alpha" } },
        second: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "pane", id: "p2", content: { type: "component", componentId: "ghost" } },
          second: { type: "pane", id: "p3", content: { type: "component", componentId: "beta" } },
        },
      },
      VALID_IDS,
    );
    expect(result).not.toBeNull();
    expect(result?.type).toBe("split");
    if (result?.type !== "split") return;
    expect(result.second.type).toBe("split");
    if (result.second.type !== "split") return;
    expect(result.second.first).toEqual({
      type: "pane",
      id: "p2",
      content: { type: "empty", missingWidgetId: "ghost" },
    });
    expect(result.second.second).toEqual({
      type: "pane",
      id: "p3",
      content: { type: "component", componentId: "beta" },
    });
  });

  it("still rejects structurally invalid panes (missing id)", () => {
    const result = validateLayoutNode(
      { type: "pane", content: { type: "component", componentId: "alpha" } },
      VALID_IDS,
    );
    expect(result).toBeNull();
  });

  it("still rejects component panes with non-string componentId", () => {
    const result = validateLayoutNode(
      { type: "pane", id: "p1", content: { type: "component", componentId: 42 } },
      VALID_IDS,
    );
    expect(result).toBeNull();
  });

  it("preserves a pinned entityId on a component pane", () => {
    const result = validateLayoutNode(
      {
        type: "pane",
        id: "p1",
        content: { type: "component", componentId: "alpha", entityId: "track-7" },
      },
      VALID_IDS,
    );
    expect(result).toEqual({
      type: "pane",
      id: "p1",
      content: { type: "component", componentId: "alpha", entityId: "track-7" },
    });
  });

  it("drops a pinned entityId when the component id is unknown", () => {
    const result = validateLayoutNode(
      {
        type: "pane",
        id: "p1",
        content: { type: "component", componentId: "ghost", entityId: "track-7" },
      },
      VALID_IDS,
    );
    expect(result).toEqual({
      type: "pane",
      id: "p1",
      content: { type: "empty", missingWidgetId: "ghost" },
    });
  });

  it("ignores a non-string entityId on a component pane", () => {
    const result = validateLayoutNode(
      {
        type: "pane",
        id: "p1",
        content: { type: "component", componentId: "alpha", entityId: 42 },
      },
      VALID_IDS,
    );
    expect(result).toEqual({
      type: "pane",
      id: "p1",
      content: { type: "component", componentId: "alpha" },
    });
  });

  it("accepts an unbound camera pane, with or without an entityId", () => {
    expect(validateLayoutNode({ type: "pane", id: "p1", content: { type: "camera" } })).toEqual({
      type: "pane",
      id: "p1",
      content: { type: "camera" },
    });
    expect(
      validateLayoutNode({ type: "pane", id: "p2", content: { type: "camera", entityId: "cam" } }),
    ).toEqual({ type: "pane", id: "p2", content: { type: "camera", entityId: "cam" } });
  });

  it("accepts an unbound sensor pane but still requires a widgetId", () => {
    expect(
      validateLayoutNode({
        type: "pane",
        id: "p1",
        content: { type: "sensor", widgetId: "sensor:metric" },
      }),
    ).toEqual({ type: "pane", id: "p1", content: { type: "sensor", widgetId: "sensor:metric" } });
    expect(validateLayoutNode({ type: "pane", id: "p2", content: { type: "sensor" } })).toBeNull();
  });
});

describe("getPaneEntityId", () => {
  it("reads the bound entity from each entity-aware variant", () => {
    expect(getPaneEntityId({ type: "component", componentId: "vitals", entityId: "e1" })).toBe(
      "e1",
    );
    expect(getPaneEntityId({ type: "sensor", entityId: "e2", widgetId: "sensor:metric" })).toBe(
      "e2",
    );
    expect(getPaneEntityId({ type: "camera", entityId: "e3" })).toBe("e3");
  });

  it("returns undefined for an unbound component and non-entity content", () => {
    expect(getPaneEntityId({ type: "component", componentId: "vitals" })).toBeUndefined();
    expect(getPaneEntityId({ type: "iframe", url: "https://example.com" })).toBeUndefined();
    expect(getPaneEntityId({ type: "empty" })).toBeUndefined();
  });
});

describe("setPaneEntityId", () => {
  it("pins and unpins a component pane, preserving props", () => {
    const base: PaneContent = { type: "component", componentId: "vitals", props: { a: 1 } };
    const pinned = setPaneEntityId(base, "e1");
    expect(pinned).toEqual({
      type: "component",
      componentId: "vitals",
      entityId: "e1",
      props: { a: 1 },
    });
    const unpinned = setPaneEntityId(pinned, undefined);
    expect(unpinned).toEqual({ type: "component", componentId: "vitals", props: { a: 1 } });
  });

  it("retargets sensor and camera without dropping the id", () => {
    expect(
      setPaneEntityId({ type: "sensor", entityId: "old", widgetId: "sensor:metric" }, "new"),
    ).toEqual({ type: "sensor", entityId: "new", widgetId: "sensor:metric" });
    expect(setPaneEntityId({ type: "camera", entityId: "old" }, "new")).toEqual({
      type: "camera",
      entityId: "new",
    });
  });

  it("unpins sensor and camera, keeping the sensor widget id", () => {
    expect(
      setPaneEntityId({ type: "sensor", entityId: "old", widgetId: "sensor:metric" }, undefined),
    ).toEqual({ type: "sensor", widgetId: "sensor:metric" });
    expect(setPaneEntityId({ type: "camera", entityId: "old" }, undefined)).toEqual({
      type: "camera",
    });
  });
});

describe("getStructureKey", () => {
  it("distinguishes a pinned component pane from an unbound one", () => {
    const unbound = getStructureKey({
      type: "pane",
      id: "p1",
      content: { type: "component", componentId: "vitals" },
    });
    const pinned = getStructureKey({
      type: "pane",
      id: "p1",
      content: { type: "component", componentId: "vitals", entityId: "e1" },
    });
    expect(unbound).toBe("p:vitals");
    expect(pinned).toBe("p:vitals(e1)");
    expect(unbound).not.toBe(pinned);
  });

  it("distinguishes pinned and unbound camera and sensor panes", () => {
    const cam = (entityId?: string) =>
      getStructureKey({ type: "pane", id: "p1", content: { type: "camera", entityId } });
    const sensor = (entityId?: string) =>
      getStructureKey({
        type: "pane",
        id: "p1",
        content: { type: "sensor", entityId, widgetId: "sensor:metric" },
      });
    expect(cam()).toBe("p:cam");
    expect(cam("e1")).toBe("p:cam(e1)");
    expect(sensor()).toBe("p:sensor(sensor:metric)");
    expect(sensor("e2")).toBe("p:sensor(e2,sensor:metric)");
  });
});
