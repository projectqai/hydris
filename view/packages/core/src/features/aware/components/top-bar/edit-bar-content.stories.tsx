import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { modeBar } from "../../../../storybook/mode-bar";
import { EditBarContent } from "./edit-bar-content";

const meta = {
  title: "Core/Aware/Top bar/EditBarContent",
  component: EditBarContent,
  argTypes: {
    kind: { control: "radio", options: ["circle", "rectangle", "freeform", "rb-circle", "range"] },
  },
  args: {
    isTouchInput: false,
    kind: "circle",
    canUndo: true,
    onRingsChange: fn(),
    onUndo: fn(),
    onEnd: fn(),
  },
  decorators: [modeBar()],
  parameters: { a11y: { test: "todo" } },
} satisfies Meta<typeof EditBarContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Range: Story = {
  args: { kind: "range" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Editing R&B")).toBeVisible();
  },
};

export const Rectangle: Story = {
  args: { kind: "rectangle" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Editing Rectangle")).toBeVisible();
  },
};

export const Freeform: Story = {
  args: { kind: "freeform" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Editing Freeform")).toBeVisible();
  },
};

export const RangeBearingCircleWithRings: Story = {
  args: { kind: "rb-circle", rings: 3 },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("Editing R&B Circle")).toBeVisible();

    await userEvent.click(canvas.getByLabelText("Decrease Number of rings"));
    await expect(args.onRingsChange).toHaveBeenCalledOnce();
    await expect(args.onRingsChange).toHaveBeenCalledWith(2);
  },
};

export const Undoes: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Undo edit"));
    await expect(args.onUndo).toHaveBeenCalledOnce();
  },
};

export const Finishes: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Finish editing"));
    await expect(args.onEnd).toHaveBeenCalledOnce();
  },
};

export const NothingToUndo: Story = {
  args: { canUndo: false },
  play: async ({ args, canvas }) => {
    const undo = canvas.getByLabelText("Undo edit");

    await expect(undo).toHaveAttribute("aria-disabled", "true");

    await userEvent.setup({ pointerEventsCheck: 0 }).click(undo);
    await expect(args.onUndo).not.toHaveBeenCalled();
  },
};

export const TouchHelpOpen: Story = {
  args: { isTouchInput: true, kind: "freeform" },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Edit help" }));
    await expect(await canvas.findByText("Insert a new point")).toBeVisible();
  },
};
