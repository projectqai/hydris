import { create } from "@bufbuild/protobuf";
import { AlertLevel, MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { ClassificationIdentity, GetEntityResponseSchema } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { setStringAsync } from "expo-clipboard";
import { Platform, ScrollView, View } from "react-native";
import { expect, mocked, screen, userEvent, waitFor, within } from "storybook/test";

import { worldClient } from "../../../../lib/api/world-client";
import {
  artifact,
  camera,
  detection,
  entity,
  type EntityInit,
  hostileTrack,
  metric,
  track,
  webrtc,
} from "../../../../storybook/entities";
import { cameraInPane, coreProviders } from "../../../../storybook/providers";
import { seedEntities } from "../../../../storybook/seed";
import { OverviewTab } from "./overview-tab";

const radar = entity("radar-1", { label: "Radar North", bearing: { azimuth: 0 } });

const hostile = hostileTrack({ kinematics: { velocityEnu: { east: 3, north: 4, up: -1.4 } } });

const gate = camera("cam-1", [webrtc("Main", "/whep/cam-1")], { label: "Gate north" });

const meta = {
  title: "Core/Aware/Entity details/OverviewTab",
  component: OverviewTab,
  argTypes: { entity: { control: false } },
  tags: ["!autodocs"],
  args: { entity: hostile },
  beforeEach: () => seedEntities([radar, hostile]),
  decorators: [
    (Story) => {
      const harness = (
        <View className="w-80">
          <Story />
        </View>
      );

      return Platform.OS === "web" ? harness : <ScrollView>{harness}</ScrollView>;
    },
    coreProviders(),
  ],
} satisfies Meta<typeof OverviewTab>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("hub-north")).toBeVisible();
    await expect(canvas.getByText("52.5309° N, 13.3847° E")).toBeVisible();
    await expect(canvas.getByText("34m")).toBeVisible();
    await expect(canvas.getByText("110°")).toBeVisible();
    await expect(canvas.getByText("5 m/s")).toBeVisible();
    await expect(canvas.getByText("-1.4 m/s")).toBeVisible();
    await expect(canvas.getByText("37°")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Navigate to Radar North" })).toBeVisible();
  },
};

export const CopyCoordinatesShowsToast: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy coordinates" }));
    await expect(setStringAsync).toHaveBeenCalledWith("52.530900, 13.384700, 34");
    await expect(await screen.findByText("Copied to clipboard")).toBeInTheDocument();
  },
};

export const FullKinematics: Story = {
  args: {
    entity: track("trk-2", ClassificationIdentity.ClassificationIdentityFriend, {
      geo: { latitude: -33.8568, longitude: -151.2153 },
      kinematics: {
        velocityEnu: { east: -6, north: 8, up: 0.5 },
        accelerationEnu: { east: 1, north: 2, up: 2 },
        angularVelocityBody: { rollRate: 0.1, pitchRate: 0, yawRate: -0.25 },
      },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("33.8568° S, 151.2153° W")).toBeVisible();
    await expect(canvas.getByText("N/A")).toBeVisible();
    await expect(canvas.getByText("+0.5 m/s")).toBeVisible();
    await expect(canvas.getByText("323°")).toBeVisible();
    await expect(canvas.getByText("3.00 m/s²")).toBeVisible();
    await expect(canvas.getByText("5.7 °/s")).toBeVisible();
    await expect(canvas.getByText("-14.3 °/s")).toBeVisible();
  },
};

const withEvidence = detection("det-1", "radar-1", {
  label: "Contact ALPHA",
  detection: {
    detectorEntityId: "radar-1",
    confidence: 0.82,
    evidence: ["clip-1", "det-0", "missing-1"],
  },
  interactivity: { referenceUrl: "https://reports.example/det-1" },
});

const seedEvidence = () =>
  seedEntities([
    radar,
    withEvidence,
    artifact("clip-1", "image/jpeg", 482_133n, { label: "Frame 0412" }),
    detection("det-0", "radar-1", { label: "Contact BRAVO" }),
  ]);

export const DetectionWithEvidence: Story = {
  args: { entity: withEvidence },
  beforeEach: seedEvidence,
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("3")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Navigate to Radar North" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Collapse Frame 0412/ })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Navigate to Contact BRAVO" })).toBeVisible();
    await expect(
      await canvas.findByRole("button", { name: "Collapse missing-1, load failed" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Open https://reports.example/det-1" }),
    ).toBeVisible();
  },
};

