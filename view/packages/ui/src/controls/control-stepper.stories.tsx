import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import type { ControlStepperProps } from "./control-stepper";
import { ControlStepper } from "./control-stepper";

const meta = {
  title: "UI/Controls/ControlStepper",
  component: ControlStepper,
  args: {
    value: 1500,
    min: 0,
    max: 5000,
    step: 100,
    unit: "m",
    accessibilityLabel: "Altitude",
    onValueChange: fn(),
  },
  parameters: { layout: "centered", a11y: { test: "todo" } },
  render: function Render(args) {
    const [, updateArgs] = useArgs<ControlStepperProps>();

    return (
      <ControlStepper
        {...args}
        onValueChange={(value) => {
          args.onValueChange(value);
          updateArgs({ value });
        }}
      />
    );
  },
} satisfies Meta<typeof ControlStepper>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoUnitOrBounds: Story = {
  args: { value: 3, step: 1, min: undefined, max: undefined, unit: undefined },
};

export const AtMin: Story = {
  args: { value: 0, min: 0, max: 10, step: 1 },
  play: async ({ args, canvas }) => {
    const decrease = canvas.getByLabelText("Decrease Altitude");

    await expect(decrease).toHaveAttribute("aria-disabled", "true");
    await expect(canvas.getByLabelText("Increase Altitude")).not.toHaveAttribute("aria-disabled");

    await userEvent.setup({ pointerEventsCheck: 0 }).click(decrease);
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

export const AtMax: Story = {
  args: { value: 10, min: 0, max: 10, step: 1 },
  play: async ({ args, canvas }) => {
    const increase = canvas.getByLabelText("Increase Altitude");

    await expect(increase).toHaveAttribute("aria-disabled", "true");
    await expect(canvas.getByLabelText("Decrease Altitude")).not.toHaveAttribute("aria-disabled");

    await userEvent.setup({ pointerEventsCheck: 0 }).click(increase);
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByLabelText("Decrease Altitude")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(canvas.getByLabelText("Increase Altitude")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await userEvent.type(canvas.getByLabelText("Altitude"), "7");
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

export const Increments: Story = {
  play: async ({ args, canvas }) => {
    const shown = Number(canvas.getByLabelText<HTMLInputElement>("Altitude").value);

    await userEvent.click(canvas.getByLabelText("Increase Altitude"));
    await expect(args.onValueChange).toHaveBeenCalledOnce();
    await expect(args.onValueChange).toHaveBeenCalledWith(shown + 100);
  },
};

export const Decrements: Story = {
  play: async ({ args, canvas }) => {
    const shown = Number(canvas.getByLabelText<HTMLInputElement>("Altitude").value);

    await userEvent.click(canvas.getByLabelText("Decrease Altitude"));
    await expect(args.onValueChange).toHaveBeenCalledOnce();
    await expect(args.onValueChange).toHaveBeenCalledWith(shown - 100);
  },
};

export const IncrementClampsToMax: Story = {
  args: { value: 4950 },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Increase Altitude"));
    await expect(args.onValueChange).toHaveBeenCalledOnce();
    await expect(args.onValueChange).toHaveBeenCalledWith(5000);
  },
};

export const TypedValueClampsToMax: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.type(canvas.getByLabelText("Altitude"), "7");
    await expect(args.onValueChange).toHaveBeenCalledOnce();
    await expect(args.onValueChange).toHaveBeenCalledWith(5000);
  },
};
