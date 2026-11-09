import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";
import { expect, userEvent, waitFor } from "storybook/test";

import {
  Accordion,
  AccordionContent,
  AccordionCount,
  AccordionIndicator,
  AccordionItem,
  AccordionTitle,
  AccordionTrigger,
} from "./accordion";

type Section = { value: string; label: string; body: string; count?: number };

const SECTIONS: Section[] = [
  { value: "sensors", label: "Sensors online", body: "radar-north, radar-south, lidar-07" },
  { value: "feeds", label: "Feeds connected", body: "adsb-ingest, ais-coastal" },
  { value: "layouts", label: "Layouts loaded", body: "Overview, Perimeter" },
];

const LONG_LABEL: Section[] = [
  {
    value: "uplink",
    label: "Controllers waiting for the perimeter uplink to reconnect",
    body: "perimeter-uplink",
  },
];

type Args = {
  type: "single" | "multiple";
  collapsible: boolean;
  defaultValue: string[];
  highlighted?: string;
  sections: Section[];
};

function renderItems(sections: Section[], highlighted: string | undefined) {
  return sections.map(({ value, label, body, count }) => (
    <AccordionItem key={value} value={value}>
      <AccordionTrigger highlighted={highlighted === undefined ? undefined : value === highlighted}>
        <AccordionIndicator />
        <AccordionTitle>{label}</AccordionTitle>
        {count !== undefined && <AccordionCount>{count}</AccordionCount>}
      </AccordionTrigger>
      <AccordionContent>
        <Text className="text-muted-foreground text-11 font-mono">{body}</Text>
      </AccordionContent>
    </AccordionItem>
  ));
}

const meta = {
  title: "UI/Containers and surfaces/Accordion",
  args: { type: "multiple", collapsible: false, defaultValue: [], sections: SECTIONS },
  argTypes: {
    type: { control: "radio", options: ["single", "multiple"] },
    defaultValue: { control: "check", options: SECTIONS.map((s) => s.value) },
    highlighted: { control: "select", options: SECTIONS.map((s) => s.value) },
    sections: { control: false },
  },
  render: ({ type, collapsible, defaultValue, highlighted, sections }) =>
    type === "single" ? (
      <Accordion type="single" collapsible={collapsible} defaultValue={defaultValue[0]}>
        {renderItems(sections, highlighted)}
      </Accordion>
    ) : (
      <Accordion type="multiple" defaultValue={defaultValue}>
        {renderItems(sections, highlighted)}
      </Accordion>
    ),
  decorators: [
    (Story) => (
      <View className="w-[560px]">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OpenByDefault: Story = { args: { defaultValue: ["feeds"] } };

export const WithCounts: Story = {
  args: {
    sections: [
      { ...SECTIONS[0]!, count: 3 },
      { ...SECTIONS[1]!, count: 12840 },
    ],
  },
};

export const LongLabelInNarrowContainer: Story = {
  args: { sections: LONG_LABEL },
  decorators: [
    (Story) => (
      <View className="w-56">
        <Story />
      </View>
    ),
  ],
};

export const ExpandsAndCollapses: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: /Sensors online/ });

    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.getByText(SECTIONS[0]!.body)).toBeVisible());
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.queryByText(SECTIONS[0]!.body)).toBeNull());
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  },
};

export const MultipleKeepsOthersOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Sensors online/ }));
    await userEvent.click(canvas.getByRole("button", { name: /Feeds connected/ }));

    await waitFor(() => expect(canvas.getByText(SECTIONS[0]!.body)).toBeVisible());
    await waitFor(() => expect(canvas.getByText(SECTIONS[1]!.body)).toBeVisible());
  },
};

export const SingleClosesTheOpenItem: Story = {
  args: { type: "single", collapsible: true, defaultValue: ["sensors"] },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Feeds connected/ }));

    await waitFor(() => expect(canvas.getByText(SECTIONS[1]!.body)).toBeVisible());
    await waitFor(() => expect(canvas.queryByText(SECTIONS[0]!.body)).toBeNull());
  },
};

export const SingleNotCollapsibleStaysOpen: Story = {
  args: { type: "single", defaultValue: ["sensors"] },
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: /Sensors online/ });

    await userEvent.click(trigger);

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(canvas.getByText(SECTIONS[0]!.body)).toBeVisible());
  },
};

export const HighlightedFromList: Story = {
  args: { highlighted: "feeds" },
  play: async ({ canvas }) => {
    await userEvent.tab();

    await expect(canvas.getByRole("button", { name: /Sensors online/ })).not.toHaveFocus();
    await expect(canvas.getByRole("button", { name: /Feeds connected/ })).not.toHaveFocus();
  },
};