export const RetriesFailedEvidence: Story = {
  args: { entity: withEvidence },
  beforeEach: seedEvidence,
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas, step }) => {
    await step("a missing artifact opens on its load failure", async () => {
      await canvas.findByRole("button", { name: "Collapse missing-1, load failed" });
      await waitFor(() => expect(canvas.getByText("Artifact could not be loaded")).toBeVisible());
      await expect(worldClient.getEntity).toHaveBeenCalledOnce();
    });

    await step("Retry loads the artifact once it exists", async () => {
      mocked(worldClient.getEntity).mockResolvedValueOnce(
        create(GetEntityResponseSchema, {
          entity: artifact("missing-1", "application/pdf", 20_480n, { label: "Site report" }),
        }),
      );
      const failure = canvas.getByText("Artifact could not be loaded").parentElement;

      await expect(failure).not.toBeNull();

      if (failure) await userEvent.click(within(failure).getByText("Retry"));
      await expect(
        await canvas.findByRole("button", { name: "Collapse Site report" }),
      ).toBeVisible();
      await expect(worldClient.getEntity).toHaveBeenLastCalledWith({ id: "missing-1" });
    });

    await step("the loaded artifact collapses", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Collapse Site report" }));
      await expect(canvas.getByRole("button", { name: "Expand Site report" })).toBeVisible();
    });
  },
};

const snapshot = detection("det-7", "radar-1", {
  label: "Snapshot 0007",
  artifact: { contentType: "image/png" },
  detection: { detectorEntityId: "radar-1", evidence: ["det-7", "clip-1"] },
});

export const OwnArtifactBeforeEvidence: Story = {
  args: { entity: snapshot },
  beforeEach: () =>
    seedEntities([
      radar,
      snapshot,
      artifact("clip-1", "image/jpeg", 482_133n, { label: "Frame 0412" }),
    ]),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("button", { name: /^Collapse Snapshot 0007/ })).toBeVisible();
    await expect(canvasElement).toHaveTextContent(/ArtifactSnapshot 0007.*Evidence1Frame 0412/);
  },
};

const charlie = detection("det-8", "radar-1", {
  label: "Contact CHARLIE",
  symbol: { milStd2525C: "SHAPMFQ---" },
});

const linkedEvidence = detection("det-9", "radar-1", {
  label: "Contact DELTA",
  detection: { detectorEntityId: "radar-1", evidence: ["det-8", "det-0"] },
});

export const EvidenceLinksWithAndWithoutSymbol: Story = {
  args: { entity: linkedEvidence },
  beforeEach: () =>
    seedEntities([
      radar,
      linkedEvidence,
      charlie,
      detection("det-0", "radar-1", { label: "Contact BRAVO" }),
    ]),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("img", { name: "Contact CHARLIE symbol" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Navigate to Contact BRAVO" })).toBeVisible();
    await expect(canvas.queryByRole("img", { name: "Contact BRAVO symbol" })).toBeNull();
  },
};

type Taxonomy = NonNullable<EntityInit["classification"]>["taxonomy"];

const classified = (id: string, detectorEntityId: string, taxonomy: Taxonomy, init?: EntityInit) =>
  detection(id, detectorEntityId, { classification: { taxonomy }, ...init });

const person: Taxonomy = [{ kind: { case: "person", value: {} } }];

const landVehicle: Taxonomy = [
  { kind: { case: "vehicle", value: { domain: { case: "land", value: {} } } } },
];

const emplacedRadar: Taxonomy = [
  {
    confidence: { confidence: 0.7 },
    kind: {
      case: "equipment",
      value: { sensor: { emplaced: {}, kind: { case: "radar", value: {} } } },
    },
  },
];

export const SensorWithDetections: Story = {
  args: { entity: radar },
  beforeEach: () =>
    seedEntities([
      radar,
      classified("det-1", "radar-1", emplacedRadar, {
        detection: { detectorEntityId: "radar-1", classification: "sensor" },
      }),
      classified("det-2", "radar-1", person, { bearing: { azimuth: 291.6 } }),
      detection("det-5", "radar-1", {
        detection: { detectorEntityId: "radar-1", classification: "fighter" },
      }),
      classified("det-3", "cam-9", landVehicle),
    ]),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Detections (3)")).toBeVisible();
    await expect(canvas.getByText("Equipment · Sensor · Emplaced")).toBeVisible();
    await expect(canvas.getByText("· Radar")).toBeVisible();
    await expect(canvas.queryByText("sensor")).toBeNull();
    await expect(canvas.getByText("Person")).toBeVisible();
    await expect(canvas.getByText("fighter")).toBeVisible();
    await expect(canvas.getByText("292°")).toBeVisible();
    await expect(canvas.queryByText("· Land")).toBeNull();
  },
};

const rotaryDrone: Taxonomy = [
  {
    confidence: { confidence: 0.7 },
    kind: {
      case: "vehicle",
      value: {
        unmanned: {},
        domain: { case: "air", value: { kind: { case: "rotary", value: {} } } },
      },
    },
  },
];

