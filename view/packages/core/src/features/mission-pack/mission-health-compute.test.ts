import { create as createProto } from "@bufbuild/protobuf";
import type { Entity, MissionPack } from "@projectqai/proto/world";
import { ConfigurableState, MissionPackSchema } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import type { ComputeInput } from "./mission-health-compute";
import { computeHealth, formatBytes } from "./mission-health-compute";

function entity(id: string, partial: Partial<Entity> = {}): Entity {
  return { id, ...partial } as Entity;
}

function controller(id: string, state: ConfigurableState, error?: string): Entity {
  return entity(id, {
    device: {},
    config: {},
    configurable: { state, error: error ?? "" },
  } as Partial<Entity>);
}

function pack(init: Parameters<typeof createProto<typeof MissionPackSchema>>[1] = {}): MissionPack {
  return createProto(MissionPackSchema, { packVersion: "0.1.0", ...init });
}

function input(overrides: Partial<ComputeInput> = {}): ComputeInput {
  return {
    mission: pack(),
    entities: new Map(),
    currentVersion: "0.1.0",
    ...overrides,
  };
}

describe("computeHealth — entities", () => {
  it("shows entity count from mission pack", () => {
    const result = computeHealth(input({ mission: pack({ entityCount: 149 }) }));
    expect(result.entityCount).toBe(149);
  });
});

describe("computeHealth — controllers", () => {
  it("reports ok when all controllers are active", () => {
    const entities = new Map<string, Entity>([
      ["a", controller("a", ConfigurableState.ConfigurableStateActive)],
    ]);
    const result = computeHealth(input({ entities }));
    expect(result.controllers.status).toBe("ok");
    expect(result.controllers.running).toBe(1);
  });

  it("reports fail when one is Failed", () => {
    const entities = new Map<string, Entity>([
      ["p1", controller("p1", ConfigurableState.ConfigurableStateFailed, "auth refused")],
    ]);
    const result = computeHealth(input({ entities }));
    expect(result.controllers.status).toBe("fail");
    expect(result.controllers.failed).toEqual([{ id: "p1", error: "auth refused" }]);
  });

  it("reports warn when one is still Starting", () => {
    const entities = new Map<string, Entity>([
      ["p1", controller("p1", ConfigurableState.ConfigurableStateActive)],
      ["p2", controller("p2", ConfigurableState.ConfigurableStateStarting)],
    ]);
    const result = computeHealth(input({ entities }));
    expect(result.controllers.status).toBe("warn");
    expect(result.controllers.pending).toEqual(["p2"]);
  });

  it("counts Scheduled as running", () => {
    const entities = new Map<string, Entity>([
      ["p1", controller("p1", ConfigurableState.ConfigurableStateScheduled)],
    ]);
    const result = computeHealth(input({ entities }));
    expect(result.controllers.status).toBe("ok");
    expect(result.controllers.running).toBe(1);
  });

  it("ignores configurable entities without device component", () => {
    const entities = new Map<string, Entity>([
      [
        "mission",
        entity("mission", {
          configurable: { state: ConfigurableState.ConfigurableStateInactive, error: "" },
        } as Partial<Entity>),
      ],
    ]);
    const result = computeHealth(input({ entities }));
    expect(result.controllers.expected).toBe(0);
  });

  it("ignores configurable devices without config component", () => {
    const entities = new Map<string, Entity>([
      ["configured", controller("configured", ConfigurableState.ConfigurableStateActive)],
      [
        "bare",
        entity("bare", {
          device: {},
          configurable: { state: ConfigurableState.ConfigurableStateInactive, error: "" },
        } as Partial<Entity>),
      ],
    ]);
    const result = computeHealth(input({ entities }));
    expect(result.controllers.expected).toBe(1);
    expect(result.controllers.running).toBe(1);
  });
});

describe("computeHealth — layouts", () => {
  it("lists layout names from mission pack, sorted", () => {
    const result = computeHealth(
      input({ mission: pack({ layouts: { watch: "{}", default: "{}" } }) }),
    );
    expect(result.layoutNames).toEqual(["default", "watch"]);
  });
});

describe("computeHealth — version", () => {
  it("reports warn on mismatch", () => {
    const result = computeHealth(
      input({ mission: pack({ packVersion: "0.2.0" }), currentVersion: "0.1.0" }),
    );
    expect(result.version.status).toBe("warn");
    expect(result.version.pack).toBe("0.2.0");
    expect(result.version.engine).toBe("0.1.0");
  });

  it("reports ok on match", () => {
    const result = computeHealth(
      input({ mission: pack({ packVersion: "0.1.0" }), currentVersion: "0.1.0" }),
    );
    expect(result.version.status).toBe("ok");
  });
});

describe("computeHealth — artifacts", () => {
  it("reports count and human-readable total size", () => {
    const result = computeHealth(
      input({ mission: pack({ artifactCount: 3, artifactTotalSize: 12_500_000n }) }),
    );
    expect(result.artifacts.count).toBe(3);
    expect(result.artifacts.size).toBe("12.5 MB");
  });

  it("defaults to 0 / 0 B when the pack records no artifacts", () => {
    const result = computeHealth(input());
    expect(result.artifacts.count).toBe(0);
    expect(result.artifacts.size).toBe("0 B");
  });
});

describe("formatBytes", () => {
  it("formats across unit boundaries", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1500)).toBe("1.5 kB");
    expect(formatBytes(5_000_000)).toBe("5.0 MB");
    expect(formatBytes(3_000_000_000)).toBe("3.0 GB");
  });
});
