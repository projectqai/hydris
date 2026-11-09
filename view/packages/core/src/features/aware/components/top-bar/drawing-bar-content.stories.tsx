import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { modeBar } from "../../../../storybook/mode-bar";
import { DrawingBarContent } from "./drawing-bar-content";

const meta = {
  title: "Core/Aware/Top bar/DrawingBarContent",
  component: DrawingBarContent,
  argTypes: {
    kind: { control: "radio", options: ["freeform", "circle", "rectangle", "rb-circle"] },
  },
  args: {
    isTouchInput: false,
    kind: "freeform",
    label: "Freeform",
    canUndo: true,
    onFinish: fn(),
    onUndo: fn(),
    onCancel: fn(),
    onRingsChange: fn(),
  },
  decorators: [modeBar()],
  parameters: { a11y: { test: "todo" } },
} satisfies Meta<typeof DrawingBarContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Circle: Story = { args: { kind: "circle", label: "Circle" } };

export const Rectangle: Story = { args: { kind: "rectangle", label: "Rectangle" } };

export const RangeBearingCircleWithRings: Story = {
  args: { kind: "rb-circle", label: "R&B Circle", rings: 3 },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Increase Number of rings"));
    await expect(args.onRingsChange).toHaveBeenCalledOnce();
    await expect(args.onRingsChange).toHaveBeenCalledWith(4);
  },
};

export const CannotFinishYet: Story = {
  args: { onFinish: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Cancel drawing")).toBeVisible();
    await expect(canvas.queryByLabelText("Finish drawing")).toBeNull();
  },
};

export const Undoes: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Undo last point"));
    await expect(args.onUndo).toHaveBeenCalledOnce();
  },
};

export const Cancels: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Cancel drawing"));
    await expect(args.onCancel).toHaveBeenCalledOnce();
    await expect(args.onFinish).not.toHaveBeenCalled();
  },
};

export const Finishes: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Finish drawing"));
    await expect(args.onFinish).toHaveBeenCalledOnce();
    await expect(args.onCancel).not.toHaveBeenCalled();
  },
};

export const NothingToUndo: Story = {
  args: { canUndo: false },
  play: async ({ args, canvas }) => {
    const undo = canvas.getByLabelText("Undo last point");

    await expect(undo).toHaveAttribute("aria-disabled", "true");

    await userEvent.setup({ pointerEventsCheck: 0 }).click(undo);
    await expect(args.onUndo).not.toHaveBeenCalled();
  },
};

export const TouchHelpOpen: Story = {
  args: { isTouchInput: true, kind: "rb-circle", label: "R&B Circle", rings: 3 },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Drawing help" }));
    await expect(await canvas.findByText("Set how many before you finish")).toBeVisible();
    await expect(canvas.getByText("Hold")).toBeVisible();
  },
};
