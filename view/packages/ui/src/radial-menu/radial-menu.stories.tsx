import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { ControlButton } from "../controls/control-button";
import { center, drag, tap } from "../storybook/pointer";
import { shownDialog } from "../storybook/queries";
import { screenLocked } from "../storybook/screen-lock";
import { RadialMenu } from "./radial-menu";

const FRIENDLY_SYMBOL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="24">' +
    '<rect x="1" y="1" width="34" height="22" fill="#80e0ff" stroke="#000" stroke-width="2"/></svg>',
)}`;

type RadialMenuPropsAndCustomArgs = ComponentProps<typeof RadialMenu> & { open: boolean };

const meta = {
  title: "UI/Navigation and menus/RadialMenu",
  component: RadialMenu,
  args: {
    open: true,
    position: { x: 240, y: 200 },
    title: "Entity",
    items: [
      { id: "track", label: "Track" },
      { id: "delete", label: "Delete", variant: "destructive" },
      { id: "confirm", label: "Confirm", variant: "success" },
      { id: "disabled", label: "Disabled", disabled: true },
    ],
    onSelect: fn(),
    onClose: fn(),
  },
  parameters: {
    layout: "fullscreen",
    docs: { story: { inline: false, iframeHeight: 420 } },
    a11y: { test: "todo" },
  },
  play: async () => {
    await shownDialog();
  },
  render: function Render({ open, ...args }) {
    const [, updateArgs] = useArgs<RadialMenuPropsAndCustomArgs>();

    if (!open) {
      return <ControlButton label="Open menu" onPress={() => updateArgs({ open: true })} />;
    }

    return (
      <RadialMenu
        {...args}
        onClose={() => {
          args.onClose();
          updateArgs({ open: false });
        }}
      />
    );
  },
} satisfies Meta<RadialMenuPropsAndCustomArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async () => {
    const menu = await shownDialog();

    await expect(menu.getByRole("listbox", { name: "Entity" })).toBeVisible();
  },
};

export const SixItemsWithLongLabels: Story = {
  args: {
    title: undefined,
    items: [
      { id: "center", label: "Center map" },
      { id: "follow", label: "Follow entity" },
      { id: "survey", label: "Photogrammetry survey" },
      { id: "sweep", label: "Instrumentation-calibration" },
      { id: "reclassify", label: "Reclassify", variant: "destructive" },
      { id: "friendly", label: "Mark friendly", variant: "success" },
    ],
  },
  play: async () => {
    const menu = await shownDialog();

    await expect(menu.getByText("Photogr- ammetry survey")).toBeVisible();
    await expect(menu.getByText("Instrume…")).toBeVisible();
  },
};

export const WithTitleIcon: Story = {
  args: { title: "Unmanned-inspection helicopter TANGO 21", titleIconUri: FRIENDLY_SYMBOL },
  play: async () => {
    const menu = await shownDialog();

    await expect(menu.getByRole("img", { name: "Entity symbol" })).toBeVisible();
    await expect(menu.getByText("Unmanned-i- nspection helicopter TANGO 21")).toBeVisible();
  },
};

export const SingleItemAddsClose: Story = {
  args: { items: [{ id: "track", label: "Track" }] },
  play: async ({ args }) => {
    const menu = await shownDialog();

    await waitFor(() => expect(menu.getByText("Close")).toBeVisible());

    await tap(center(menu.getByText("Close")));
    await waitFor(() => expect(args.onClose).toHaveBeenCalledOnce());
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

export const SelectsOnTap: Story = {
  play: async ({ args }) => {
    await tap(center((await shownDialog()).getByText("Confirm")));
    await waitFor(() => expect(args.onSelect).toHaveBeenCalledWith("confirm"));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const HighlightsHoveredSlice: Story = {
  play: async () => {
    const menu = await shownDialog();
    const point = center(menu.getByText("Delete"));
    const target = document.elementFromPoint(point.clientX, point.clientY);

    if (!target) throw new Error("Nothing under the pointer");

    await userEvent.pointer({ target, coords: point });
    await waitFor(() =>
      expect(menu.getByRole("option", { selected: true })).toHaveAccessibleName("Delete"),
    );

    await userEvent.unhover(target);
    await waitFor(() => expect(menu.queryByRole("option", { selected: true })).toBeNull());
  },
};

export const CyclesWithTab: Story = {
  play: async () => {
    const menu = await shownDialog();

    await userEvent.keyboard("{Tab}{Tab}{Tab}");
    await waitFor(() =>
      expect(menu.getByRole("option", { selected: true })).toHaveAccessibleName("Confirm"),
    );

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await waitFor(() =>
      expect(menu.getByRole("option", { selected: true })).toHaveAccessibleName("Delete"),
    );
  },
};

export const SelectsOnDragRelease: Story = {
  play: async ({ args }) => {
    const menu = await shownDialog();

    await drag(center(menu.getByText("Track")), center(menu.getByText("Confirm")));
    await waitFor(() => expect(args.onSelect).toHaveBeenCalledWith("confirm"));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const DisabledItemIgnored: Story = {
  play: async ({ args }) => {
    const menu = await shownDialog();

    await tap(center(menu.getByText("Disabled")));

    await tap(center(menu.getByText("Confirm")));
    await waitFor(() => expect(args.onSelect).toHaveBeenCalledWith("confirm"));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const ScreenLocked: Story = {
  decorators: [screenLocked],
  play: async ({ args }) => {
    await tap(center((await shownDialog()).getByText("Confirm")));

    await tap({ clientX: 8, clientY: 8 });
    await waitFor(() => expect(args.onClose).toHaveBeenCalledOnce());
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

export const ClosesOnBackdropPress: Story = {
  play: async ({ args }) => {
    const [backdrop] = (await shownDialog()).getAllByRole("button", { name: "Close menu" });

    if (!backdrop) throw new Error("RadialMenu markup changed");

    await userEvent.click(backdrop);
    await expect(args.onClose).toHaveBeenCalledOnce();
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};
