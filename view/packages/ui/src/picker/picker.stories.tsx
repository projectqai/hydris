import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { FieldContent, FieldDescription, FieldError, FieldTitle } from "../field";
import { HOLD_DURATION_MS } from "../hold-label";
import { KeyboardProvider } from "../keyboard/keyboard-provider";
import { expectFillFull, expectFillGrows } from "../storybook/hold-fill";
import { center, tap } from "../storybook/pointer";
import { IGNORE_HIDDEN } from "../storybook/queries";
import {
  Picker,
  PickerItem,
  PickerItemContent,
  PickerItemLock,
  PickerItemProgress,
} from "./picker";

type Option = { value: string; label: string; description?: string };

type Args = {
  value?: string;
  pendingValue?: string;
  invalidValue?: string;
  disabled?: boolean;
  accessibilityLabel: string;
  onValueChange: (value: string) => void;
  onCancel: (value: string) => void;
  onRefusedChange: (value: string | undefined) => void;
  onDismissInvalid: (value: string) => void;
  options: Option[];
  disabledOption?: string;
  invalidMessage?: string;
  pendingProgress?: number;
};

const PROFILES: Option[] = [
  { value: "low", label: "Low power", description: "Reduced sampling, longest battery life" },
  { value: "balanced", label: "Balanced", description: "Default sampling for routine use" },
  { value: "full", label: "Full power", description: "Highest sampling, shortest battery life" },
  { value: "calibrate", label: "Calibration", description: "Runs a self-check, then returns" },
];

const meta = {
  title: "UI/Controls/Picker",
  args: {
    value: "balanced",
    accessibilityLabel: "Power profile",
    onValueChange: fn(),
    onCancel: fn(),
    onRefusedChange: fn(),
    onDismissInvalid: fn(),
    options: PROFILES,
  },
  argTypes: {
    options: { control: false },
    disabledOption: { control: "select", options: PROFILES.map((o) => o.value) },
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
  render: function Render({ options, disabledOption, invalidMessage, pendingProgress, ...args }) {
    const [, updateArgs] = useArgs<Args>();

    const onValueChange = (next: string) => {
      args.onValueChange(next);
      updateArgs({ value: next });
    };

    return (
      <Picker {...args} onValueChange={onValueChange}>
        {options.map((o) => {
          const progress = o.value === args.pendingValue ? pendingProgress : undefined;
          const message = o.value === args.invalidValue ? invalidMessage : undefined;

          return (
            <PickerItem key={o.value} value={o.value} disabled={o.value === disabledOption}>
              <PickerItemContent>
                <FieldContent>
                  <FieldTitle>
                    {o.label}
                    <PickerItemLock />
                  </FieldTitle>
                  {message !== undefined && <FieldError>{message}</FieldError>}
                  {message === undefined && o.description && (
                    <FieldDescription>{o.description}</FieldDescription>
                  )}
                </FieldContent>
              </PickerItemContent>
              {progress !== undefined && (
                <PickerItemProgress value={progress} accessibilityLabel={`${o.label} progress`} />
              )}
            </PickerItem>
          );
        })}
      </Picker>
    );
  },
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Opens: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.queryByRole("radio", { name: /Full power/ })).toBeNull();

    await userEvent.click(canvas.getByRole("radio", { name: /Balanced/ }));
    await expect(await canvas.findByRole("radio", { name: /Full power/ })).toBeInTheDocument();
    await expect(canvas.getByRole("radio", { name: /Low power/ })).toBeInTheDocument();
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

export const FoldsOnPressOutside: Story = {
  play: async ({ canvas }) => {
    const user = userEvent.setup();

    await user.click(canvas.getByRole("radio", { name: /Balanced/ }));
    await expect(await canvas.findByRole("radio", { name: /Full power/ })).toBeInTheDocument();

    await user.click(document.body);
    await waitFor(() => expect(canvas.queryByRole("radio", { name: /Full power/ })).toBeNull());
    await expect(canvas.getByRole("radio", { name: /Balanced/ })).toBeVisible();
  },
};

export const ConfirmingFoldsOnEscape: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup();

    await user.click(canvas.getByRole("radio", { name: /Balanced/ }));
    await user.click(await canvas.findByRole("radio", { name: /Full power/ }));
    await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByRole("radio", { name: /Full power/ })).toBeNull());
    await expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull();
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

export const Confirming: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("radio", { name: /Balanced/ }));
    await userEvent.click(await canvas.findByRole("radio", { name: /Full power/ }));
  },
};

