import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Circle, PenLine, RectangleHorizontal, Shapes, Spline } from "lucide-react-native";
import type { ComponentProps } from "react";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import type { ExpandingIconGroupOption } from "./expanding-icon-group";
import { ExpandingIconGroup } from "./expanding-icon-group";

const options: ExpandingIconGroupOption[] = [
  { id: "line", icon: PenLine, label: "Line" },
  { id: "circle", icon: Circle, label: "Circle" },
  { id: "rectangle", icon: RectangleHorizontal, label: "Rectangle" },
  { id: "freeform", icon: Spline, label: "Freeform" },
];

const withActiveCircle = options.map((option) =>
  option.id === "circle" ? { ...option, active: true, iconColor: "rgb(16, 185, 129)" } : option,
);

const meta = {
  title: "UI/Controls/ExpandingIconGroup",
  component: ExpandingIconGroup,
  args: {
    icon: Shapes,
    label: "Drawing tools",
    options,
    expanded: false,
    onExpandedChange: fn(),
    onSelect: fn(),
  },
  parameters: { layout: "centered", a11y: { test: "todo" } },
  argTypes: {
    icon: { control: "select", options: ["Shapes", "PenLine"], mapping: { Shapes, PenLine } },
    options: {
      control: "select",
      options: ["Default", "ActiveCircle"],
      mapping: { Default: options, ActiveCircle: withActiveCircle },
    },
  },
  render: function Render(args) {
    const [, updateArgs] = useArgs<ComponentProps<typeof ExpandingIconGroup>>();

    return (
      <ExpandingIconGroup
        {...args}
        onExpandedChange={(expanded) => {
          args.onExpandedChange(expanded);
          updateArgs({ expanded });
        }}
      />
    );
  },
} satisfies Meta<typeof ExpandingIconGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByLabelText("Drawing tools")).toHaveFocus();

    await userEvent.tab();
    await expect(document.body).toHaveFocus();
  },
};

export const ExpandedWithActiveOption: Story = {
  args: { expanded: true, options: withActiveCircle },
};

export const CollapsedWithActiveOption: Story = { args: { options: withActiveCircle } };

export const Expands: Story = {
  play: async ({ args, canvas }) => {
    const trigger = canvas.getByLabelText("Drawing tools");
    const expanded = trigger.getAttribute("aria-expanded") === "true";

    await userEvent.click(trigger);
    await expect(args.onExpandedChange).toHaveBeenCalledOnce();
    await expect(args.onExpandedChange).toHaveBeenCalledWith(!expanded);
  },
};

export const Collapses: Story = {
  args: { expanded: true },
  play: Expands.play,
};

export const SelectsOption: Story = {
  args: { expanded: true },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Circle"));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith("circle");
    await expect(args.onExpandedChange).not.toHaveBeenCalled();
  },
};
