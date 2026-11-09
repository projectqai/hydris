import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Crosshair } from "lucide-react-native";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { FieldContent, FieldDescription, FieldError, FieldTitle } from "./field";
import {
  HoldButton,
  HoldButtonContent,
  HoldButtonIcon,
  HoldButtonLock,
  HoldButtonProgress,
} from "./hold-button";
import { PRESS_START_MS } from "./hooks/use-confirm-press";
import { KeyboardProvider } from "./keyboard/keyboard-provider";
import { expectFillEmpty } from "./storybook/hold-fill";
import { center, tap } from "./storybook/pointer";
import { type Canvas, IGNORE_HIDDEN } from "./storybook/queries";

type Args = Omit<ComponentProps<typeof HoldButton>, "children"> & {
  title: string;
  description?: string;
  error?: string;
  progress?: number;
};

const STATUSES = ["idle", "running", "busy", "done", "failed"] as const;

const meta = {
  title: "UI/Controls/HoldButton",
  args: {
    status: "idle",
    disabled: false,
    title: "Recalibrate sensor",
    description: "Re-zeroes the detection baseline",
    onConfirm: fn(),
    onCancel: fn(),
    onDismiss: fn(),
    onRefuse: fn(),
  },
  argTypes: {
    status: { control: "radio", options: STATUSES },
    error: { control: "text" },
  },
  decorators: [
    (Story) => (
      <KeyboardProvider>
        <View className="w-80">
          <Story />
        </View>
      </KeyboardProvider>
    ),
  ],
  render: function Render({ title, description, error, progress, ...args }) {
    return (
      <HoldButton {...args}>
        <HoldButtonContent>
          <FieldContent>
            <View className="flex-row items-center gap-1.5">
              <HoldButtonIcon icon={Crosshair} />
              <FieldTitle>
                {title}
                <HoldButtonLock />
              </FieldTitle>
            </View>
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              description && <FieldDescription>{description}</FieldDescription>
            )}
          </FieldContent>
        </HoldButtonContent>
        {progress !== undefined && (
          <HoldButtonProgress value={progress} accessibilityLabel={`${title} progress`} />
        )}
      </HoldButton>
    );
  },
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

const recalibrate = (canvas: Canvas) => canvas.getByRole("button", { name: /^Recalibrate sensor/ });

export const Default: Story = {};

export const HoldConfirms: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup();
    const button = recalibrate(canvas);

    await user.click(button);
    await expect(await canvas.findByText("Hold to confirm", IGNORE_HIDDEN)).toBeVisible();
    await expect(args.onConfirm).not.toHaveBeenCalled();

    await user.pointer({ keys: "[MouseLeft>]", target: button });
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledOnce(), { timeout: 2_000 });
    await user.pointer({ keys: "[/MouseLeft]", target: button });

    await waitFor(() => expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull());
  },
};

export const QuickTapShowsNoFill: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup();
    const button = recalibrate(canvas);

    await user.pointer({ keys: "[MouseLeft>]", target: button });
    await new Promise((resolve) => setTimeout(resolve, PRESS_START_MS / 2));
    await expect(canvas.queryByTestId("hold-fill")).toBeNull();

    await user.pointer({ keys: "[/MouseLeft]", target: button });
    await expectFillEmpty(await canvas.findByTestId("hold-fill"));
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const PressAndHoldFromRestConfirms: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup();
    const button = recalibrate(canvas);

    await user.pointer({ keys: "[MouseLeft>]", target: button });
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledOnce(), { timeout: 2_000 });
    await user.pointer({ keys: "[/MouseLeft]", target: button });
  },
};

export const PressReleasedAwayStaysAtRest: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup();
    const button = recalibrate(canvas);

    await user.pointer([
      { keys: "[MouseLeft>]", target: button },
      { target: document.body },
      { keys: "[/MouseLeft]", target: document.body },
    ]);

    await waitFor(() => expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull());
    await expect(button).toHaveTextContent("Re-zeroes the detection baseline");
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const KeyboardHoldConfirms: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup();

    await user.tab();
    await expect(recalibrate(canvas)).toHaveFocus();

    await user.keyboard("{Enter}");
    await expect(await canvas.findByText("Hold to confirm", IGNORE_HIDDEN)).toBeVisible();
    await expect(args.onConfirm).not.toHaveBeenCalled();

    await user.keyboard("{Enter>}");
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledOnce(), { timeout: 2_000 });
    await user.keyboard("{/Enter}");
  },
};

export const EscapeEndsConfirm: Story = {
  play: async ({ canvas }) => {
    const user = userEvent.setup();

    await user.click(recalibrate(canvas));
    await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull());
  },
};

export const PressOutsideEndsConfirm: Story = {
  play: async ({ canvas }) => {
    const user = userEvent.setup();

    await user.click(recalibrate(canvas));
    await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);

    await user.click(document.body);
    await waitFor(() => expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull());
  },
};

export const Running: Story = {
  args: { status: "running", description: "Click to cancel", progress: 40 },
  play: async ({ args, canvas }) => {
    await userEvent.click(recalibrate(canvas));

    await expect(args.onCancel).toHaveBeenCalledOnce();
    await expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull();
  },
};

export const Busy: Story = {
  args: { status: "busy", description: "Sector 3 of 8", progress: 40 },
  play: async ({ args, canvas }) => {
    await userEvent.click(recalibrate(canvas));

    await expect(args.onCancel).not.toHaveBeenCalled();
  },
};

export const Done: Story = {
  args: { status: "done", description: "Done." },
};

export const Failed: Story = {
  args: { status: "failed", error: "Calibration target not visible" },
  play: async ({ args, canvas }) => {
    await userEvent.click(recalibrate(canvas));

    await expect(args.onDismiss).toHaveBeenCalledOnce();
    await expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ args, canvas }) => {
    const button = recalibrate(canvas);

    await expect(button).toHaveAttribute("aria-disabled", "true");

    await tap(center(button));

    await expect(args.onRefuse).toHaveBeenCalledOnce();
    await expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull();
  },
};
