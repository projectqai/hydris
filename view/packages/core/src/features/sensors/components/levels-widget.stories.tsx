import { LinkStatus } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect } from "storybook/test";

import { chemicalSensor } from "../../../storybook/entities";
import { seedEntities } from "../../../storybook/seed";
import type { LevelValue } from "../types";
import { LevelsWidget } from "./levels-widget";

const mixed: LevelValue[] = [
  { code: "CH3", value: 1 },
  { code: "CH1", value: 7 },
  { code: "CH4", value: 0 },
  { code: "CH2", value: 4 },
];

const allZero: LevelValue[] = [
  { code: "CH1", value: 0 },
  { code: "CH2", value: 0 },
];

const CODE = /^(CH\d|---)$/;

function bars(code: HTMLElement) {
  const row = code.parentElement?.parentElement;
  const segments = row?.lastElementChild?.children;

  if (!segments) throw new Error("LevelsWidget markup changed");

  return [...segments];
}

const meta = {
  title: "Core/Sensors/LevelsWidget",
  component: LevelsWidget,
  tags: ["!autodocs"],
  args: { entityId: "chem-1" },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-64 w-72">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof LevelsWidget>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: () => seedEntities([chemicalSensor("chem-1", mixed)]),
  play: async ({ canvas }) => {
    const first = canvas.getByText("CH1");

    await expect(canvas.getAllByText(CODE).map((code) => code.textContent)).toEqual([
      "CH1",
      "CH2",
      "CH3",
    ]);
    await expect(canvas.getByText("7")).toHaveTextContent("7/8");
    await expect(bars(first)).toHaveLength(8);
    await expect(
      canvas.getAllByText(/^(High|Moderate|Low)$/).map((band) => band.textContent),
    ).toEqual(["High", "Moderate", "Low"]);
  },
};

export const RangeMax: Story = {
  beforeEach: () => seedEntities([chemicalSensor("chem-1", [{ code: "CH1", value: 5, max: 12 }])]),
  play: async ({ canvas }) => {
    const first = canvas.getByText("CH1");

    await expect(canvas.getByText("5")).toHaveTextContent("5/12");
    await expect(bars(first)).toHaveLength(12);
  },
};

export const FewerLevelsThanSlots: Story = {
  beforeEach: () => seedEntities([chemicalSensor("chem-1", [{ code: "CH1", value: 2 }])]),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText(CODE).map((code) => code.textContent)).toEqual([
      "CH1",
      "---",
      "---",
    ]);
  },
};

export const FiveSlots: Story = {
  args: { displaySlots: 5 },
  beforeEach: () => seedEntities([chemicalSensor("chem-1", mixed)]),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText(CODE).map((code) => code.textContent)).toEqual([
      "CH1",
      "CH2",
      "CH3",
      "CH4",
      "---",
    ]);
  },
};

export const FourBars: Story = {
  args: { maxBars: 4 },
  beforeEach: () => seedEntities([chemicalSensor("chem-1", mixed)]),
  play: async ({ canvas }) => {
    const first = canvas.getByText("CH1");

    await expect(canvas.getByText("7")).toHaveTextContent("7/4");
    await expect(bars(first)).toHaveLength(4);
  },
};

export const AllClear: Story = {
  beforeEach: () => seedEntities([chemicalSensor("chem-1", allZero)]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No Detections")).toBeVisible();
    await expect(canvas.queryByText("CH1")).toBeNull();
  },
};

export const AllZeroWhileReconnecting: Story = {
  beforeEach: () =>
    seedEntities([
      chemicalSensor("chem-1", allZero, {
        label: "chem-1",
        link: { status: LinkStatus.LinkStatusDegraded, rssiDbm: -80 },
      }),
    ]),
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("No Detections")).toBeNull();
    await expect(canvas.getAllByText("0").map((value) => value.textContent)).toEqual([
      "0/8",
      "0/8",
    ]);
  },
};
