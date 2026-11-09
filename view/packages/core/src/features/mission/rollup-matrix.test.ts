import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState, LinkStatus } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import type { EntityInit } from "../../storybook/entities";
import { entity, entityMap, sensorClassification } from "../../storybook/entities";
import type { CategoryState, TileVariant } from "./provider-state";
import {
  getMissionState,
  getOtherServicesState,
  getServiceState,
  getSourcesState,
  getSourceState,
  getWithoutServiceState,
} from "./provider-state";
import { getSourceTexts, OTHER_SERVICES, WITHOUT_SERVICE } from "./source-texts";
import { getReportedSourceKinds, getSourceServices, groupDevices } from "./sources";

const { ConfigurableStateActive, ConfigurableStateInactive } = ConfigurableState;
const { DeviceStateActive, DeviceStateFailed, DeviceStatePending } = DeviceState;

const NODE_ID = "node.base";
const RADAR = sensorClassification({ kind: { case: "radar", value: {} } });
const EW = sensorClassification({ kind: { case: "ew", value: {} } });

type NodeInit = { failed?: boolean; config?: boolean; configurable?: ConfigurableState };

function node({ failed = false, config = false, configurable }: NodeInit = {}): Entity {
  return entity(NODE_ID, {
    label: "Base node",
    device: {
      category: "Network",
      state: failed ? DeviceStateFailed : DeviceStateActive,
      error: failed ? "node failure" : undefined,
      node: { hostname: "base" },
    },
    configurable: configurable === undefined ? undefined : { state: configurable },
    config: config ? {} : undefined,
  });
}

const BASE = [
  entity("relay.service", {
    label: "Relay",
    device: { category: "Network", state: DeviceStateActive },
    configurable: { state: ConfigurableStateActive },
    config: {},
  }),
  entity("archive.service", { label: "Archive", device: { category: "Feeds" }, configurable: {} }),
];

function service(
  id: string,
  state: ConfigurableState,
  { device, configurable, ...init }: EntityInit = {},
): Entity {
  return entity(`${id}.service`, {
    label: `Audit ${id}`,
    device: { category: "Audit", state: DeviceStateActive, ...device },
    configurable: { state, ...configurable },
    ...init,
  });
}

function setUp(id: string, state: ConfigurableState, init: EntityInit = {}): Entity {
  return service(id, state, { config: {}, ...init });
}

function failing(id: string, state: ConfigurableState, error: string): Entity {
  return setUp(id, state, { configurable: { error } });
}

function device(
  id: string,
  parent: string,
  state: DeviceState,
  { device, ...init }: EntityInit = {},
): Entity {
  return entity(id, { label: `Audit ${id}`, device: { parent, state, ...device }, ...init });
}

const usb = device("usb.1", NODE_ID, DeviceStateActive);
const radar = device("radar.1", NODE_ID, DeviceStateActive, { classification: RADAR });

const IN_TWO_HOURS = timestampFromDate(new Date(Date.now() + 2 * 60 * 60 * 1000));

