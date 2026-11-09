import type { EditKind, PathPoint } from "@hydris/map-engine/types";
import type { Entity } from "@projectqai/proto/world";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api/world-client", () => ({ worldClient: {} }));

import { CONTROLLER_ID } from "../../../../lib/api/controller-id";
import { writeDrawing } from "../../../../lib/api/write-drawing";
import { resolveRadialItems } from "./resolve-items";

const POINTS: PathPoint[] = [
  { type: "coordinate", position: { lat: 48.1, lng: 11.2 } },
  { type: "coordinate", position: { lat: 48.7, lng: 12.4 } },
  { type: "coordinate", position: { lat: 47.9, lng: 13.1 } },
];

function drawing(kind: EditKind): Entity {
  return {
    id: `${kind}-1`,
    controller: { id: CONTROLLER_ID },
    shape: writeDrawing(kind, POINTS, 3),
  } as Entity;
}

const TASKABLES = Array.from(
  { length: 5 },
  (_, index) => ({ id: `task-${index}`, taskable: { label: `Task ${index}` } }) as Entity,
);

describe("resolveRadialItems, drawings", () => {
  it("offers Move for every drawn kind and leaves three taskable slices", () => {
    for (const kind of ["range", "freeform", "circle", "rb-circle", "rectangle"] as const) {
      expect(resolveRadialItems(drawing(kind), TASKABLES, true).map((item) => item.id)).toEqual([
        "task:task-0",
        "task:task-1",
        "task:task-2",
        "built-in:move",
        "built-in:edit",
        "built-in:delete",
      ]);
    }
  });
});
