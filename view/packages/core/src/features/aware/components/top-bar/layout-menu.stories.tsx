import type { Canvas } from "@hydris/ui/storybook/queries";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { LayoutMenu } from "./layout-menu";

function trigger(canvas: Canvas) {
  return canvas.getByRole("button", { name: /^Layout menu/ });
}

async function open(canvas: Canvas) {
  const button = trigger(canvas);

  await userEvent.click(button);
  await expect(button).toHaveAttribute("aria-expanded", "true");

  const menu = await canvas.findByRole("menu");

  await waitFor(() => expect(menu).toBeVisible());

  return menu;
}

const meta = {
  title: "Core/Aware/Top bar/LayoutMenu",
  component: LayoutMenu,
  args: { activePresetId: "watch", onSelect: fn(), onCustomize: fn() },
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-80 w-96 items-end">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof LayoutMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(trigger(canvas)).toHaveAccessibleName("Layout menu, Watch");
    await expect(trigger(canvas)).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("menu")).toBeNull();
  },
};

export const UnknownPreset: Story = {
  args: { activePresetId: "custom-1" },
  play: async ({ canvas }) => {
    await expect(trigger(canvas)).toHaveTextContent("—");
    await expect(trigger(canvas)).toHaveAccessibleName("Layout menu, no preset");
  },
};

export const Open: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    const menu = await open(canvas);

    await expect(within(menu).getByRole("menuitem", { current: true })).toHaveTextContent("Watch");
    await expect(within(menu).getByRole("menuitem", { name: /Inspect/ })).toHaveAttribute(
      "aria-current",
      "false",
    );
    await expect(canvas.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "InspectF1",
      "WatchF2",
      "OverviewF3",
      "SurveyF4",
    ]);
  },
};

export const SelectsPreset: Story = {
  play: async ({ args, canvas }) => {
    await open(canvas);

    await userEvent.click(canvas.getByRole("menuitem", { name: /Overview/ }));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith("overview");
    await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
  },
};

export const Customizes: Story = {
  play: async ({ args, canvas }) => {
    await open(canvas);

    await userEvent.click(canvas.getByLabelText("Customize layout"));
    await expect(args.onCustomize).toHaveBeenCalledOnce();
    await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
  },
};

export const ClosesOnEscape: Story = {
  play: async ({ args, canvas }) => {
    await open(canvas);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

export const ClosesOnTriggerPress: Story = {
  play: async ({ args, canvas }) => {
    await open(canvas);

    await userEvent.click(trigger(canvas));
    await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

export const ClosesOnOutsidePress: Story = {
  play: async ({ args, canvas, canvasElement }) => {
    await open(canvas);

    await userEvent.click(canvasElement);
    await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};