const SERVICE_STATES = {
  "svc-a-unconfigured": [service("a", ConfigurableStateInactive)],
  "svc-b-unconfigured-dev": [
    service("b", ConfigurableStateInactive),
    device("b.dev", "b.service", DeviceStateActive),
  ],
  "svc-c-active": [setUp("c", ConfigurableStateActive)],
  "svc-d-active-dev": [
    setUp("d", ConfigurableStateActive),
    device("d.dev", "d.service", DeviceStateActive),
  ],
  "svc-e-failed-dev": [
    failing("e", ConfigurableState.ConfigurableStateFailed, "service failure"),
    device("e.dev", "e.service", DeviceStateActive),
  ],
  "svc-f-dev-failed": [
    setUp("f", ConfigurableStateActive),
    device("f.dev", "f.service", DeviceStateFailed, { device: { error: "device failure" } }),
  ],
  "svc-g-dev-pending": [
    setUp("g", ConfigurableStateActive),
    device("g.dev", "g.service", DeviceStatePending),
  ],
  "svc-h-own-device-failed": [
    setUp("h", ConfigurableStateActive, {
      device: { state: DeviceStateFailed, error: "service device failure" },
    }),
  ],
  "svc-i-mixed-kinds": [
    setUp("i", ConfigurableStateActive),
    device("i.radar", "i.service", DeviceStateActive, { classification: RADAR }),
    device("i.ew", "i.service", DeviceStateActive, { classification: EW }),
    device("i.plain", "i.service", DeviceStateActive),
  ],
  "svc-j-orphan": [device("j.dev", "j.missing", DeviceStateActive)],
  "svc-k-child-awaits-setup": [
    setUp("k", ConfigurableStateActive),
    device("k.dev", "k.service", DeviceStatePending, { configurable: {} }),
  ],
  "svc-l-scheduled": [
    setUp("l", ConfigurableState.ConfigurableStateScheduled, {
      configurable: { scheduledAt: IN_TWO_HOURS },
    }),
  ],
  "svc-m-dev-link-lost": [
    setUp("m", ConfigurableStateActive),
    device("m.dev", "m.service", DeviceStateActive, {
      link: { status: LinkStatus.LinkStatusLost },
    }),
  ],
  "svc-n-starting": [setUp("n", ConfigurableState.ConfigurableStateStarting)],
  "svc-o-two-radar": [
    failing("o1", ConfigurableState.ConfigurableStateFailed, "radar one failure"),
    device("o1.radar", "o1.service", DeviceStateActive, { classification: RADAR }),
    setUp("o2", ConfigurableStateActive),
    device("o2.radar", "o2.service", DeviceStateActive, { classification: RADAR }),
  ],
  "svc-p-conflict": [failing("p", ConfigurableState.ConfigurableStateConflict, "config conflict")],
  "svc-q-unconfigured-own-device-failed": [
    service("q", ConfigurableStateInactive, {
      device: { state: DeviceStateFailed, error: "offered service failure" },
    }),
  ],
} satisfies Record<string, Entity[]>;

const NODE_STATES = {
  "node-01-alone": [node()],
  "node-02-dev": [node(), usb],
  "node-03-sensor": [node(), radar],
  "node-04-dev-sensor": [node(), usb, radar],
  "node-05-failed-dev-sensor": [node({ failed: true }), usb, radar],
  "node-06-failed": [node({ failed: true })],
  "node-07-config": [node({ config: true })],
  "node-08-config-dev": [node({ config: true }), usb],
  "node-09-config-sensor": [node({ config: true }), radar],
  "node-10-config-dev-sensor": [node({ config: true }), usb, radar],
  "node-11-config-failed-dev-sensor": [node({ config: true, failed: true }), usb, radar],
  "node-12-config-failed": [node({ config: true, failed: true })],
} satisfies Record<string, Entity[]>;

const CONFIGURABLE_NODE_STATES: Record<string, Entity[]> = Object.fromEntries(
  [false, true].flatMap((config) =>
    (["Inactive", "Active", "Starting", "Failed"] as const).flatMap((name) =>
      [false, true].map((failed) => [
        `cfgnode-${config ? "config" : "noconfig"}-${name}-${failed ? "failed" : "active"}`,
        [node({ config, failed, configurable: ConfigurableState[`ConfigurableState${name}`] })],
      ]),
    ),
  ),
);

const STATES = new Map(
  Object.entries({ ...SERVICE_STATES, ...NODE_STATES, ...CONFIGURABLE_NODE_STATES }),
);

function groupsIn(name: string) {
  const extra = STATES.get(name) ?? [];
  const withNode = extra.some(({ id }) => id === NODE_ID) ? extra : [node(), ...extra];

  return groupDevices(entityMap([...BASE, ...withNode]));
}

type Tile = { title: string; state: CategoryState | undefined };

function sourcesPage(groups: ReturnType<typeof groupDevices>, isConnected: boolean): Tile[] {
  const kinds = getReportedSourceKinds(groups).map((kind) => ({
    title: getSourceTexts(kind).title,
    state: getSourceState(kind, groups, isConnected),
  }));

  return [
    ...kinds,
    { title: OTHER_SERVICES, state: getOtherServicesState(groups, isConnected) },
    { title: WITHOUT_SERVICE, state: getWithoutServiceState(groups, isConnected) },
  ].filter(({ state }) => state);
}

