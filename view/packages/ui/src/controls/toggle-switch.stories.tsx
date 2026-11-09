import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import type { ToggleSwitchProps } from "./toggle-switch";
import { ToggleSwitch } from "./toggle-switch";

const meta = {
  title: "UI/Controls/ToggleSwitch",
  component: ToggleSwitch,
  args: { value: false, accessibilityLabel: "Show tracks", onValueChange: fn() },
  parameters: { layout: "centered", a11y: { test: "todo" } },
  render: function Render(args) {
    const [, updateArgs] = useArgs<ToggleSwitchProps>();

    return (
      <ToggleSwitch
        {...args}
        onValueChange={(value) => {
          args.onValueChange(value);
          updateArgs({ value });
        }}
      />
    );
  },
} satisfies Meta<typeof ToggleSwitch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TurnsOn: Story = {
  play: async ({ args, canvas }) => {
    const toggle = canvas.getByRole("switch", { name: "Show tracks" });

    await expect(toggle).toHaveAttribute("aria-checked", String(args.value));

    await userEvent.click(toggle);
    await expect(args.onValueChange).toHaveBeenCalledOnce();
    await expect(args.onValueChange).toHaveBeenCalledWith(!args.value);
  },
};

export const TurnsOff: Story = {
  args: { value: true },
  play: TurnsOn.play,
};