const uncertain = classified("det-4", "radar-1", [...rotaryDrone, ...person], {
  detection: { detectorEntityId: "radar-1", classification: "drone" },
});

export const DetectionClassification: Story = {
  args: { entity: uncertain },
  beforeEach: () => seedEntities([radar, uncertain]),
  decorators: [
    (Story) => (
      <View className="w-60">
        <Story />
      </View>
    ),
  ],
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    const rows = canvas.getAllByText("Classification");
    const head = canvas.getByText("Vehicle · Unmanned · Air");
    const tail = canvas.getByText("· Rotary");

    await expect(rows).toHaveLength(2);
    await expect(head.scrollWidth).toBeGreaterThan(head.clientWidth);
    await expect(tail).toBeVisible();
    await expect(canvas.getByText("70%")).toBeVisible();
    await expect(canvas.getByText("Person")).toBeVisible();
    await expect(canvas.queryByText("drone")).toBeNull();
    await expect(tail.getBoundingClientRect().right).toBeLessThanOrEqual(
      rows[0]!.parentElement!.getBoundingClientRect().right,
    );
  },
};

const legacy = detection("det-6", "radar-1", {
  detection: { detectorEntityId: "radar-1", classification: "fighter" },
});

export const LegacyClassification: Story = {
  args: { entity: legacy },
  beforeEach: () => seedEntities([radar, legacy]),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Classification")).toBeVisible();
    await expect(canvas.getByText("fighter")).toBeVisible();
    await expect(canvas.queryByText("Unknown")).toBeNull();
  },
};

const station = entity("env-1", {
  label: "Weather mast",
  metric: {
    metrics: [
      metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 21.4, { id: 1 }),
      metric(MetricKind.MetricKindHumidity, MetricUnit.MetricUnitRatio, 0.63, { id: 2 }),
      metric(MetricKind.MetricKindVoltage, MetricUnit.MetricUnitVolt, 12.6, { id: 3 }),
    ],
  },
});

export const Metrics: Story = {
  args: { entity: station },
  beforeEach: () => seedEntities([station]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Environmental")).toBeVisible();
    await expect(canvas.getByText("Electrical")).toBeVisible();
    await expect(canvas.getByText("21.4 °C")).toBeVisible();
    await expect(canvas.getByText("63%")).toBeVisible();
    await expect(canvas.getByRole("progressbar", { name: "Humidity" })).toHaveAttribute(
      "aria-valuenow",
      "63",
    );
    await expect(canvas.getByText("12.6 V")).toBeVisible();
  },
};

const alerting = entity("env-2", {
  label: "Pump station",
  metric: {
    metrics: [
      metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 58, {
        id: 1,
        label: "Bearing temperature",
        alerting: AlertLevel.AlertLevelWarning,
      }),
      metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 95, {
        id: 2,
        label: "Motor temperature",
        alerting: AlertLevel.AlertLevelCritical,
      }),
      metric(MetricKind.MetricKindVoltage, MetricUnit.MetricUnitVolt, 12.6, { id: 3 }),
    ],
  },
});

export const MetricAlertLevels: Story = {
  args: { entity: alerting },
  beforeEach: () => seedEntities([alerting]),
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent(/Bearing temperatureWarning\s+58 °C/);
    await expect(canvasElement).toHaveTextContent(/Motor temperatureCritical\s+95 °C/);
    await expect(canvasElement).toHaveTextContent(/Voltage12\.6 V/);
  },
};

const nodeOnly = entity("ent-node", {
  label: "Pushed marker",
  geo: { latitude: 47.3769, longitude: 8.5417 },
  controller: { node: "a3f9c2e17b4d", origin: "relay-7" },
});

export const ControllerWithoutId: Story = {
  args: { entity: nodeOnly },
  beforeEach: () => seedEntities([nodeOnly]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Position")).toBeVisible();
    await expect(canvas.queryByText("Controller")).toBeNull();
  },
};

export const Camera: Story = {
  args: { entity: gate },
  beforeEach: () => seedEntities([gate]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Main")).toBeVisible();
    await expect(canvas.queryByText("Playing in PIP")).toBeNull();
  },
};

export const OpensPictureInPicture: Story = {
  args: { entity: gate },
  beforeEach: () => seedEntities([gate]),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open in picture-in-picture" }));
    await expect(canvas.getByText("Playing in PIP")).toBeVisible();
  },
};

export const CameraShownInPane: Story = {
  args: { entity: gate },
  beforeEach: () => seedEntities([gate]),
  decorators: [cameraInPane("cam-1")],
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Viewing in Pane")).toBeVisible();
  },
};