function read(title: string, state: CategoryState | undefined): string {
  if (!state) return `${title}: none`;

  return `${title}: ${state.variant} ${state.label} ${state.services}/${state.devices}`;
}

function readIndicator(mission: ReturnType<typeof getMissionState>): string {
  if (!mission) return "hidden";

  return mission.severity === "success" ? "success" : `${mission.severity} ${mission.label}`;
}

function shown(name: string, isConnected = true): string[] {
  const groups = groupsIn(name);
  const indicator = readIndicator(getMissionState(groups, isConnected));

  return [
    `Indicator: ${indicator}`,
    read("Sources", getSourcesState(groups, isConnected)),
    ...sourcesPage(groups, isConnected).map(({ title, state }) => read(title, state)),
  ];
}

const OTHER = "Other services: success Active 1/0";
const CALM = ["Indicator: success", "Sources: success Active 1/0", OTHER];

const alone = (label: string, devices = 0) => [
  `Indicator: alert ${label}`,
  `Sources: alert ${label} 1/${devices}`,
];

const failedOther = (label = "Failed") => [...alone(label), `Other services: alert ${label} 1/0`];

const STARTING = [
  "Indicator: pending Starting",
  "Sources: pending Starting 1/0",
  "Other services: pending Starting 1/0",
];

const nodeSensor = (radarState: string) => [
  radarState.startsWith("alert") ? "Indicator: alert Failed" : "Indicator: success",
  `Sources: ${radarState} 1/1`,
  `Radar: ${radarState} 0/1`,
  OTHER,
];

const SHOWN = new Map(
  Object.entries({
    "svc-a-unconfigured": CALM,
    "svc-b-unconfigured-dev": [
      "Indicator: success",
      "Sources: success Active 1/1",
      "Other services: success Active 1/1",
    ],
    "svc-c-active": [
      "Indicator: success",
      "Sources: success Active 2/0",
      "Other services: success Active 2/0",
    ],
    "svc-d-active-dev": [
      "Indicator: success",
      "Sources: success Active 2/1",
      "Other services: success Active 2/1",
    ],
    "svc-e-failed-dev": [
      "Indicator: alert Failed",
      "Sources: alert Failed 2/1",
      "Other services: alert Failed 2/1",
    ],
    "svc-f-dev-failed": [
      "Indicator: alert Failed",
      "Sources: alert Failed 2/1",
      "Other services: alert Failed 2/1",
    ],
    "svc-g-dev-pending": [
      "Indicator: success",
      "Sources: success Active 2/0",
      "Other services: success Active 2/0",
    ],
    "svc-h-own-device-failed": [
      "Indicator: alert Failed",
      "Sources: alert Failed 2/0",
      "Other services: alert Failed 2/0",
    ],
    "svc-i-mixed-kinds": [
      "Indicator: success",
      "Sources: success Active 2/2",
      "Radar: success Active 1/1",
      "Ew: success Active 1/1",
      OTHER,
    ],
    "svc-j-orphan": [
      "Indicator: hidden",
      "Sources: default Active 1/1",
      OTHER,
      "Without a service: default Active 0/1",
    ],
    "svc-k-child-awaits-setup": [
      "Indicator: success",
      "Sources: success Active 2/0",
      "Other services: success Active 2/0",
    ],
    "svc-l-scheduled": [
      "Indicator: success",
      "Sources: success Scheduled 2/0",
      "Other services: success Scheduled 2/0",
    ],
    "svc-m-dev-link-lost": [
      "Indicator: alert Lost",
      "Sources: alert Lost 2/1",
      "Other services: alert Lost 2/1",
    ],
    "svc-n-starting": [
      "Indicator: pending Starting",
      "Sources: pending Starting 2/0",
      "Other services: pending Starting 2/0",
    ],
    "svc-o-two-radar": [
      "Indicator: alert Failed",
      "Sources: alert Failed 3/2",
      "Radar: alert Failed 2/2",
      OTHER,
    ],
    "svc-p-conflict": [
      "Indicator: alert Conflict",
      "Sources: alert Conflict 2/0",
      "Other services: alert Conflict 2/0",
    ],
    "svc-q-unconfigured-own-device-failed": CALM,
    "node-01-alone": CALM,
    "node-02-dev": [
      "Indicator: success",
      "Sources: success Active 1/1",
      "Other services: success Active 1/1",
    ],
    "node-03-sensor": nodeSensor("success Active"),
    "node-04-dev-sensor": nodeSensor("success Active"),
    "node-05-failed-dev-sensor": nodeSensor("alert Failed"),
    "node-06-failed": failedOther(),
    "node-07-config": CALM,
    "node-08-config-dev": [
      "Indicator: success",
      "Sources: success Active 1/1",
      "Other services: success Active 1/1",
    ],
    "node-09-config-sensor": nodeSensor("success Active"),
    "node-10-config-dev-sensor": nodeSensor("success Active"),
    "node-11-config-failed-dev-sensor": nodeSensor("alert Failed"),
    "node-12-config-failed": failedOther(),
    ...Object.fromEntries(
      ["noconfig", "config"].flatMap((config) => [
        [`cfgnode-${config}-Inactive-active`, CALM],
        [`cfgnode-${config}-Inactive-failed`, failedOther()],
        [`cfgnode-${config}-Active-active`, CALM],
        [`cfgnode-${config}-Active-failed`, failedOther()],
        [`cfgnode-${config}-Starting-active`, STARTING],
        [`cfgnode-${config}-Starting-failed`, failedOther()],
        [`cfgnode-${config}-Failed-active`, failedOther()],
        [`cfgnode-${config}-Failed-failed`, failedOther()],
      ]),
    ),
  } satisfies Record<string, string[]>),
);

