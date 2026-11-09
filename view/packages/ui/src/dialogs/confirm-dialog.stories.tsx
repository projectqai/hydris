import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import { ControlButton } from "../controls/control-button";
import { tap } from "../storybook/pointer";
import { shownAlertDialog } from "../storybook/queries";
import type { ConfirmDialogProps } from "./confirm-dialog";
import { ConfirmDialog } from "./confirm-dialog";

const meta = {
  title: "UI/Feedback and status/ConfirmDialog",
  component: ConfirmDialog,
  tags: ["!autodocs"],
  args: {
    visible: true,
    title: "Discard layout changes?",
    message: "Your edits to this layout will be lost.",
    onConfirm: fn(),
    onCancel: fn(),
  },
  parameters: { layout: "fullscreen" },
  play: async ({ args }) => {
    await shownAlertDialog(args.title);
  },
  render: function Render(args) {
    const [, updateArgs] = useArgs<ConfirmDialogProps>();

    if (!args.visible) {
      return <ControlButton label="Show dialog" onPress={() => updateArgs({ visible: true })} />;
    }

    return (
      <ConfirmDialog
        {...args}
        onConfirm={() => {
          args.onConfirm();
          updateArgs({ visible: false });
        }}
        onCancel={() => {
          args.onCancel();
          updateArgs({ visible: false });
        }}
      />
    );
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Destructive: Story = {
  args: {
    title: "Delete track?",
    message: "The track and its history are removed for every operator.",
    confirmLabel: "Delete",
    cancelLabel: "Keep",
    destructive: true,
  },
};

export const TitleOnly: Story = { args: { message: undefined } };

export const LongContent: Story = {
  args: {
    title: "Disconnect every sensor on the north perimeter and stop recording all active feeds?",
    message:
      "Operators lose live coverage of the north perimeter until the sensors reconnect. " +
      "Recordings already in progress are saved up to this point, " +
      "and scheduled recordings resume after reconnection.",
  },
};

export const Confirms: Story = {
  play: async ({ args }) => {
    const dialog = await shownAlertDialog(args.title);

    await userEvent.click(dialog.getByLabelText("Confirm"));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
    await expect(args.onCancel).not.toHaveBeenCalled();
  },
};

export const Cancels: Story = {
  play: async ({ args }) => {
    const dialog = await shownAlertDialog(args.title);

    await userEvent.click(dialog.getByLabelText("Cancel"));
    await expect(args.onCancel).toHaveBeenCalledOnce();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const CancelsFromBackdrop: Story = {
  play: async ({ args }) => {
    await shownAlertDialog(args.title);

    await tap({ clientX: 8, clientY: 8 });
    await expect(args.onCancel).toHaveBeenCalledOnce();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const CancelsOnEscape: Story = {
  play: async ({ args }) => {
    await shownAlertDialog(args.title);

    await userEvent.keyboard("{Escape}");
    await expect(args.onCancel).toHaveBeenCalledOnce();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};