export const HoldConfirmsAndFolds: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(canvas.getByRole("radio", { name: /Balanced/ }));
    await user.click(await canvas.findByRole("radio", { name: /Full power/ }));
    await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);

    const row = canvas.getByRole("radio", { name: /Full power/ });
    await user.pointer({ keys: "[MouseLeft>]", target: row });
    const pressedAt = performance.now();

    await expectFillGrows(canvas.getByTestId("hold-fill"));

    const afterFill = pressedAt + HOLD_DURATION_MS + 300 - performance.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, afterFill)));
    await expect(args.onValueChange).not.toHaveBeenCalled();
    await waitFor(() => expect(args.onValueChange).toHaveBeenCalledOnce(), { timeout: 2_000 });
    await user.pointer({ keys: "[/MouseLeft]", target: row });
    await expect(args.onValueChange).toHaveBeenCalledWith("full");
    await waitFor(() => expect(canvas.queryByRole("radio", { name: /Low power/ })).toBeNull());
  },
};

export const PressAndHoldFromRestSwitches: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(canvas.getByRole("radio", { name: /Balanced/ }));

    const row = await canvas.findByRole("radio", { name: /Full power/ });
    await waitFor(() => expect(row).toBeVisible());

    await user.pointer({ keys: "[MouseLeft>]", target: row });

    const fill = await canvas.findByTestId("hold-fill");

    await expectFillFull(fill);

    // Letting go while the full fill waits to confirm changes nothing
    await user.pointer({ keys: "[/MouseLeft]", target: row });
    await expect(args.onValueChange).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expectFillFull(fill);

    await waitFor(() => expect(args.onValueChange).toHaveBeenCalledWith("full"), {
      timeout: 2_000,
    });
    await expect(args.onValueChange).toHaveBeenCalledOnce();
  },
};

export const PressReleasedAwayLeavesListAsIs: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup();

    await user.click(canvas.getByRole("radio", { name: /Balanced/ }));

    const row = await canvas.findByRole("radio", { name: /Full power/ });
    await waitFor(() => expect(row).toBeVisible());

    await user.pointer([
      { keys: "[MouseLeft>]", target: row },
      { target: document.body },
      { keys: "[/MouseLeft]", target: document.body },
    ]);

    await waitFor(() => expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull());
    await expect(row).toBeVisible();
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

export const EarlyReleaseKeepsConfirming: Story = {
  play: async ({ args, canvas }) => {
    const user = userEvent.setup();

    await user.click(canvas.getByRole("radio", { name: /Balanced/ }));
    await user.click(await canvas.findByRole("radio", { name: /Full power/ }));
    await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);

    const row = canvas.getByRole("radio", { name: /Full power/ });
    await user.pointer({ keys: "[MouseLeft>]", target: row });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await user.pointer({ keys: "[/MouseLeft]", target: row });

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await expect(args.onValueChange).not.toHaveBeenCalled();
    await expect(canvas.getByText("Hold to confirm", IGNORE_HIDDEN)).toBeInTheDocument();
  },
};

export const Pending: Story = {
  args: { pendingValue: "full", pendingProgress: 40 },
};

export const PendingFoldsToTargetAndTapCancels: Story = {
  args: { pendingValue: "full" },
  play: async ({ args, canvas }) => {
    const full = await canvas.findByRole("radio", { name: /Full power/ });
    await waitFor(() => expect(full).toBeVisible());
    await expect(canvas.queryByRole("radio", { name: /Balanced/ })).toBeNull();

    await userEvent.click(full);
    await expect(args.onCancel).toHaveBeenCalledOnce();
    await expect(args.onCancel).toHaveBeenCalledWith("full");
  },
};

export const DisabledOption: Story = {
  args: { disabledOption: "calibrate" },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("radio", { name: /Balanced/ }));

    const calibrate = await canvas.findByRole("radio", { name: /Calibration/ });
    await waitFor(() => expect(calibrate).toBeVisible());
    await tap(center(calibrate));
    await expect(args.onValueChange).not.toHaveBeenCalled();
    await expect(args.onRefusedChange).toHaveBeenLastCalledWith("calibrate");
    await expect(calibrate).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(canvas.getByRole("radio", { name: /Full power/ }));
    await expect(args.onRefusedChange).toHaveBeenLastCalledWith(undefined);
  },
};

export const InvalidOption: Story = {
  args: { invalidValue: "full", invalidMessage: "The request was rejected" },
  play: async ({ args, canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("The request was rejected");

    const full = canvas.getByRole("radio", { name: /Full power/ });
    await waitFor(() => expect(full).toBeVisible());
    await expect(canvas.queryByRole("radio", { name: /Balanced/ })).toBeNull();
    await userEvent.click(full);
    await expect(args.onDismissInvalid).toHaveBeenCalledWith("full");
  },
};

export const InvalidOptionWithoutMessage: Story = {
  args: { invalidValue: "full" },
  play: async ({ canvas }) => {
    const full = await canvas.findByRole("radio", { name: /Full power/ });
    await waitFor(() => expect(full).toBeVisible());
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const NoCurrentValue: Story = {
  args: { value: undefined },
};

export const TemporaryDescription: Story = {
  args: {
    options: PROFILES.map((o) =>
      o.value === "balanced" ? { ...o, description: "Warming up, ready in about 2 min" } : o,
    ),
  },
};