const NAMES = [...STATES.keys()];

const WORST_FIRST: TileVariant[] = ["alert", "pending", "default", "success"];

function calmerThan(parent: TileVariant, child: TileVariant): boolean {
  return WORST_FIRST.indexOf(parent) > WORST_FIRST.indexOf(child);
}

describe("what the operator sees in each captured state", () => {
  it("covers every state with an expectation", () => {
    expect([...SHOWN.keys()].sort()).toEqual([...NAMES].sort());
  });

  it.each(NAMES)("%s", (name) => {
    expect(shown(name)).toEqual(SHOWN.get(name));
  });
});

describe.each([true, false])("in every captured state, connected: %s", (isConnected) => {
  it.each(NAMES)("%s: the Sources tile never looks calmer than a tile it opens", (name) => {
    const groups = groupsIn(name);
    const sources = getSourcesState(groups, isConnected);

    for (const { title, state } of sourcesPage(groups, isConnected)) {
      expect(sources, title).toBeDefined();
      expect(calmerThan(sources!.variant, state!.variant), title).toBe(false);
    }
  });

  it.each(NAMES)("%s: a source tile never looks calmer than a service it lists", (name) => {
    const groups = groupsIn(name);

    for (const kind of getReportedSourceKinds(groups)) {
      const tile = getSourceState(kind, groups, isConnected);

      for (const group of getSourceServices(kind, groups)) {
        const row = getServiceState(group, isConnected);

        if (!row.label) continue;

        expect(tile, group.serviceId).toBeDefined();
        expect(calmerThan(tile!.variant, row.variant), group.serviceId).toBe(false);
      }
    }
  });

  it.each(NAMES)("%s: the indicator shows what the Sources tile shows", (name) => {
    const groups = groupsIn(name);
    const sources = getSourcesState(groups, isConnected);
    const mission = getMissionState(groups, isConnected);

    if (!sources || sources.variant === "default") {
      expect(mission).toBeUndefined();
    } else if (sources.variant === "success") {
      expect(mission).toEqual({ severity: "success" });
    } else {
      expect(mission).toEqual({ severity: sources.variant, label: sources.label });
    }
  });
});

describe("while not connected", () => {
  it.each(NAMES)("%s: nothing reads as running", (name) => {
    expect(shown(name, false).filter((line) => line.includes("success"))).toEqual([]);
  });
});
